"""RFM (Recency, Frequency, Monetary) segmentation.

Scoring and segmentation are performed in SQL (``src/sql/queries/rfm_scores.sql``).
This module builds the scoring expressions from a validated :class:`RFMConfig`,
executes the query and optionally materialises the result into
``customer_segments`` so other SQL queries can filter and join on segments.

RFM segments are descriptive groupings based on transparent rules. They are not
statistically validated predictions of future behaviour.
"""
from __future__ import annotations

import hashlib
import sqlite3

import pandas as pd

from src.config import RFM_BINS, RFMConfig, SegmentRule
from src.sql.runner import load_sql, run_sql

FALLBACK_SEGMENT = "Other"


def _quantile_expr(column: str, higher_is_better: bool) -> str:
    """Score 1..5 from PERCENT_RANK(); tied values always receive the same score."""
    direction = "ASC" if higher_is_better else "DESC"
    return (
        f"MIN({RFM_BINS}, CAST(PERCENT_RANK() OVER (ORDER BY {column} {direction}) "
        f"* {RFM_BINS} AS INTEGER) + 1)"
    )


def _fixed_expr(column: str, thresholds: tuple[float, ...], higher_is_better: bool) -> str:
    cuts = [float(t) for t in thresholds]  # validated numerics only -> safe to inline
    whens = []
    for i, cut in enumerate(cuts):
        score = (i + 1) if higher_is_better else (RFM_BINS - i)
        whens.append(f"WHEN {column} <= {cut!r} THEN {score}")
    else_score = RFM_BINS if higher_is_better else 1
    return "CASE " + " ".join(whens) + f" ELSE {else_score} END"


def _quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _rule_condition(rule: SegmentRule) -> str:
    parts = []
    for column, bound in (("r_score", rule.r), ("f_score", rule.f), ("m_score", rule.m), ("fm_score", rule.fm)):
        if bound is not None:
            lo, hi = int(bound[0]), int(bound[1])
            parts.append(f"{column} BETWEEN {lo} AND {hi}")
    return " AND ".join(parts) if parts else "1 = 1"


def segment_case_sql(rules: tuple[SegmentRule, ...]) -> str:
    whens = "\n        ".join(f"WHEN {_rule_condition(r)} THEN {_quote(r.name)}" for r in rules)
    return f"CASE\n        {whens}\n        ELSE {_quote(FALLBACK_SEGMENT)}\n    END"


def build_rfm_sql(config: RFMConfig) -> str:
    """Return the complete RFM SQL for ``config`` (useful for display and docs)."""
    config.validate()
    if config.method == "quantile":
        r_expr = _quantile_expr("recency_days", higher_is_better=False)
        f_expr = _quantile_expr("frequency", higher_is_better=True)
        m_expr = _quantile_expr("monetary", higher_is_better=True)
    else:
        r_expr = _fixed_expr("recency_days", config.recency_thresholds, higher_is_better=False)
        f_expr = _fixed_expr("frequency", config.frequency_thresholds, higher_is_better=True)
        m_expr = _fixed_expr("monetary", config.monetary_thresholds, higher_is_better=True)
    sql = load_sql("rfm_scores")
    return (
        sql.replace("/*R_SCORE*/", r_expr)
        .replace("/*F_SCORE*/", f_expr)
        .replace("/*M_SCORE*/", m_expr)
        .replace("/*SEGMENT_CASE*/", segment_case_sql(config.segment_rules))
    )


def compute_rfm(conn: sqlite3.Connection, end_date: str, config: RFMConfig | None = None) -> pd.DataFrame:
    """Compute RFM values, scores and segments for all customers as of ``end_date``."""
    config = config or RFMConfig()
    return run_sql(conn, build_rfm_sql(config), {"end_date": end_date})


def run_key_for(version: str, end_date: str, config: RFMConfig) -> str:
    digest = hashlib.sha1(f"{version}|{end_date}|{config!r}".encode("utf-8")).hexdigest()
    return digest[:16]


MAX_STORED_RUNS = 12


def materialize_segments(
    conn: sqlite3.Connection, version: str, end_date: str, config: RFMConfig | None = None
) -> str:
    """Write RFM results to ``customer_segments`` (idempotent) and return the run key."""
    config = config or RFMConfig()
    key = run_key_for(version, end_date, config)
    exists = conn.execute("SELECT 1 FROM customer_segments WHERE run_key = ? LIMIT 1", (key,)).fetchone()
    if exists:
        return key
    rfm = compute_rfm(conn, end_date, config)
    cols = ["customer_id", "last_purchase", "recency_days", "frequency", "monetary",
            "r_score", "f_score", "m_score", "fm_score", "rfm_code", "segment"]
    with conn:
        # Keep the table small: drop the oldest runs beyond the retention limit.
        runs = [r[0] for r in conn.execute(
            "SELECT run_key FROM customer_segments GROUP BY run_key ORDER BY MIN(rowid)")]
        for old in runs[: max(0, len(runs) - (MAX_STORED_RUNS - 1))]:
            conn.execute("DELETE FROM customer_segments WHERE run_key = ?", (old,))
        conn.executemany(
            f"INSERT OR REPLACE INTO customer_segments (run_key, {', '.join(cols)}) "
            f"VALUES (?, {', '.join('?' * len(cols))})",
            ((key, *row) for row in rfm[cols].astype(object).itertuples(index=False, name=None)),
        )
    return key


def segment_definitions(config: RFMConfig | None = None) -> pd.DataFrame:
    """Human-readable table of the segment rules, in evaluation order."""
    config = config or RFMConfig()

    def fmt(bound):
        if bound is None:
            return "any"
        lo, hi = bound
        return str(lo) if lo == hi else f"{lo}-{hi}"

    rows = [
        {"Priority": i + 1, "Segment": r.name, "R": fmt(r.r), "F": fmt(r.f), "M": fmt(r.m),
         "FM": fmt(r.fm), "Description": r.description, "Suggested action": r.action}
        for i, r in enumerate(config.segment_rules)
    ]
    rows.append({"Priority": len(rows) + 1, "Segment": FALLBACK_SEGMENT, "R": "any", "F": "any",
                 "M": "any", "FM": "any", "Description": "Customers matching no rule above.",
                 "Suggested action": "Review rule coverage."})
    return pd.DataFrame(rows)

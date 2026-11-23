"""Loads and executes the documented SQL files in ``src/sql/queries``.

Query files use SQLite named parameters (``:start_date``) and two macros, expanded
before execution so every analysis applies filters identically:

``{{FILTERED_TX}}``
    Transactions inside ``[:start_date, :end_date]``, restricted to the selected RFM
    segments when ``:seg_filter = 1``.
``{{HISTORY_TX}}``
    All transactions up to ``:end_date`` (no start bound) with the same segment
    restriction. Used where full customer history matters (recency, cohorts, risk).

Values are always bound as parameters, never formatted into SQL text. The only
text substitution is the macro expansion above and the RFM scoring expressions built
from validated numeric configuration (see ``src/segments/rfm.py``).
"""
from __future__ import annotations

import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

import pandas as pd

QUERY_DIR = Path(__file__).with_name("queries")

_SEGMENT_RESTRICTION = """
      AND (:seg_filter = 0 OR t.customer_id IN (
            SELECT cs.customer_id FROM customer_segments cs
            WHERE cs.run_key = :run_key
              AND cs.segment IN (SELECT value FROM json_each(:segments))))"""

MACROS = {
    "{{FILTERED_TX}}": (
        "SELECT t.* FROM transactions t\n"
        "    WHERE t.invoice_day BETWEEN :start_date AND :end_date" + _SEGMENT_RESTRICTION
    ),
    "{{HISTORY_TX}}": (
        "SELECT t.* FROM transactions t\n"
        "    WHERE t.invoice_day <= :end_date" + _SEGMENT_RESTRICTION
    ),
}

DEFAULT_PARAMS: dict[str, Any] = {
    "start_date": "0000-01-01",
    "end_date": "9999-12-31",
    "seg_filter": 0,
    "run_key": "",
    "segments": "[]",
}


@lru_cache(maxsize=None)
def load_sql(name: str) -> str:
    path = QUERY_DIR / f"{name}.sql"
    if not path.exists():
        raise FileNotFoundError(f"No SQL query named {name!r} in {QUERY_DIR}")
    return render(path.read_text(encoding="utf-8"))


def render(sql: str) -> str:
    for token, body in MACROS.items():
        sql = sql.replace(token, body)
    return sql


def list_queries() -> list[str]:
    return sorted(p.stem for p in QUERY_DIR.glob("*.sql"))


def _params(params: Mapping[str, Any] | None) -> dict[str, Any]:
    merged = dict(DEFAULT_PARAMS)
    if params:
        merged.update(params)
    return merged


def run_sql(conn: sqlite3.Connection, sql: str, params: Mapping[str, Any] | None = None) -> pd.DataFrame:
    return pd.read_sql_query(render(sql), conn, params=_params(params))


def run_query(conn: sqlite3.Connection, name: str, params: Mapping[str, Any] | None = None) -> pd.DataFrame:
    """Execute a named query file and return a DataFrame."""
    return pd.read_sql_query(load_sql(name), conn, params=_params(params))

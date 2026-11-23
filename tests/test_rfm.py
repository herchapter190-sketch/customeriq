"""RFM values, scoring (quantile and fixed), segment rules and configuration."""
from __future__ import annotations

import pytest

from src.config import RFMConfig, SegmentRule
from src.segments import service
from src.segments.rfm import build_rfm_sql, compute_rfm, materialize_segments, segment_definitions


def rfm_by_customer(conn, config=None, end="2024-03-31"):
    return compute_rfm(conn, end, config).set_index("customer_id")


def test_rfm_raw_values(known_conn):
    r = rfm_by_customer(known_conn)
    assert r["recency_days"].to_dict() == {"A": 16, "B": 29, "C": 57, "D": 3}
    assert r["frequency"].to_dict() == {"A": 3, "B": 2, "C": 1, "D": 1}
    assert r["monetary"].to_dict() == {"A": 95.0, "B": 150.0, "C": 200.0, "D": 20.0}   # net of returns


def test_quantile_scores_and_ties(known_conn):
    r = rfm_by_customer(known_conn)
    assert r["r_score"].to_dict() == {"A": 4, "B": 2, "C": 1, "D": 5}
    # C and D both have one order: ties always share the same score
    assert r["f_score"].to_dict() == {"A": 5, "B": 4, "C": 1, "D": 1}
    assert r["m_score"].to_dict() == {"A": 2, "B": 4, "C": 5, "D": 1}
    assert r["fm_score"].to_dict() == {"A": 4, "B": 4, "C": 3, "D": 1}
    assert r["rfm_code"].to_dict() == {"A": "452", "B": "244", "C": "115", "D": "511"}


def test_segment_assignment(known_conn):
    seg = rfm_by_customer(known_conn)["segment"].to_dict()
    assert seg == {"A": "Champions", "B": "At Risk", "C": "At Risk", "D": "New Customers"}


def test_fixed_threshold_scoring(known_conn):
    cfg = RFMConfig(method="fixed")
    r = rfm_by_customer(known_conn, cfg)
    assert r["r_score"].to_dict() == {"A": 5, "B": 5, "C": 4, "D": 5}
    assert r["f_score"].to_dict() == {"A": 3, "B": 2, "C": 1, "D": 1}
    assert r["m_score"].to_dict() == {"A": 1, "B": 2, "C": 2, "D": 1}


def test_fixed_threshold_boundaries_are_inclusive(known_conn):
    # Recency of A is exactly 16 days -> "<= 16" must score 5.
    cfg = RFMConfig(method="fixed", recency_thresholds=(16, 30, 60, 90))
    r = rfm_by_customer(known_conn, cfg)
    assert r.loc["A", "r_score"] == 5 and r.loc["B", "r_score"] == 4 and r.loc["C", "r_score"] == 3


def test_scores_always_in_range(demo_conn):
    for cfg in (RFMConfig(), RFMConfig(method="fixed")):
        r = compute_rfm(demo_conn, "2024-12-31", cfg)
        for col in ("r_score", "f_score", "m_score", "fm_score"):
            assert r[col].between(1, 5).all()
        assert r["customer_id"].is_unique


def test_every_customer_gets_a_known_segment(demo_conn):
    r = compute_rfm(demo_conn, "2024-12-31")
    names = {rule.name for rule in RFMConfig().segment_rules} | {"Other"}
    assert set(r["segment"]) <= names
    assert (r["segment"] == "Other").sum() == 0      # default rules cover every score combination


def test_custom_segment_rules(known_conn):
    cfg = RFMConfig(segment_rules=(SegmentRule("Recent", "", "", r=(4, 5)),))
    seg = rfm_by_customer(known_conn, cfg)["segment"].to_dict()
    assert seg == {"A": "Recent", "B": "Other", "C": "Other", "D": "Recent"}


def test_segment_name_with_quote_is_escaped(known_conn):
    cfg = RFMConfig(segment_rules=(SegmentRule("O'Brien's best", "", "", r=(1, 5)),))
    assert set(rfm_by_customer(known_conn, cfg)["segment"]) == {"O'Brien's best"}


@pytest.mark.parametrize("bad", [
    RFMConfig(method="magic"),
    RFMConfig(recency_thresholds=(30, 20, 40, 50)),
    RFMConfig(frequency_thresholds=(1, 2, 3)),
    RFMConfig(monetary_thresholds=(-1, 2, 3, 4)),
    RFMConfig(segment_rules=(SegmentRule("x", "", "", r=(0, 6)),)),
    RFMConfig(segment_rules=()),
])
def test_invalid_config_rejected(bad):
    with pytest.raises(ValueError):
        bad.validate()


def test_rfm_excludes_customers_with_only_returns(known_conn):
    known_conn.execute("INSERT INTO transactions (invoice_id, customer_id, invoice_ts, invoice_day, invoice_month,"
                       " month_num, product_id, quantity, unit_price, revenue, is_return) VALUES"
                       " ('C9', 'R', '2024-03-01 00:00:00', '2024-03-01', '2024-03', 24290, 'P1', -1, 5, -5, 1)")
    assert "R" not in rfm_by_customer(known_conn).index


def test_snapshot_date_excludes_later_orders(known_conn):
    r = rfm_by_customer(known_conn, end="2024-02-15")
    assert set(r.index) == {"A", "B", "C"}            # D's first order is in March
    assert r.loc["A", "frequency"] == 2 and r.loc["A", "monetary"] == pytest.approx(45.0)


def test_materialize_is_idempotent_and_keyed(known_conn):
    k1 = materialize_segments(known_conn, "v1", "2024-03-31")
    k2 = materialize_segments(known_conn, "v1", "2024-03-31")
    k3 = materialize_segments(known_conn, "v1", "2024-03-31", RFMConfig(method="fixed"))
    assert k1 == k2 != k3
    count = known_conn.execute("SELECT COUNT(*) FROM customer_segments WHERE run_key = ?", (k1,)).fetchone()[0]
    assert count == 4


def test_segment_summary_counts_and_revenue(known_conn, known_ctx):
    s = service.segment_summary(known_conn, known_ctx).set_index("segment")
    assert s["customers"].sum() == 4
    assert s.loc["At Risk", "customers"] == 2
    assert s.loc["At Risk", "net_revenue"] == pytest.approx(350.0)
    assert s["revenue_share_pct"].sum() == pytest.approx(100.0, abs=0.05)
    # AOV for At Risk = (100 + 50 + 200) / 3 orders
    assert s.loc["At Risk", "avg_order_value"] == pytest.approx(round(350 / 3, 2))


def test_rfm_grid_and_definitions(known_conn, known_ctx):
    grid = service.rfm_grid(known_conn, known_ctx)
    assert grid["customers"].sum() == 4
    defs = segment_definitions()
    assert list(defs["Segment"])[:2] == ["Champions", "New Customers"] and defs.iloc[-1]["Segment"] == "Other"


def test_generated_sql_contains_no_unreplaced_markers():
    for cfg in (RFMConfig(), RFMConfig(method="fixed")):
        sql = build_rfm_sql(cfg)
        assert "/*R_SCORE*/" not in sql and "/*SEGMENT_CASE*/" not in sql
        assert "PERCENT_RANK" in sql if cfg.method == "quantile" else "CASE WHEN recency_days" in sql

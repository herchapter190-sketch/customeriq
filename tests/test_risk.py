"""Rule-based inactivity indicators."""
from __future__ import annotations

import pytest

from src.analytics import risk
from src.analytics.context import AnalysisFilters, prepare_context
from src.config import RISK_ORDER, RiskConfig


def ctx_for(conn, end="2024-03-31", **risk_kwargs):
    cfg = RiskConfig(**risk_kwargs) if risk_kwargs else RiskConfig()
    return prepare_context(conn, AnalysisFilters("2024-01-01", end, risk=cfg))


def test_days_inactive_and_history(known_conn):
    ic = risk.inactive_customers(known_conn, ctx_for(known_conn)).set_index("customer_id")
    assert ic["days_inactive"].to_dict() == {"A": 16, "B": 29, "C": 57, "D": 3}
    assert ic["last_purchase"].to_dict() == {"A": "2024-03-15", "B": "2024-03-02", "C": "2024-02-03",
                                             "D": "2024-03-28"}
    assert ic.loc["A", "historical_revenue"] == pytest.approx(95.0)
    assert ic.loc["A", "orders"] == 3
    assert ic.loc["A", "avg_days_between_orders"] == pytest.approx(35.0)
    assert ic.loc["B", "avg_days_between_orders"] == pytest.approx(42.0)
    assert ic["segment"].to_dict() == {"A": "Champions", "B": "At Risk", "C": "At Risk", "D": "New Customers"}


def test_risk_categories_follow_thresholds(known_conn):
    ic = risk.inactive_customers(known_conn, ctx_for(known_conn, active_days=30, cooling_days=50,
                                                     at_risk_days=56)).set_index("customer_id")
    assert ic["risk_category"].to_dict() == {"A": "Active", "B": "Active", "C": "Lapsed", "D": "Active"}
    ic2 = risk.inactive_customers(known_conn, ctx_for(known_conn, end="2024-06-30")).set_index("customer_id")
    # 107, 120, 148 and 94 days inactive with defaults 60/120/240
    assert ic2["risk_category"].to_dict() == {"A": "Cooling", "B": "Cooling", "C": "At Risk", "D": "Cooling"}


def test_threshold_boundary_is_inclusive(known_conn):
    ic = risk.inactive_customers(known_conn, ctx_for(known_conn, active_days=16, cooling_days=29,
                                                     at_risk_days=57)).set_index("customer_id")
    assert ic.loc["A", "risk_category"] == "Active"
    assert ic.loc["B", "risk_category"] == "Cooling"
    assert ic.loc["C", "risk_category"] == "At Risk"


def test_overdue_flag_uses_own_rhythm(known_conn):
    ic = risk.inactive_customers(known_conn, ctx_for(known_conn, overdue_multiplier=0.4)).set_index("customer_id")
    # A: 16 > 0.4 * 35 = 14 -> overdue; B: 29 > 16.8 -> overdue; one-order customers never overdue
    assert ic["is_overdue"].to_dict() == {"A": 1, "B": 1, "C": 0, "D": 0}
    ic_default = risk.inactive_customers(known_conn, ctx_for(known_conn)).set_index("customer_id")
    assert ic_default["is_overdue"].sum() == 0


def test_value_tier(known_conn):
    ic = risk.inactive_customers(known_conn, ctx_for(known_conn)).set_index("customer_id")
    assert ic["value_tier"].to_dict() == {"C": "High", "B": "Medium", "A": "Low", "D": "Low"}


def test_risk_summary_totals(demo_conn, demo_ctx):
    ic = risk.inactive_customers(demo_conn, demo_ctx)
    s = risk.risk_summary(demo_conn, demo_ctx)
    assert list(s["risk_category"]) == [c for c in RISK_ORDER if c in set(ic["risk_category"])]
    assert s["customers"].sum() == len(ic)
    assert s["historical_revenue"].sum() == pytest.approx(ic["historical_revenue"].sum(), abs=0.1)
    assert s["customer_share_pct"].sum() == pytest.approx(100.0, abs=0.05)


def test_priority_win_back(demo_conn, demo_ctx):
    wb = risk.priority_win_back(demo_conn, demo_ctx, limit=10)
    assert len(wb) <= 10
    assert (wb["value_tier"] == "High").all()
    assert (wb["risk_category"].isin(["At Risk", "Lapsed"]) | (wb["is_overdue"] == 1)).all()
    assert wb["historical_revenue"].is_monotonic_decreasing


def test_invalid_risk_config():
    with pytest.raises(ValueError):
        RiskConfig(60, 50, 240).validate()
    with pytest.raises(ValueError):
        RiskConfig(overdue_multiplier=0).validate()

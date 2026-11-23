"""SQL revenue / behaviour queries checked against hand-calculated values
(dataset documented in tests/conftest.py) and against an independent pandas
re-computation on the synthetic dataset."""
from __future__ import annotations

import pandas as pd
import pytest

from src.analytics import behaviour, revenue
from src.analytics.context import AnalysisFilters, prepare_context
from src.sql.runner import list_queries, run_query


def test_all_queries_have_documentation_header():
    for name in list_queries():
        from src.sql.runner import QUERY_DIR
        text = (QUERY_DIR / f"{name}.sql").read_text(encoding="utf-8")
        assert text.startswith("-- ====="), name
        assert "Purpose" in text, name


def test_kpis_known(known_conn, known_ctx):
    k = revenue.kpis(known_conn, known_ctx)
    assert k["gross_sales"] == pytest.approx(475.0)
    assert k["returns_value"] == pytest.approx(10.0)
    assert k["net_revenue"] == pytest.approx(465.0)
    assert k["orders"] == 7
    assert k["active_customers"] == 4
    assert k["repeat_customers"] == 2
    assert k["new_customers"] == 4
    assert k["units_sold"] == 19
    assert k["avg_order_value"] == pytest.approx(round(475 / 7, 2))
    assert k["repeat_rate_pct"] == pytest.approx(50.0)
    assert k["return_rate_pct"] == pytest.approx(round(100 * 10 / 475, 2))
    assert k["revenue_per_customer"] == pytest.approx(116.25)


def test_kpis_date_filter(known_conn, known_ctx):
    k = revenue.kpis(known_conn, known_ctx, start="2024-03-01", end="2024-03-31")
    assert k["orders"] == 3 and k["gross_sales"] == pytest.approx(120.0)
    assert k["active_customers"] == 3          # A, B, D
    assert k["new_customers"] == 1             # only D first purchased in March


def test_kpi_comparison_previous_period(known_conn):
    ctx = prepare_context(known_conn, AnalysisFilters("2024-03-01", "2024-03-31"))
    comp = revenue.kpi_comparison(known_conn, ctx).set_index("metric")
    assert ctx.previous_period() == ("2024-01-30", "2024-02-29")
    assert comp.loc["orders", "previous"] == 2           # invoices 1002 and 1006
    assert comp.loc["net_revenue", "previous"] == pytest.approx(220.0)
    assert comp.loc["orders", "change_pct"] == pytest.approx(50.0)


def test_monthly_revenue_known(known_conn, known_ctx):
    m = revenue.monthly_revenue(known_conn, known_ctx).set_index("month")
    assert list(m.index) == ["2024-01", "2024-02", "2024-03"]
    assert list(m["gross_sales"]) == [125.0, 230.0, 120.0]
    assert list(m["returns_value"]) == [0.0, 10.0, 0.0]
    assert list(m["net_revenue"]) == [125.0, 220.0, 120.0]
    assert list(m["orders"]) == [2, 2, 3]
    assert list(m["new_customers"]) == [2, 1, 1]
    assert list(m["returning_customers"]) == [0, 1, 2]
    assert pd.isna(m.loc["2024-01", "net_revenue_mom_pct"])
    assert m.loc["2024-02", "net_revenue_mom_pct"] == pytest.approx(76.0)
    assert m.loc["2024-03", "net_revenue_mom_pct"] == pytest.approx(-45.45)


def test_revenue_by_customer_ranking(known_conn, known_ctx):
    c = revenue.revenue_by_customer(known_conn, known_ctx)
    assert list(c["customer_id"]) == ["C", "B", "A", "D"]
    assert list(c["net_revenue"]) == [200.0, 150.0, 95.0, 20.0]
    assert list(c["revenue_rank"]) == [1, 2, 3, 4]
    a = c.set_index("customer_id").loc["A"]
    assert a["orders"] == 3 and a["returns_value"] == 10.0
    assert a["avg_order_value"] == pytest.approx(round(105 / 3, 2))
    assert c["cumulative_share_pct"].iloc[-1] == pytest.approx(100.0)
    assert c["revenue_share_pct"].iloc[0] == pytest.approx(round(100 * 200 / 465, 3))


def test_revenue_concentration_tiers(known_conn, known_ctx):
    t = revenue.revenue_concentration(known_conn, known_ctx).set_index("top_pct")
    assert t.loc[1, "customers_in_tier"] == 1            # ceil(4 * 1%) = 1
    assert t.loc[1, "revenue_share_pct"] == pytest.approx(43.01)
    assert t.loc[50, "customers_in_tier"] == 2
    assert t.loc[50, "tier_revenue"] == pytest.approx(350.0)
    assert t.loc[50, "revenue_share_pct"] == pytest.approx(75.27)


def test_pareto_curve(known_conn, known_ctx):
    p = revenue.pareto_curve(known_conn, known_ctx)
    assert list(p["cumulative_customer_pct"]) == [25.0, 50.0, 75.0, 100.0]
    assert p["cumulative_revenue_pct"].iloc[0] == pytest.approx(43.011)
    assert p["cumulative_revenue_pct"].iloc[-1] == pytest.approx(100.0)


def test_product_and_category(known_conn, known_ctx):
    p = revenue.product_performance(known_conn, known_ctx).set_index("product_id")
    assert p.index[0] == "P5"
    mug = p.loc["P1"]
    assert (mug["units_sold"], mug["units_returned"], mug["net_revenue"]) == (5, 1, 40.0)
    assert mug["return_rate_pct"] == pytest.approx(20.0)
    cat = revenue.category_performance(known_conn, known_ctx).set_index("category")["net_revenue"].to_dict()
    assert cat == {"Decor": 350.0, "Lighting": 50.0, "Kitchen": 45.0, "Stationery": 20.0}


def test_country_performance(known_conn, known_ctx):
    c = revenue.country_performance(known_conn, known_ctx).set_index("country")
    uk = c.loc["UK"]
    assert (uk["customers"], uk["orders"], uk["gross_sales"], uk["returns_value"], uk["net_revenue"]) == \
        (2, 4, 125.0, 10.0, 115.0)


def test_repeat_vs_one_time(known_conn, known_ctx):
    r = revenue.repeat_vs_one_time(known_conn, known_ctx).set_index("customer_type")
    assert r.loc["Repeat", "customers"] == 2 and r.loc["One-time", "customers"] == 2
    assert r.loc["Repeat", "net_revenue"] == pytest.approx(245.0)
    assert r.loc["Repeat", "avg_order_value"] == pytest.approx(51.0)
    assert r.loc["One-time", "avg_order_value"] == pytest.approx(110.0)
    assert r.loc["Repeat", "revenue_share_pct"] == pytest.approx(52.69)


def test_purchase_frequency_bands(known_conn, known_ctx):
    f = behaviour.purchase_frequency(known_conn, known_ctx).set_index("frequency_band")
    assert f.loc["1 order", "customers"] == 2 and f.loc["1 order", "net_revenue"] == 220.0
    assert f.loc["2 orders", "customers"] == 1 and f.loc["3 orders", "customers"] == 1
    assert f.loc["11+ orders", "customers"] == 0            # empty bands are kept
    assert f["customers"].sum() == 4


def test_monthly_acquisition(known_conn, known_ctx):
    a = behaviour.monthly_acquisition(known_conn, known_ctx)
    assert list(a["new_customers"]) == [2, 1, 1]
    assert list(a["returning_customers"]) == [0, 1, 2]
    assert list(a["cumulative_new_customers"]) == [2, 3, 4]


def test_interpurchase_gaps(known_conn, known_ctx):
    g = behaviour.interpurchase_gaps(known_conn, known_ctx)
    gaps = {(r.customer_id, r.order_number): r.gap_days for r in g.itertuples()}
    assert gaps == {("A", 2): 36, ("A", 3): 34, ("B", 2): 42}   # 2024 is a leap year
    s = behaviour.interpurchase_summary(g)
    assert s["median_days"] == 36 and s["second_order_median_days"] == 39


def test_order_value_bands(known_conn, known_ctx):
    b = behaviour.order_value_bands(known_conn, known_ctx).set_index("value_band")["orders"].to_dict()
    assert b["Under 25"] == 1 and b["25-50"] == 2 and b["50-100"] == 2 and b["100-250"] == 2
    assert sum(b.values()) == 7


def test_weekday_hour(known_conn, known_ctx):
    w = behaviour.weekday_hour(known_conn, known_ctx)
    first = w[(w["weekday"] == "Fri") & (w["hour"] == 10)]       # 2024-01-05 was a Friday
    assert first["orders"].iloc[0] == 1
    assert w["orders"].sum() == 7


def test_segment_filter_restricts_sql(known_conn):
    ctx = prepare_context(known_conn, AnalysisFilters("2024-01-01", "2024-03-31", segments=("At Risk",)))
    k = revenue.kpis(known_conn, ctx)
    assert k["active_customers"] == 2       # B and C are At Risk (see test_rfm)
    assert k["gross_sales"] == pytest.approx(350.0)


def test_empty_period_returns_zeros(known_conn):
    ctx = prepare_context(known_conn, AnalysisFilters("2030-01-01", "2030-12-31"))
    k = revenue.kpis(known_conn, ctx)
    assert k["orders"] == 0 and k["net_revenue"] == 0 and k["avg_order_value"] == 0
    assert revenue.monthly_revenue(known_conn, ctx).empty
    assert revenue.revenue_concentration(known_conn, ctx).empty


# --------------------------------------------------------------- independent cross-check

def test_sql_matches_independent_pandas_on_synthetic_data(demo_conn, demo_ctx):
    tx = pd.read_sql_query("SELECT * FROM transactions", demo_conn)
    sales = tx[tx["is_return"] == 0]
    k = revenue.kpis(demo_conn, demo_ctx)
    assert k["gross_sales"] == pytest.approx(round(sales["revenue"].sum(), 2))
    assert k["net_revenue"] == pytest.approx(round(tx["revenue"].sum(), 2))
    assert k["orders"] == sales["invoice_id"].nunique()
    orders_per_customer = sales.groupby("customer_id")["invoice_id"].nunique()
    assert k["repeat_customers"] == int((orders_per_customer >= 2).sum())
    order_values = sales.groupby("invoice_id")["revenue"].sum()
    assert k["avg_order_value"] == pytest.approx(round(order_values.mean(), 2))

    by_customer = revenue.revenue_by_customer(demo_conn, demo_ctx).set_index("customer_id")["net_revenue"]
    expected = tx.groupby("customer_id")["revenue"].sum().round(2)
    pd.testing.assert_series_equal(by_customer.sort_index(), expected.sort_index(), check_names=False)

    monthly = revenue.monthly_revenue(demo_conn, demo_ctx).set_index("month")["net_revenue"]
    exp_month = tx.groupby("invoice_month")["revenue"].sum().round(2)
    pd.testing.assert_series_equal(monthly, exp_month, check_names=False, check_index_type=False)

    conc = revenue.revenue_concentration(demo_conn, demo_ctx).set_index("top_pct")
    positive = expected[expected > 0].sort_values(ascending=False)
    n10 = -(-len(positive) * 10 // 100)
    assert conc.loc[10, "revenue_share_pct"] == pytest.approx(round(100 * positive.head(n10).sum() / positive.sum(), 2))


def test_query_runner_uses_bound_parameters(known_conn):
    # A malicious-looking value is treated as data, not SQL.
    df = run_query(known_conn, "customer_orders", {"customer_id": "A' OR '1'='1", "end_date": "2099-01-01"})
    assert df.empty

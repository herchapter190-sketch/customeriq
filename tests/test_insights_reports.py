"""Insight engine, PDF report and Excel workbook generation, synthetic data generator."""
from __future__ import annotations

import io

import pytest
from openpyxl import load_workbook

from src.analytics import revenue
from src.analytics.context import AnalysisFilters, prepare_context
from src.database.connection import connect
from src.etl.synthetic import SYNTHETIC_LABEL, generate_demo_transactions
from src.insights.engine import generate_insights
from src.reports.excel_export import build_excel_workbook
from src.reports.pdf_report import build_pdf_report


# ----------------------------------------------------------------------- insights

def test_insights_have_all_four_parts(demo_conn, demo_ctx):
    insights = generate_insights(demo_conn, demo_ctx, "£")
    assert len(insights) >= 4
    for i in insights:
        assert i.observation and i.metric and i.why_it_matters and i.action
        assert i.kind in {"risk", "opportunity", "info"}
    kinds = [i.kind for i in insights]
    assert kinds == sorted(kinds, key={"risk": 0, "opportunity": 1, "info": 2}.get)


def test_insight_values_match_calculated_metrics(demo_conn, demo_ctx):
    by_key = {i.key: i for i in generate_insights(demo_conn, demo_ctx)}
    conc = revenue.revenue_concentration(demo_conn, demo_ctx).set_index("top_pct")
    assert by_key["revenue_concentration"].value == pytest.approx(conc.loc[10, "revenue_share_pct"])
    rep = revenue.repeat_vs_one_time(demo_conn, demo_ctx).set_index("customer_type")
    assert by_key["repeat_revenue_share"].value == pytest.approx(rep.loc["Repeat", "revenue_share_pct"])
    k = revenue.kpis(demo_conn, demo_ctx)
    assert by_key["returns_rate"].value == pytest.approx(k["return_rate_pct"])


def test_insights_skip_when_data_insufficient(known_conn, known_ctx):
    # Four customers is below every minimum-sample guard: nothing may be invented.
    keys = {i.key for i in generate_insights(known_conn, known_ctx)}
    assert not keys & {"revenue_concentration", "repeat_revenue_share", "first_month_retention",
                       "high_value_at_risk", "revenue_trend", "segment_aov", "second_order_timing"}


def test_insights_on_empty_database():
    conn = connect(":memory:")
    ctx = prepare_context(conn, AnalysisFilters("2024-01-01", "2024-12-31"))
    assert generate_insights(conn, ctx) == []


# ----------------------------------------------------------------------- PDF

def test_pdf_report_generated(demo_conn, demo_ctx):
    pdf = build_pdf_report(demo_conn, demo_ctx, "£")
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 15_000
    assert pdf.count(b"/Type /Page") - pdf.count(b"/Type /Pages") >= 5   # multi-page report


def test_pdf_report_empty_period(known_conn):
    ctx = prepare_context(known_conn, AnalysisFilters("2030-01-01", "2030-01-31"))
    pdf = build_pdf_report(known_conn, ctx)
    assert pdf[:5] == b"%PDF-"


def test_pdf_report_empty_database():
    conn = connect(":memory:")
    ctx = prepare_context(conn, AnalysisFilters("2024-01-01", "2024-12-31"))
    assert build_pdf_report(conn, ctx)[:5] == b"%PDF-"


def test_pdf_report_small_dataset(known_conn, known_ctx):
    assert build_pdf_report(known_conn, known_ctx)[:5] == b"%PDF-"


# ----------------------------------------------------------------------- Excel

def test_excel_workbook(demo_conn, demo_ctx):
    data = build_excel_workbook(demo_conn, demo_ctx, "£")
    wb = load_workbook(io.BytesIO(data))
    for sheet in ("About", "KPIs", "Segments", "RFM Customers", "Cohort Retention", "Inactive Customers"):
        assert sheet in wb.sheetnames
    assert "Synthetic" in str(wb["About"]["B4"].value)
    assert wb["RFM Customers"].max_row > 100


# ----------------------------------------------------------------------- synthetic data

def test_synthetic_generator_is_deterministic():
    a = generate_demo_transactions(n_customers=120, seed=11)
    b = generate_demo_transactions(n_customers=120, seed=11)
    c = generate_demo_transactions(n_customers=120, seed=12)
    assert a.equals(b)
    assert not a.equals(c)


def test_synthetic_data_contains_expected_patterns(demo_conn):
    q = demo_conn.execute
    assert q("SELECT COUNT(*) FROM transactions WHERE is_return = 1").fetchone()[0] > 0
    repeaters = q("SELECT COUNT(*) FROM (SELECT customer_id FROM transactions WHERE is_return = 0 "
                  "GROUP BY customer_id HAVING COUNT(DISTINCT invoice_id) >= 2)").fetchone()[0]
    assert repeaters > 50
    # Seasonality: Q4 revenue exceeds Q1 revenue in both years
    for y in ("2023", "2024"):
        q4 = q(f"SELECT SUM(revenue) FROM transactions WHERE invoice_month BETWEEN '{y}-10' AND '{y}-12'").fetchone()[0]
        q1 = q(f"SELECT SUM(revenue) FROM transactions WHERE invoice_month BETWEEN '{y}-01' AND '{y}-03'").fetchone()[0]
        assert q4 > q1
    # Inactive customers exist (no purchase in the final 240 days)
    lapsed = q("SELECT COUNT(*) FROM (SELECT customer_id, MAX(invoice_day) d FROM transactions GROUP BY customer_id "
               "HAVING d < '2024-05-05')").fetchone()[0]
    assert lapsed > 20


def test_synthetic_data_is_labelled_and_has_quality_issues(demo_conn):
    from src.database.connection import get_meta
    meta = get_meta(demo_conn)
    assert meta["is_synthetic"] is True and meta["data_label"] == SYNTHETIC_LABEL
    counts = meta["cleaning_summary"]["rejection_counts"]
    assert counts["duplicate_row"] > 0 and counts["missing_customer_id"] > 0 and counts["invalid_date"] > 0

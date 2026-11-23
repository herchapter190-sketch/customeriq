"""Cohort assignment, retention percentages, matrix shape and the average curve."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.analytics import cohorts
from src.analytics.context import AnalysisFilters, prepare_context
from src.database.connection import connect
from src.etl.pipeline import import_dataframe
from tests.conftest import KNOWN_MAPPING


def test_cohort_long_known(known_conn, known_ctx):
    long = cohorts.cohort_long(known_conn, known_ctx)
    got = {(r.cohort_month, r.month_index): (r.cohort_size, r.active_customers, r.retention_pct)
           for r in long.itertuples()}
    assert got == {
        ("2024-01", 0): (2, 2, 100.0),   # A, B
        ("2024-01", 1): (2, 1, 50.0),    # A bought in Feb (the Feb return does not count)
        ("2024-01", 2): (2, 2, 100.0),   # A and B bought in March
        ("2024-02", 0): (1, 1, 100.0),   # C
        ("2024-03", 0): (1, 1, 100.0),   # D
    }


def test_cohort_matrix_zero_vs_unobservable(known_conn, known_ctx):
    long = cohorts.cohort_long(known_conn, known_ctx)
    m = cohorts.cohort_matrix(long, "2024-03-31")
    assert list(m.index) == ["2024-01", "2024-02", "2024-03"]
    assert list(m.columns) == [0, 1, 2]
    assert m.loc["2024-02", 1] == 0.0                 # observable, nobody returned
    assert np.isnan(m.loc["2024-02", 2])              # beyond the data
    assert np.isnan(m.loc["2024-03", 1])
    counts = cohorts.cohort_matrix(long, "2024-03-31", value="active_customers")
    assert counts.loc["2024-01", 2] == 2


def test_average_retention_curve_weights_only_eligible_cohorts(known_conn, known_ctx):
    long = cohorts.cohort_long(known_conn, known_ctx)
    curve = cohorts.average_retention_curve(long, "2024-03-31").set_index("month_index")
    assert curve.loc[0, "retention_pct"] == 100.0
    # Month 1: Jan (2 customers, 1 returned) + Feb (1 customer, 0 returned) -> 1 / 3
    assert curve.loc[1, "eligible_customers"] == 3
    assert curve.loc[1, "retention_pct"] == pytest.approx(33.33)
    # Month 2: only the January cohort can be observed
    assert curve.loc[2, "eligible_customers"] == 2 and curve.loc[2, "retention_pct"] == 100.0


def test_date_filter_selects_cohorts_without_reassigning(known_conn):
    ctx = prepare_context(known_conn, AnalysisFilters("2024-02-01", "2024-03-31"))
    long = cohorts.cohort_long(known_conn, ctx)
    assert set(long["cohort_month"]) == {"2024-02", "2024-03"}
    # A first bought in January, so A must NOT appear in the February cohort
    feb = long[(long["cohort_month"] == "2024-02") & (long["month_index"] == 0)]
    assert feb["cohort_size"].iloc[0] == 1


def test_end_date_limits_observed_activity(known_conn):
    ctx = prepare_context(known_conn, AnalysisFilters("2024-01-01", "2024-02-29"))
    long = cohorts.cohort_long(known_conn, ctx)
    assert set(long["cohort_month"]) == {"2024-01", "2024-02"}
    assert long["month_index"].max() == 1


def test_monthly_retention_known(known_conn, known_ctx):
    m = cohorts.monthly_retention(known_conn, known_ctx).set_index("month")
    assert pd.isna(m.loc["2024-01", "retention_rate_pct"])
    assert (m.loc["2024-02", "prior_month_customers"], m.loc["2024-02", "retained_customers"]) == (2, 1)
    assert m.loc["2024-02", "retention_rate_pct"] == 50.0
    assert (m.loc["2024-03", "prior_month_customers"], m.loc["2024-03", "retained_customers"]) == (2, 1)


def test_retention_requires_consecutive_calendar_months():
    """A customer buying in Jan and Mar is NOT retained in March (Feb gap)."""
    rows = [("1", "X", "2024-01-10", "P", "n", "c", 1, 10.0, "UK"),
            ("2", "X", "2024-03-10", "P", "n", "c", 1, 10.0, "UK"),
            ("3", "Y", "2024-02-10", "P", "n", "c", 1, 10.0, "UK")]
    df = pd.DataFrame(rows, columns=["Invoice", "Customer", "Date", "SKU", "Name", "Category", "Qty", "Price",
                                     "Country"])
    conn = connect(":memory:")
    import_dataframe(conn, df, KNOWN_MAPPING, "gap test")
    ctx = prepare_context(conn, AnalysisFilters("2024-01-01", "2024-03-31"))
    m = cohorts.monthly_retention(conn, ctx).set_index("month")
    assert m.loc["2024-03", "retained_customers"] == 0
    long = cohorts.cohort_long(conn, ctx)
    jan = long[long["cohort_month"] == "2024-01"].set_index("month_index")
    assert 1 not in jan.index and jan.loc[2, "retention_pct"] == 100.0


def test_cohort_sizes_sum_to_customers(demo_conn, demo_ctx):
    long = cohorts.cohort_long(demo_conn, demo_ctx)
    n_customers = demo_conn.execute(
        "SELECT COUNT(DISTINCT customer_id) FROM transactions WHERE is_return = 0").fetchone()[0]
    assert cohorts.cohort_sizes(long).sum() == n_customers
    assert (long.loc[long["month_index"] == 0, "retention_pct"] == 100.0).all()
    assert long["retention_pct"].between(0, 100).all()


def test_empty_cohorts():
    assert cohorts.cohort_matrix(pd.DataFrame(), "2024-01-31").empty
    assert cohorts.average_retention_curve(pd.DataFrame(), "2024-01-31").empty

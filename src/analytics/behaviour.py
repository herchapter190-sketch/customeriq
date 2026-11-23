"""Customer behaviour analytics: frequency, timing, basket size and acquisition."""
from __future__ import annotations

import pandas as pd

from src.analytics.context import AnalysisContext
from src.sql.runner import run_query

WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def purchase_frequency(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "purchase_frequency", ctx.params())


def interpurchase_gaps(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "interpurchase_gaps", ctx.params())


def interpurchase_summary(gaps: pd.DataFrame) -> dict:
    """Distribution statistics of SQL-computed gaps (SQLite has no MEDIAN())."""
    if gaps.empty:
        return {"repeat_orders": 0, "median_days": None, "mean_days": None, "p25_days": None, "p75_days": None,
                "second_order_median_days": None}
    g = gaps["gap_days"]
    second = gaps.loc[gaps["order_number"] == 2, "gap_days"]
    return {
        "repeat_orders": int(len(g)),
        "median_days": float(g.median()),
        "mean_days": round(float(g.mean()), 1),
        "p25_days": float(g.quantile(0.25)),
        "p75_days": float(g.quantile(0.75)),
        "second_order_median_days": float(second.median()) if len(second) else None,
    }


def weekday_hour(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "weekday_hour", ctx.params())


def order_value_bands(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "order_value_bands", ctx.params())


def monthly_acquisition(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "monthly_acquisition", ctx.params())

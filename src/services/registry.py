"""Streamlit-independent registry of analytics functions.

Shared by the Streamlit UI (``src/ui/data.py``) and the local API (``src/api``) so both
call exactly the same calculations. Every entry takes ``(conn, ctx, **kwargs)``.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Callable

import pandas as pd

from src.analytics import behaviour, cohorts, revenue, risk
from src.analytics.context import AnalysisFilters, prepare_context
from src.database.connection import date_bounds, get_meta, has_data
from src.insights.engine import generate_insights
from src.segments import service as segments
from src.sql.runner import run_query


def _comparison(conn, ctx) -> dict:
    df = revenue.kpi_comparison(conn, ctx)
    return {"table": df, "previous_period": df.attrs["previous_period"],
            "previous_has_data": df.attrs["previous_has_data"]}


def _gini(conn, ctx) -> dict:
    """Same input as the Streamlit Revenue page: net revenue per customer."""
    return {"gini": revenue.gini_coefficient(revenue.revenue_by_customer(conn, ctx)["net_revenue"])}


def _retention_summary(conn, ctx) -> dict:
    """Customer-weighted average retention curve plus the month-1 / month-3 headline figures."""
    curve = cohorts.average_retention_curve(cohorts.cohort_long(conn, ctx), ctx.filters.end_date)

    def at(k: int):
        hit = curve.loc[curve["month_index"] == k, "retention_pct"]
        return float(hit.iloc[0]) if len(hit) and pd.notna(hit.iloc[0]) else None

    return {"curve": curve, "month_1_pct": at(1), "month_3_pct": at(3)}


FUNCTIONS: dict[str, Callable] = {
    "kpis": revenue.kpis,
    "kpi_comparison": lambda conn, ctx: _comparison(conn, ctx),
    "monthly_revenue": revenue.monthly_revenue,
    "revenue_by_customer": revenue.revenue_by_customer,
    "revenue_concentration": revenue.revenue_concentration,
    "pareto_curve": revenue.pareto_curve,
    "product_performance": revenue.product_performance,
    "category_performance": revenue.category_performance,
    "country_performance": revenue.country_performance,
    "repeat_vs_one_time": revenue.repeat_vs_one_time,
    "purchase_frequency": behaviour.purchase_frequency,
    "interpurchase_gaps": behaviour.interpurchase_gaps,
    "interpurchase_summary": lambda conn, ctx: behaviour.interpurchase_summary(behaviour.interpurchase_gaps(conn, ctx)),
    "gini_coefficient": _gini,
    "retention_summary": _retention_summary,
    "weekday_hour": behaviour.weekday_hour,
    "order_value_bands": behaviour.order_value_bands,
    "monthly_acquisition": behaviour.monthly_acquisition,
    "cohort_long": cohorts.cohort_long,
    "monthly_retention": cohorts.monthly_retention,
    "segment_summary": segments.segment_summary,
    "rfm_customers": segments.rfm_customers,
    "rfm_grid": segments.rfm_grid,
    "customer_orders": segments.customer_orders,
    "inactive_customers": risk.inactive_customers,
    "risk_summary": risk.risk_summary,
    "risk_by_segment": risk.risk_by_segment,
    "priority_win_back": risk.priority_win_back,
    "insights": lambda conn, ctx, currency="": generate_insights(conn, ctx, currency),
}

# Extra keyword arguments each function accepts (everything else takes none).
FUNCTION_KWARGS: dict[str, frozenset[str]] = {
    "customer_orders": frozenset({"customer_id"}),
    "priority_win_back": frozenset({"limit"}),
    "insights": frozenset({"currency"}),
}
REQUIRED_KWARGS: dict[str, frozenset[str]] = {"customer_orders": frozenset({"customer_id"})}


def run(conn: sqlite3.Connection, name: str, filters: AnalysisFilters, **kwargs) -> Any:
    """Prepare the context for ``filters`` and run analytics function ``name``."""
    ctx = prepare_context(conn, filters)
    return FUNCTIONS[name](conn, ctx, **kwargs)


def dataset_summary(conn: sqlite3.Connection) -> dict:
    """Presence, metadata, date bounds and overview of the active dataset."""
    info = {"has_data": has_data(conn), "meta": get_meta(conn), "bounds": date_bounds(conn)}
    info["overview"] = run_query(conn, "data_overview").iloc[0].to_dict() if info["has_data"] else {}
    return info

"""Cached access to the analytics layer for the Streamlit UI.

Every call opens a short-lived SQLite connection (cheap and thread-safe) and caches
the result keyed on the dataset version and the full filter state, so changing any
filter or loading a new dataset always produces fresh numbers.
"""
from __future__ import annotations

from typing import Any, Callable

import streamlit as st

from src.analytics import behaviour, cohorts, revenue, risk
from src.analytics.context import AnalysisFilters, prepare_context
from src.config import DEFAULT_DB_PATH
from src.database.connection import data_version, date_bounds, get_meta, has_data, session
from src.insights.engine import generate_insights
from src.segments import service as segments
from src.sql.runner import run_query

DB_PATH = DEFAULT_DB_PATH

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


def _comparison(conn, ctx) -> dict:
    df = revenue.kpi_comparison(conn, ctx)
    return {"table": df, "previous_period": df.attrs["previous_period"],
            "previous_has_data": df.attrs["previous_has_data"]}


@st.cache_data(show_spinner=False, max_entries=512)
def _cached(name: str, version: str, filters_key: str, _filters: AnalysisFilters, kwargs: tuple) -> Any:
    with session(DB_PATH) as conn:
        ctx = prepare_context(conn, _filters)
        return FUNCTIONS[name](conn, ctx, **dict(kwargs))


def get(name: str, filters: AnalysisFilters, **kwargs) -> Any:
    """Run analytics function ``name`` for ``filters`` (cached)."""
    return _cached(name, dataset_version(), repr(filters), filters, tuple(sorted(kwargs.items())))


def dataset_version() -> str:
    with session(DB_PATH) as conn:
        return data_version(conn)


@st.cache_data(show_spinner=False)
def dataset_info(version: str) -> dict:
    with session(DB_PATH) as conn:
        info = {"has_data": has_data(conn), "meta": get_meta(conn), "bounds": date_bounds(conn)}
        info["overview"] = run_query(conn, "data_overview").iloc[0].to_dict() if info["has_data"] else {}
        return info


def current_dataset() -> dict:
    return dataset_info(dataset_version())


def clear_caches() -> None:
    st.cache_data.clear()

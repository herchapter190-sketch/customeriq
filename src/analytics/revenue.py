"""Revenue analytics. Every figure comes from a SQL query in ``src/sql/queries``."""
from __future__ import annotations

import math
import sqlite3

import pandas as pd

from src.analytics.context import AnalysisContext
from src.sql.runner import run_query

KPI_FIELDS = ("net_revenue", "gross_sales", "returns_value", "orders", "active_customers",
              "new_customers", "repeat_customers", "avg_order_value", "units_sold")


def _clean_number(value):
    if value is None:
        return 0.0
    try:
        if math.isnan(value):
            return 0.0
    except TypeError:
        pass
    return float(value)


def kpis(conn: sqlite3.Connection, ctx: AnalysisContext, start: str | None = None, end: str | None = None) -> dict:
    params = ctx.params(**({"start_date": start} if start else {}), **({"end_date": end} if end else {}))
    row = run_query(conn, "kpi_summary", params).iloc[0].to_dict()
    out = {k: _clean_number(v) for k, v in row.items()}
    active = out["active_customers"]
    out["repeat_rate_pct"] = round(100.0 * out["repeat_customers"] / active, 2) if active else 0.0
    out["revenue_per_customer"] = round(out["net_revenue"] / active, 2) if active else 0.0
    out["return_rate_pct"] = round(100.0 * out["returns_value"] / out["gross_sales"], 2) if out["gross_sales"] else 0.0
    return out


def kpi_comparison(conn: sqlite3.Connection, ctx: AnalysisContext) -> pd.DataFrame:
    """Current vs previous equal-length period for each KPI."""
    current = kpis(conn, ctx)
    prev_start, prev_end = ctx.previous_period()
    previous = kpis(conn, ctx, start=prev_start, end=prev_end)
    rows = []
    for key in (*KPI_FIELDS, "repeat_rate_pct", "revenue_per_customer", "return_rate_pct"):
        cur, prev = current.get(key, 0.0), previous.get(key, 0.0)
        change = round(100.0 * (cur - prev) / abs(prev), 2) if prev else None
        rows.append({"metric": key, "current": cur, "previous": prev, "change_pct": change})
    df = pd.DataFrame(rows)
    df.attrs["previous_period"] = (prev_start, prev_end)
    df.attrs["previous_has_data"] = previous.get("orders", 0) > 0
    return df


def monthly_revenue(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "monthly_revenue", ctx.params())


def revenue_by_customer(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "revenue_by_customer", ctx.params())


def revenue_concentration(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "revenue_concentration", ctx.params())


def pareto_curve(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "pareto_curve", ctx.params())


def product_performance(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "product_performance", ctx.params())


def category_performance(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "category_performance", ctx.params())


def country_performance(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "country_performance", ctx.params())


def repeat_vs_one_time(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "repeat_purchase", ctx.params())


def gini_coefficient(customer_revenue: pd.Series) -> float | None:
    """Gini coefficient of positive customer revenue (0 = equal, 1 = concentrated).

    Computed from SQL output; a summary statistic, not a re-implementation of a query.
    """
    values = customer_revenue[customer_revenue > 0].sort_values().to_numpy()
    n = len(values)
    if n < 2 or values.sum() == 0:
        return None
    cum = values.cumsum()
    return round(float((n + 1 - 2 * (cum.sum() / cum[-1])) / n), 4)

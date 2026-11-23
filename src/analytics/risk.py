"""Rule-based inactivity / risk indicators.

These are transparent business rules over recency and each customer's own purchase
rhythm. They are NOT a churn prediction model: no labelled churn outcomes exist in a
transaction log, so no predictive accuracy is claimed.
"""
from __future__ import annotations

import pandas as pd

from src.analytics.context import AnalysisContext
from src.config import RISK_ORDER
from src.sql.runner import load_sql, run_sql, run_query


def inactive_customers(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "inactive_customers", ctx.params())


def _inactive_subquery() -> str:
    return load_sql("inactive_customers").strip().rstrip(";")


def risk_summary(conn, ctx: AnalysisContext) -> pd.DataFrame:
    """Customers and historical revenue per risk category (SQL over the reusable query)."""
    sql = f"""
    WITH ic AS ({_inactive_subquery()})
    SELECT
        risk_category,
        COUNT(*)                                         AS customers,
        ROUND(SUM(historical_revenue), 2)                AS historical_revenue,
        ROUND(AVG(days_inactive), 1)                     AS avg_days_inactive,
        ROUND(AVG(orders), 2)                            AS avg_orders,
        SUM(is_overdue)                                  AS overdue_customers,
        SUM(CASE WHEN value_tier = 'High' THEN 1 ELSE 0 END) AS high_value_customers,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS customer_share_pct,
        ROUND(100.0 * SUM(historical_revenue) / NULLIF(SUM(SUM(historical_revenue)) OVER (), 0), 2)
                                                         AS revenue_share_pct
    FROM ic
    GROUP BY risk_category
    """
    df = run_sql(conn, sql, ctx.params())
    order = {name: i for i, name in enumerate(RISK_ORDER)}
    return df.sort_values("risk_category", key=lambda s: s.map(order)).reset_index(drop=True)


def risk_by_segment(conn, ctx: AnalysisContext) -> pd.DataFrame:
    """Historical revenue by RFM segment x risk category."""
    sql = f"""
    WITH ic AS ({_inactive_subquery()})
    SELECT segment, risk_category, COUNT(*) AS customers,
           ROUND(SUM(historical_revenue), 2) AS historical_revenue
    FROM ic
    GROUP BY segment, risk_category
    ORDER BY segment, risk_category
    """
    return run_sql(conn, sql, ctx.params())


def priority_win_back(conn, ctx: AnalysisContext, limit: int = 25) -> pd.DataFrame:
    """High-value customers who are At Risk or Lapsed, or overdue versus their own rhythm."""
    sql = f"""
    WITH ic AS ({_inactive_subquery()})
    SELECT * FROM ic
    WHERE value_tier = 'High'
      AND (risk_category IN ('At Risk', 'Lapsed') OR is_overdue = 1)
    ORDER BY historical_revenue DESC
    LIMIT :limit
    """
    return run_sql(conn, sql, ctx.params(limit=int(limit)))

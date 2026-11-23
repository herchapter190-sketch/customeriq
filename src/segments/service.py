"""Segment-level views over the materialised RFM run."""
from __future__ import annotations

import pandas as pd

from src.analytics.context import AnalysisContext
from src.config import SEGMENT_ORDER
from src.sql.runner import run_query


def _order(df: pd.DataFrame, column: str = "segment") -> pd.DataFrame:
    rank = {name: i for i, name in enumerate(SEGMENT_ORDER)}
    return df.sort_values(column, key=lambda s: s.map(lambda v: rank.get(v, 99))).reset_index(drop=True)


def segment_summary(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return _order(run_query(conn, "segment_summary", ctx.params()))


def rfm_customers(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "rfm_customers", ctx.params())


def rfm_grid(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "rfm_grid", ctx.params())


def segment_activity_trend(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "segment_activity_trend", ctx.params())


def customer_orders(conn, ctx: AnalysisContext, customer_id: str) -> pd.DataFrame:
    return run_query(conn, "customer_orders", {"customer_id": str(customer_id), "end_date": ctx.filters.end_date})

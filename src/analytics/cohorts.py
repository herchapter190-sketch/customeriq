"""Monthly cohort retention.

The SQL query ``cohort_retention`` produces the long-format table. This module only
reshapes it into a matrix and marks cells that cannot be observed yet (a cohort
acquired in November cannot have a month-3 value when the data ends in December).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.analytics.context import AnalysisContext
from src.sql.runner import run_query


def _month_num(ym: str) -> int:
    year, month = ym.split("-")
    return int(year) * 12 + int(month) - 1


def cohort_long(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "cohort_retention", ctx.params())


def cohort_matrix(long: pd.DataFrame, end_date: str, value: str = "retention_pct",
                  max_months: int | None = None) -> pd.DataFrame:
    """Pivot to cohort x month_index.

    Observable cells with no returning customers are 0; cells beyond the end of the
    data are NaN, so they are not mistaken for zero retention.
    """
    if long.empty:
        return pd.DataFrame()
    end_num = _month_num(end_date[:7])
    cohorts = sorted(long["cohort_month"].unique())
    horizon = max(end_num - _month_num(c) for c in cohorts)
    if max_months is not None:
        horizon = min(horizon, max_months)
    matrix = long.pivot_table(index="cohort_month", columns="month_index", values=value, aggfunc="first")
    matrix = matrix.reindex(index=cohorts, columns=range(horizon + 1))
    for cohort in cohorts:
        observable = end_num - _month_num(cohort)
        row = matrix.loc[cohort]
        row[row.index <= observable] = row[row.index <= observable].fillna(0)
        row[row.index > observable] = np.nan
        matrix.loc[cohort] = row
    matrix.columns = [int(c) for c in matrix.columns]
    return matrix


def cohort_sizes(long: pd.DataFrame) -> pd.Series:
    if long.empty:
        return pd.Series(dtype=float)
    return long.groupby("cohort_month")["cohort_size"].first()


def average_retention_curve(long: pd.DataFrame, end_date: str, max_months: int | None = None) -> pd.DataFrame:
    """Customer-weighted average retention by month index.

    Only cohorts old enough to be observed at a given month index are included in the
    denominator for that index.
    """
    if long.empty:
        return pd.DataFrame(columns=["month_index", "eligible_customers", "active_customers", "retention_pct"])
    active = cohort_matrix(long, end_date, value="active_customers", max_months=max_months)
    sizes = cohort_sizes(long).reindex(active.index)
    rows = []
    for k in active.columns:
        observable = active[k].notna()
        eligible = int(sizes[observable].sum())
        returned = int(active.loc[observable, k].sum())
        rows.append({"month_index": int(k), "cohorts": int(observable.sum()), "eligible_customers": eligible,
                     "active_customers": returned,
                     "retention_pct": round(100.0 * returned / eligible, 2) if eligible else np.nan})
    return pd.DataFrame(rows)


def monthly_retention(conn, ctx: AnalysisContext) -> pd.DataFrame:
    return run_query(conn, "monthly_retention", ctx.params())

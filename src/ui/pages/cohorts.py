"""3. Cohort Retention."""
from __future__ import annotations

import numpy as np
import plotly.graph_objects as go
import streamlit as st

from src.analytics.cohorts import average_retention_curve, cohort_matrix, cohort_sizes
from src.ui import data, state
from src.ui.components import csv_download, explain, pct
from src.ui.pages._common import no_rows, require_filters, show
from src.ui.story import first_insight, story_banner, takeaway
from src.ui.theme import ACCENT, NAVY, SEQUENTIAL


def _retention_summary(curve) -> str:
    """'Out of every 100 new customers...' sentence from the customer-weighted average curve."""
    def at(n):
        s = curve.loc[curve["month_index"] == n, "retention_pct"].dropna()
        return float(s.iloc[0]) if len(s) else None
    m1, m3 = at(1), at(3)
    if m1 is None:
        return ""
    line = (f"Out of every 100 new customers, about <b>{m1:.0f}</b> buy again in the month after their first "
            f"order, so roughly <b>{100 - m1:.0f}</b> do not")
    if m3 is not None:
        line += f". Three months on, about <b>{m3:.0f}</b> in 100 are buying in that month"
    return line + "."


def render() -> None:
    filters = require_filters("Cohort Retention", "How many new customers come back, and how many you lose.")
    if filters is None:
        return
    long = data.get("cohort_long", filters)
    if long.empty:
        story_banner("cohorts")
        no_rows("No acquisition cohorts start inside the selected period.")
        return
    base = average_retention_curve(long, filters.end_date, max_months=12)
    story_banner("cohorts", _retention_summary(base))
    takeaway(first_insight(data.get("insights", filters, currency=state.currency()), "Retention", "Behaviour"))

    c1, c2 = st.columns([1, 1])
    metric = c1.radio("Show", ["Retention %", "Returning customers"], horizontal=True, key="cohort_metric")
    horizon = int(long["month_index"].max())
    max_months = c2.slider("Months after acquisition", 3, max(horizon, 3), min(12, max(horizon, 3)),
                           key="cohort_horizon")
    value = "retention_pct" if metric == "Retention %" else "active_customers"
    matrix = cohort_matrix(long, filters.end_date, value=value, max_months=max_months)
    sizes = cohort_sizes(long)
    curve = average_retention_curve(long, filters.end_date, max_months=max_months)

    m1 = curve.loc[curve["month_index"] == 1, "retention_pct"]
    m3 = curve.loc[curve["month_index"] == 3, "retention_pct"]
    a, b, c = st.columns(3)
    a.metric("Cohorts", f"{len(matrix):,}", border=True)
    b.metric("Month-1 retention", pct(m1.iloc[0]) if len(m1) else "n/a", border=True,
             help="Customer-weighted average across all cohorts old enough to be observed at month 1.")
    c.metric("Month-3 retention", pct(m3.iloc[0]) if len(m3) else "n/a", border=True,
             help="Customer-weighted average across all cohorts old enough to be observed at month 3.")

    z = matrix.drop(columns=[0]) if metric == "Retention %" else matrix
    text = z.map(lambda v: "" if np.isnan(v) else (f"{v:.0f}%" if metric == "Retention %" else f"{int(v)}"))
    y_labels = [f"{c}  (n={int(sizes.get(c, 0))})" for c in z.index]
    fig = go.Figure(go.Heatmap(
        z=z.values, x=[f"M{c}" for c in z.columns], y=y_labels, colorscale=SEQUENTIAL,
        zmin=0, zmax=float(np.nanpercentile(z.values, 98)) if np.isfinite(z.values).any() else 1,
        text=text.values, texttemplate="%{text}", textfont=dict(size=10), xgap=1.5, ygap=1.5,
        colorbar=dict(title=dict(text="%" if metric == "Retention %" else "Customers"), thickness=10),
        hovertemplate="Cohort %{y}<br>%{x}: %{z:.1f}<extra></extra>" if metric == "Retention %"
        else "Cohort %{y}<br>%{x}: %{z} customers<extra></extra>"))
    fig.update_layout(title="Cohort retention matrix" + (" (month 0 = 100%, omitted)" if metric == "Retention %" else ""))
    fig.update_yaxes(autorange="reversed", title=None, tickfont=dict(size=10))
    fig.update_xaxes(title="Months since first purchase", side="top")
    show(fig, max(360, 26 * len(z) + 120), key="cohort_heat")
    explain("Each row is the customers who first bought in that month (n = how many). Moving right, each square "
            "shows the share who bought again 1, 2, 3... months later. Darker means more came back.",
            "Rows that fade quickly are customers you are losing early; a first follow-up after their first order "
            "is usually the cheapest moment to win them back. Blank squares are months not reached yet.")

    left, right = st.columns(2, gap="large")
    with left:
        cv = curve.dropna(subset=["retention_pct"])
        f2 = go.Figure()
        f2.add_scatter(x=cv["month_index"], y=cv["retention_pct"], mode="lines+markers", line=dict(color=NAVY, width=2.5),
                       customdata=cv[["eligible_customers", "cohorts"]],
                       hovertemplate="Month %{x}: %{y:.1f}%<br>%{customdata[0]:,} customers in %{customdata[1]} "
                                     "cohorts<extra></extra>", name="Retention")
        f2.update_layout(title="Average retention curve (customer-weighted)", yaxis_ticksuffix="%",
                         xaxis_title="Months since first purchase", yaxis_rangemode="tozero", showlegend=False)
        show(f2, 340, key="cohort_curve")
        explain("All rows above averaged into one line.", "The steepest drop shows when you lose most customers.")
    with right:
        mr = data.get("monthly_retention", filters).dropna(subset=["retention_rate_pct"])
        f3 = go.Figure()
        f3.add_scatter(x=mr["month"], y=mr["retention_rate_pct"], mode="lines+markers", line=dict(color=ACCENT, width=2),
                       customdata=mr[["retained_customers", "prior_month_customers"]],
                       hovertemplate="%{x}: %{y:.1f}%<br>%{customdata[0]:,} of %{customdata[1]:,} prior-month "
                                     "customers returned<extra></extra>")
        f3.update_layout(title="Month-over-month customer retention", yaxis_ticksuffix="%", showlegend=False,
                         yaxis_rangemode="tozero")
        show(f3, 340, key="cohort_mom")
        explain("Of the customers who ordered last month, the share who ordered again this month.",
                "A falling line means fewer regulars are coming back each month.")

    with st.expander("Cohort data table", icon=":material/table:"):
        out = matrix.copy()
        out.columns = [f"M{c}" for c in out.columns]
        out.insert(0, "cohort_size", sizes.reindex(out.index).astype(int))
        st.dataframe(out, width="stretch")
        csv_download(out.reset_index(), "customeriq_cohort_matrix.csv", key="dl_cohort")
    with st.expander("Methodology", icon=":material/info:"):
        st.markdown(
            "- **Cohort month**: month of the customer's first sales order across the entire dataset, so the date "
            "filter never re-assigns a customer to a later cohort.\n"
            "- **Active in month N**: at least one sales order (returns excluded) in calendar month cohort + N.\n"
            "- **Retention %** = active customers in month N / cohort size.\n"
            "- **Average curve**: total returning customers / total eligible customers, where only cohorts old "
            "enough to be observed at month N are eligible.\n"
            "- Calculated in SQL (`src/sql/queries/cohort_retention.sql`); validated against hand-computed test "
            "datasets in `tests/test_cohorts.py`.")

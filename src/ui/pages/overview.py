"""1. Executive Overview."""
from __future__ import annotations

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

from src.ui import data, state
from src.ui.components import delta_text, explain, money, note, number, pct
from src.ui.pages._common import no_rows, require_filters, show
from src.ui.story import action_card, story_banner
from src.ui.theme import ACCENT, NAVY

KPI_HELP = {
    "net_revenue": "Gross sales minus the value of returned items, for transactions in the selected period.",
    "orders": "Number of distinct sales invoices. Return invoices are not counted as orders.",
    "active_customers": "Customers with at least one sales order in the period.",
    "avg_order_value": "Gross sales divided by the number of orders (returns excluded).",
    "new_customers": "Customers whose first-ever purchase falls within the period.",
    "repeat_rate_pct": "Share of active customers who placed two or more orders within the period.",
    "revenue_per_customer": "Net revenue divided by active customers.",
    "return_rate_pct": "Value of returns as a share of gross sales.",
}


def _headline(table, has_prev: bool, cur: str) -> str:
    """One plain-English sentence summarising revenue and customers for the hero banner."""
    rev, cust = table.loc["net_revenue"], table.loc["active_customers"]
    unit = "" if cur else " <span style='opacity:.7;font-size:.85em'>(currency not specified)</span>"
    line = (f"<b>{money(rev['current'], cur)}</b>{unit} in revenue after returns, from "
            f"<b>{number(cust['current'])}</b> customers")
    change = rev["change_pct"]
    if has_prev and change == change:  # not NaN
        word = "up" if change >= 0 else "down"
        line += f", {word} <b>{abs(change):.0f}%</b> on the previous period of the same length"
    return line + "."


def render() -> None:
    filters = require_filters("Executive Overview", "How your business is doing, and what to do about it.")
    if filters is None:
        return
    cur = state.currency()
    info = data.current_dataset()
    if info["meta"].get("is_synthetic"):
        note("<b>Synthetic demo data.</b> All customers and transactions are generated for demonstration. "
             "Findings describe the simulation, not a real business.")

    comp = data.get("kpi_comparison", filters)
    table = comp["table"].set_index("metric")
    if table.loc["orders", "current"] == 0:
        no_rows()
        return
    has_prev = comp["previous_has_data"]

    def metric(col, key, label, fmt, inverse=False):
        row = table.loc[key]
        col.metric(label, fmt(row["current"]), delta_text(row["change_pct"]) if has_prev else None,
                   delta_color="inverse" if inverse else "normal", help=KPI_HELP[key], border=True)

    insights = data.get("insights", filters, currency=cur)
    story_banner("overview", _headline(table, has_prev, cur))

    st.subheader("What to do next")
    if insights:
        cols = st.columns(min(3, len(insights)))
        for i, ins in enumerate(insights[:3]):
            with cols[i]:
                action_card(i + 1, ins)
        st.caption("Each recommendation comes from simple, transparent rules applied to your figures. "
                   "The full list with reasoning is on Reports & Exports.")
    else:
        st.caption("Not enough data yet to suggest actions for this selection.")

    st.subheader("The headline numbers")
    c = st.columns(4)
    metric(c[0], "net_revenue", "Revenue (after returns)", lambda v: money(v, cur))
    metric(c[1], "active_customers", "Customers who bought", number)
    metric(c[2], "new_customers", "New customers", number)
    metric(c[3], "repeat_rate_pct", "Came back to buy again", pct)
    with st.expander("More numbers", icon=":material/add_chart:"):
        c = st.columns(4)
        metric(c[0], "orders", "Orders", number)
        metric(c[1], "avg_order_value", "Average order value", lambda v: money(v, cur))
        metric(c[2], "revenue_per_customer", "Revenue per customer", lambda v: money(v, cur))
        metric(c[3], "return_rate_pct", "Return rate", pct, inverse=True)
    p0, p1 = comp["previous_period"]
    st.caption(f"Arrows compare with the previous period of the same length ({p0} to {p1})." if has_prev else
               f"No sales exist in the previous period ({p0} to {p1}), so no comparison is shown.")

    st.subheader("How things are trending")
    monthly = data.get("monthly_revenue", filters)
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    fig.add_bar(x=monthly["month"], y=monthly["net_revenue"], name="Net revenue", marker_color=NAVY,
                hovertemplate=f"%{{x}}<br>Net revenue: {cur}%{{y:,.0f}}<extra></extra>")
    fig.add_scatter(x=monthly["month"], y=monthly["active_customers"], name="Active customers", mode="lines+markers",
                    line=dict(color=ACCENT, width=2), marker=dict(size=5), secondary_y=True,
                    hovertemplate="%{x}<br>Active customers: %{y:,}<extra></extra>")
    fig.update_layout(title="Monthly net revenue and active customers")
    fig.update_yaxes(title_text=f"Net revenue ({cur or 'currency not specified'})", secondary_y=False, tickformat=",.0f",
                     rangemode="tozero")
    fig.update_yaxes(title_text="Active customers", secondary_y=True, showgrid=False,
                     rangemode="tozero", tickformat=",d")
    show(fig, 380, key="ov_monthly")
    explain("Bars are revenue for each month (left scale); the line is how many different customers bought "
            "that month (right scale).",
            "When the line and bars rise together, growth comes from more customers. Bars rising while the line "
            "stays flat means existing customers are spending more.")

    left, right = st.columns(2, gap="large")
    with left:
        seg = data.get("segment_summary", filters)
        if not seg.empty:
            seg = seg.iloc[::-1]
            f2 = go.Figure()
            f2.add_bar(y=seg["segment"], x=seg["customer_share_pct"], name="Share of customers", orientation="h",
                       marker_color="#E3CDB0", hovertemplate="%{y}: %{x:.1f}% of customers<extra></extra>")
            f2.add_bar(y=seg["segment"], x=seg["revenue_share_pct"], name="Share of revenue", orientation="h",
                       marker_color=NAVY, hovertemplate="%{y}: %{x:.1f}% of revenue<extra></extra>")
            f2.update_layout(title="Customer groups: share of customers vs revenue", barmode="group", xaxis_ticksuffix="%")
            show(f2, 380, key="ov_seg")
            explain("Pale bars: how many of your customers are in each group. Dark bars: how much of your "
                    "revenue that group brings in.",
                    "Groups whose dark bar is much longer than their pale bar are your most valuable customers; "
                    "protect them first.")
    with right:
        acq = data.get("monthly_acquisition", filters)
        f3 = go.Figure()
        f3.add_bar(x=acq["month"], y=acq["returning_customers"], name="Returning", marker_color=NAVY)
        f3.add_bar(x=acq["month"], y=acq["new_customers"], name="New", marker_color="#E66B43")
        f3.update_layout(title="New vs returning customers by month", barmode="stack", yaxis_title="Customers")
        show(f3, 380, key="ov_acq")
        explain("Each bar is the customers who bought that month: orange are first-time buyers, dark are "
                "people who had bought before.",
                "A healthy business keeps the dark part steady or growing. If only the orange part grows, you "
                "are winning customers but not keeping them.")


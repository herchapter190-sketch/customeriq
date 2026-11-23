"""5. Customer Behaviour."""
from __future__ import annotations

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

from src.analytics.behaviour import WEEKDAY_ORDER, interpurchase_summary
from src.ui import data, state
from src.ui.components import money, note, number
from src.ui.pages._common import no_rows, require_filters, show
from src.ui.theme import ACCENT, NAVY, SEQUENTIAL


def render() -> None:
    filters = require_filters("Customer Behaviour", "Purchase frequency, repeat behaviour, timing and basket size")
    if filters is None:
        return
    cur = state.currency()
    freq = data.get("purchase_frequency", filters)
    if freq["customers"].sum() == 0:
        no_rows()
        return

    rep = data.get("repeat_vs_one_time", filters).set_index("customer_type")
    gaps = data.get("interpurchase_gaps", filters)
    summary = interpurchase_summary(gaps)
    cols = st.columns(4)
    if "Repeat" in rep.index:
        r = rep.loc["Repeat"]
        cols[0].metric("Repeat customers", number(r["customers"]), f"{r['customer_share_pct']:.1f}% of active",
                       delta_color="off", delta_arrow="off", border=True,
                       help="Customers with 2+ orders in their history up to the end date who bought in the period.")
        cols[1].metric("Repeat revenue share", f"{r['revenue_share_pct']:.1f}%", border=True,
                       help="Share of period net revenue from repeat customers.")
    if "Repeat" in rep.index and "One-time" in rep.index:
        ratio = rep.loc["Repeat", "avg_order_value"] / rep.loc["One-time", "avg_order_value"]
        cols[2].metric("Repeat vs one-time AOV", f"{ratio:.2f}x", border=True,
                       help=f"Repeat AOV {money(rep.loc['Repeat', 'avg_order_value'], cur)} vs one-time "
                            f"{money(rep.loc['One-time', 'avg_order_value'], cur)}.")
    cols[3].metric("Median days between orders",
                   f"{summary['median_days']:.0f}" if summary["median_days"] is not None else "n/a", border=True,
                   help="Median gap between consecutive orders by the same customer (orders in the period).")

    left, right = st.columns(2)
    with left:
        fig = make_subplots(specs=[[{"secondary_y": True}]])
        fig.add_bar(x=freq["frequency_band"], y=freq["customers"], name="Customers", marker_color=NAVY,
                    hovertemplate="%{x}: %{y:,} customers<extra></extra>")
        fig.add_scatter(x=freq["frequency_band"], y=freq["revenue_share_pct"], name="Share of revenue",
                        mode="lines+markers", line=dict(color=ACCENT, width=2), secondary_y=True,
                        hovertemplate="%{x}: %{y:.1f}% of revenue<extra></extra>")
        fig.update_layout(title="Purchase frequency distribution")
        fig.update_yaxes(title_text="Customers", secondary_y=False)
        fig.update_yaxes(title_text="Share of revenue", ticksuffix="%", secondary_y=True, showgrid=False,
                         rangemode="tozero")
        show(fig, 360, key="beh_freq")
    with right:
        if gaps.empty:
            no_rows("No customer placed more than one order in this period.")
        else:
            clipped = gaps["gap_days"].clip(upper=365)
            fig = go.Figure(go.Histogram(x=clipped, xbins=dict(start=0, end=371, size=14), marker_color="#9A4A66",
                                         hovertemplate="%{x} days<br>%{y:,} repeat orders<extra></extra>"))
            if summary["median_days"] is not None:
                fig.add_vline(x=summary["median_days"], line=dict(color=ACCENT, dash="dash"),
                              annotation_text=f"median {summary['median_days']:.0f} days", annotation_position="top right")
            fig.update_layout(title="Days between consecutive orders", xaxis_title="Days (gaps over 365 shown at 365)",
                              yaxis_title="Repeat orders", bargap=0.05)
            show(fig, 360, key="beh_gaps")
    if summary["second_order_median_days"] is not None:
        note(f"Customers who placed a second order did so a median of <b>{summary['second_order_median_days']:.0f} "
             f"days</b> after their first. The middle half of all repeat gaps fall between "
             f"{summary['p25_days']:.0f} and {summary['p75_days']:.0f} days.")

    left, right = st.columns(2)
    with left:
        wh = data.get("weekday_hour", filters)
        if not wh.empty:
            pivot = wh.pivot_table(index="weekday", columns="hour", values="orders", aggfunc="sum", fill_value=0)
            pivot = pivot.reindex(index=[d for d in WEEKDAY_ORDER if d in pivot.index])
            fig = go.Figure(go.Heatmap(z=pivot.values, x=list(pivot.columns), y=pivot.index,
                                       colorscale=SEQUENTIAL, xgap=1, ygap=1, colorbar=dict(thickness=10),
                                       hovertemplate="%{y} %{x}<br>%{z:,} orders<extra></extra>"))
            fig.update_layout(title="When orders are placed (weekday x hour)")
            fig.update_xaxes(title="Hour of day", dtick=2)
            fig.update_yaxes(autorange="reversed")
            show(fig, 340, key="beh_when")
    with right:
        bands = data.get("order_value_bands", filters)
        fig = go.Figure(go.Bar(x=bands["value_band"], y=bands["orders"], marker_color=NAVY,
                               customdata=bands[["avg_lines_per_order", "avg_units_per_order", "order_share_pct"]],
                               hovertemplate="%{x}<br>%{y:,} orders (%{customdata[2]:.1f}%)<br>"
                                             "Avg lines: %{customdata[0]:.1f}<br>Avg units: %{customdata[1]:.1f}"
                                             "<extra></extra>"))
        fig.update_layout(title=f"Orders by order value ({cur or 'currency units'})", xaxis_title="Order value band")
        show(fig, 340, key="beh_bands")

    acq = data.get("monthly_acquisition", filters)
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    fig.add_bar(x=acq["month"], y=acq["new_customers"], name="New customers", marker_color="#E66B43")
    fig.add_bar(x=acq["month"], y=acq["returning_customers"], name="Returning customers", marker_color=NAVY)
    fig.add_scatter(x=acq["month"], y=acq["cumulative_new_customers"], name="Cumulative new customers",
                    mode="lines", line=dict(color=ACCENT, width=2), secondary_y=True)
    fig.update_layout(title="Monthly customer acquisition", barmode="group")
    fig.update_yaxes(title_text="Customers in month", secondary_y=False)
    fig.update_yaxes(title_text="Cumulative new", secondary_y=True, showgrid=False, rangemode="tozero",
                     tickformat=",d")
    show(fig, 380, key="beh_acq")

    with st.expander("Repeat vs one-time comparison table", icon=":material/table:"):
        st.dataframe(rep.reset_index(), hide_index=True, width="stretch", column_config={
            "customer_type": "Customer type", "customers": "Customers", "orders": "Orders",
            "net_revenue": st.column_config.NumberColumn("Net revenue", format="localized"),
            "avg_order_value": st.column_config.NumberColumn("AOV", format="%.2f"),
            "orders_per_customer": "Orders per customer", "customer_share_pct": "Customer share %",
            "revenue_share_pct": "Revenue share %"})
        st.caption("Repeat = two or more orders in the customer's history up to the end date. "
                   "Orders and revenue are measured within the selected period.")

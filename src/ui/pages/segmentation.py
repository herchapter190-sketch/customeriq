"""2. Customer Segmentation (RFM)."""
from __future__ import annotations

import html
import plotly.graph_objects as go
import streamlit as st

from src.config import RFMConfig
from src.segments.rfm import build_rfm_sql, segment_definitions
from src.ui import data, state
from src.ui.components import csv_download, explain, money, note, search_filter
from src.ui.pages._common import no_rows, require_filters, show
from src.ui.story import first_insight, story_banner, takeaway
from src.ui.theme import NAVY, SEGMENT_COLORS, SEQUENTIAL


def _config_editor() -> None:
    cfg: RFMConfig = st.session_state["rfm_config"]
    with st.expander("Scoring rules (configurable)", icon=":material/tune:"):
        st.markdown(
            "Each customer receives a **1-5 score** for Recency (days since last order), Frequency (distinct "
            "orders) and Monetary (net revenue). **Quantile** scoring ranks customers against each other with "
            "`PERCENT_RANK()` (ties share a score). **Fixed** scoring uses the absolute cut points below. "
            "Segments are then assigned by the ordered rules in the table further down the page.")
        with st.form("rfm_form"):
            method = st.radio("Scoring method", ["quantile", "fixed"], index=0 if cfg.method == "quantile" else 1,
                              horizontal=True, format_func=lambda m: {"quantile": "Quantile (relative)",
                                                                       "fixed": "Fixed thresholds (absolute)"}[m])
            st.caption("Fixed thresholds: four ascending cut points. Recency: at or below the first cut scores 5. "
                       "Frequency and monetary: at or below the first cut scores 1.")
            c1, c2, c3 = st.columns(3)
            rec = c1.text_input("Recency cut points (days)", ", ".join(str(int(v)) for v in cfg.recency_thresholds))
            fre = c2.text_input("Frequency cut points (orders)", ", ".join(str(int(v)) for v in cfg.frequency_thresholds))
            mon = c3.text_input("Monetary cut points", ", ".join(f"{v:g}" for v in cfg.monetary_thresholds))
            a, b = st.columns([1, 1])
            apply = a.form_submit_button("Apply scoring rules", type="primary", width="stretch")
            reset = b.form_submit_button("Restore defaults", width="stretch")
        if reset:
            st.session_state["rfm_config"] = RFMConfig()
            st.rerun()
        if apply:
            try:
                new = RFMConfig(method=method,
                                recency_thresholds=tuple(int(float(x)) for x in rec.split(",")),
                                frequency_thresholds=tuple(int(float(x)) for x in fre.split(",")),
                                monetary_thresholds=tuple(float(x) for x in mon.split(",")))
                new.validate()
            except ValueError as exc:
                st.error(f"Scoring rules not applied: {exc}. Enter four ascending, comma-separated numbers.")
            else:
                st.session_state["rfm_config"] = new
                st.rerun()


def render() -> None:
    filters = require_filters("Customer Segmentation", "Who your customers are, grouped by how they buy.")
    if filters is None:
        return
    cur = state.currency()
    story_banner("segments")
    takeaway(first_insight(data.get("insights", filters, currency=cur), "Segments", "Risk"))
    seg = data.get("segment_summary", filters)
    if seg.empty:
        no_rows("No customers have purchases up to the selected end date.")
        return

    st.subheader("Your customer groups, and how to approach each")
    guide = segment_definitions(filters.rfm).set_index("Segment")
    per_row = 3
    for i in range(0, len(seg), per_row):
        cols = st.columns(per_row, gap="large")
        for col, row in zip(cols, seg.iloc[i:i + per_row].itertuples()):
            desc = guide["Description"].get(row.segment, "")
            act = guide["Suggested action"].get(row.segment, "")
            colour = SEGMENT_COLORS.get(row.segment, "#CFC4B3")
            with col:
                st.markdown(
                    f"<div class='ciq-seg'><div class='nm'><span class='dot' style='background:{colour}'></span>"
                    f"{html.escape(row.segment)}</div><div class='fig'><b>{row.customers:,}</b> customers "
                    f"({row.customer_share_pct:.0f}%) bring in <b>{row.revenue_share_pct:.0f}%</b> of revenue. "
                    f"Typical order {money(row.avg_order_value, cur)}.</div>"
                    f"<div class='ds'>{html.escape(desc)}</div><div class='ap'>{html.escape(act)}</div></div>",
                    unsafe_allow_html=True)

    st.subheader("Who brings in the money")
    left, right = st.columns([3, 2], gap="large")
    with left:
        s = seg.iloc[::-1]
        fig = go.Figure()
        fig.add_bar(y=s["segment"], x=s["customer_share_pct"], orientation="h", name="Share of customers",
                    marker_color="#E3CDB0", text=s["customer_share_pct"].map(lambda v: f"{v:.1f}%"),
                    textposition="outside", hovertemplate="%{y}<br>%{x:.1f}% of customers<extra></extra>")
        fig.add_bar(y=s["segment"], x=s["revenue_share_pct"], orientation="h", name="Share of net revenue",
                    marker_color=NAVY, text=s["revenue_share_pct"].map(lambda v: f"{v:.1f}%"), textposition="outside",
                    hovertemplate="%{y}<br>%{x:.1f}% of net revenue<extra></extra>")
        top = float(max(seg["customer_share_pct"].max(), seg["revenue_share_pct"].max()))
        fig.update_traces(cliponaxis=False)
        fig.update_layout(title="Customer count vs revenue contribution", barmode="group", xaxis_ticksuffix="%",
                          xaxis_range=[0, top * 1.18])
        show(fig, 420, key="seg_share")
        explain("For each group, the pale bar is its share of your customers and the dark bar its share of "
                "your revenue.", "Where the dark bar is longer, a small group carries a big part of the business.")
    with right:
        grid = data.get("rfm_grid", filters)
        pivot = grid.pivot_table(index="r_score", columns="f_score", values="customers", aggfunc="sum").reindex(
            index=[5, 4, 3, 2, 1], columns=[1, 2, 3, 4, 5])
        fig = go.Figure(go.Heatmap(
            z=pivot.values, x=[f"F{c}" for c in pivot.columns], y=[f"R{r}" for r in pivot.index],
            colorscale=SEQUENTIAL, text=pivot.fillna(0).astype(int).values, texttemplate="%{text}",
            hovertemplate="Recency %{y}, Frequency %{x}<br>%{z} customers<extra></extra>", showscale=False,
            xgap=2, ygap=2))
        fig.update_layout(title="Customers by Recency x Frequency score", margin=dict(b=48))
        fig.update_xaxes(title="Frequency score (higher = more orders)")
        fig.update_yaxes(title="Recency score (higher = more recent)", autorange="reversed")  # R5 at the top
        show(fig, 420, key="seg_grid")
        explain("Top-right squares hold customers who bought recently and often; bottom-left, those who "
                "bought once, long ago.", "The darker a square, the more customers sit there.")
        if filters.rfm.method == "quantile":
            st.caption("Quantile scores give tied values the same (lowest) score, so a score can be empty: when "
                       "many customers share the minimum order count, the next score up is skipped.")

    st.subheader("The detail")
    note(f"Groups are worked out <b>as of {filters.end_date}</b> from each customer's full history up to that "
         "date (RFM: recency, frequency, monetary). They are descriptive groupings from transparent rules, "
         "not predictions.")
    _config_editor()
    st.markdown("**Group profile**")
    table = seg.rename(columns={
        "segment": "Segment", "customers": "Customers", "customer_share_pct": "Customer share %",
        "net_revenue": f"Net revenue ({cur or 'currency not specified'})", "revenue_share_pct": "Revenue share %",
        "avg_recency_days": "Avg recency (days)", "avg_frequency": "Avg orders", "avg_monetary": "Avg monetary",
        "avg_order_value": "Avg order value"})
    st.dataframe(table, hide_index=True, width="stretch", column_config={
        f"Net revenue ({cur or 'currency not specified'})": st.column_config.NumberColumn(format="localized"),
        "Avg monetary": st.column_config.NumberColumn(format="localized"),
        "Avg order value": st.column_config.NumberColumn(format="localized")})

    with st.expander("Segment definitions and suggested actions", icon=":material/rule:"):
        st.caption("Rules are evaluated top to bottom; the first match wins. FM = (F + M + 1) / 2, rounded down.")
        st.dataframe(segment_definitions(filters.rfm), hide_index=True, width="stretch")
    with st.expander("View the SQL that produced these segments", icon=":material/code:"):
        st.code(build_rfm_sql(filters.rfm), language="sql")

    st.subheader("Customer explorer")
    customers = data.get("rfm_customers", filters)
    c1, c2 = st.columns([2, 1])
    query = c1.text_input("Search customers", placeholder="Customer ID, country or segment", key="seg_search")
    seg_pick = c2.multiselect("Show segments", sorted(customers["segment"].unique()), key="seg_table_filter",
                              placeholder="All")
    view = search_filter(customers, query, ["customer_id", "country", "segment"])
    if seg_pick:
        view = view[view["segment"].isin(seg_pick)]
    st.caption(f"{len(view):,} customers. Select a row to see that customer's order history.")
    event = st.dataframe(
        view, hide_index=True, width="stretch", height=360, on_select="rerun", selection_mode="single-row",
        key="rfm_table",
        column_config={
            "customer_id": "Customer", "country": "Country", "segment": "Segment", "rfm_code": "RFM",
            "r_score": st.column_config.NumberColumn("R", help="Recency score 1-5"),
            "f_score": st.column_config.NumberColumn("F", help="Frequency score 1-5"),
            "m_score": st.column_config.NumberColumn("M", help="Monetary score 1-5"),
            "fm_score": st.column_config.NumberColumn("FM", help="Combined frequency/monetary score"),
            "last_purchase": "Last purchase", "recency_days": "Recency (days)", "frequency": "Orders",
            "monetary": st.column_config.NumberColumn("Net revenue", format="localized"),
        })
    csv_download(view, "customeriq_rfm_customers.csv", key="dl_rfm")
    rows = event.selection.rows if event and hasattr(event, "selection") else []
    if rows:
        cust = view.iloc[rows[0]]
        orders = data.get("customer_orders", filters, customer_id=str(cust["customer_id"]))
        st.markdown(f"**Customer {cust['customer_id']}** - {cust['segment']} (RFM {cust['rfm_code']}), "
                    f"{cust['frequency']} orders, net revenue {money(cust['monetary'], cur, 2)}")
        st.dataframe(orders, hide_index=True, width="stretch", column_config={
            "value": st.column_config.NumberColumn("Value", format="localized"),
            "cumulative_value": st.column_config.NumberColumn("Cumulative value", format="localized")})

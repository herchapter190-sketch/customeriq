"""6. Inactive Customer Analysis."""
from __future__ import annotations

import plotly.graph_objects as go
import streamlit as st

from src.config import RISK_ORDER, RiskConfig
from src.ui import data, state
from src.ui.components import csv_download, money, note, search_filter, stat
from src.ui.pages._common import no_rows, require_filters, show
from src.ui.theme import RISK_COLORS, SEGMENT_COLORS


def _threshold_editor() -> None:
    cfg: RiskConfig = st.session_state["risk_config"]
    with st.form("risk_form"):
        st.markdown("**Inactivity rules** (days since last purchase, as of the end date)")
        c = st.columns(4)
        active = c[0].number_input("Active up to", 1, 3650, cfg.active_days, step=5)
        cooling = c[1].number_input("Cooling up to", 2, 3650, cfg.cooling_days, step=5)
        at_risk = c[2].number_input("At Risk up to", 3, 3650, cfg.at_risk_days, step=5,
                                    help="Customers beyond this are Lapsed.")
        mult = c[3].number_input("Overdue multiplier", 1.0, 10.0, float(cfg.overdue_multiplier), step=0.5,
                                 help="Repeat customers are overdue when days inactive exceed this multiple of "
                                      "their own average days between orders.")
        a, b, _ = st.columns([1, 1, 3])
        apply = a.form_submit_button("Apply rules", type="primary", width="stretch")
        reset = b.form_submit_button("Defaults", width="stretch")
    if reset:
        st.session_state["risk_config"] = RiskConfig()
        st.rerun()
    if apply:
        new = RiskConfig(int(active), int(cooling), int(at_risk), float(mult))
        try:
            new.validate()
        except ValueError as exc:
            st.error(f"Rules not applied: {exc}.")
        else:
            st.session_state["risk_config"] = new
            st.rerun()


def render() -> None:
    filters = require_filters("Inactive Customers", "Rule-based inactivity indicators and win-back priorities")
    if filters is None:
        return
    cur = state.currency()
    r = filters.risk
    note(f"Transparent rules, not a churn prediction model. <b>Active</b> &le; {r.active_days} days since last "
         f"purchase, <b>Cooling</b> &le; {r.cooling_days}, <b>At Risk</b> &le; {r.at_risk_days}, "
         f"<b>Lapsed</b> beyond that. Evaluated as of <b>{filters.end_date}</b> using all history up to that date.")
    _threshold_editor()

    customers = data.get("inactive_customers", filters)
    if customers.empty:
        no_rows("No customers have purchases up to the selected end date.")
        return
    summary = data.get("risk_summary", filters).set_index("risk_category")

    cols = st.columns(4)
    for col, cat in zip(cols, RISK_ORDER):
        with col:
            if cat in summary.index:
                row = summary.loc[cat]
                stat(cat, f"{int(row['customers']):,} customers",
                     f"{money(row['historical_revenue'], cur)} historical revenue ({row['revenue_share_pct']:.1f}%) | "
                     f"{int(row['overdue_customers'])} overdue | {int(row['high_value_customers'])} high value")
            else:
                stat(cat, "0 customers", "")
    st.write("")

    left, right = st.columns(2)
    with left:
        by_seg = data.get("risk_by_segment", filters)
        fig = go.Figure()
        for seg in by_seg["segment"].unique():
            d = by_seg[by_seg["segment"] == seg].set_index("risk_category").reindex(RISK_ORDER).fillna(0)
            fig.add_bar(x=list(d.index), y=d["historical_revenue"], name=seg,
                        marker_color=SEGMENT_COLORS.get(seg, "#CFC4B3"),
                        hovertemplate=f"{seg}<br>%{{x}}: {cur}%{{y:,.0f}}<extra></extra>")
        fig.update_layout(title="Historical revenue by risk category and segment", barmode="stack",
                          yaxis_tickformat=",.0f",
                          legend=dict(orientation="v", x=1.02, y=1, yanchor="top", xanchor="left",
                                      font=dict(size=10)))
        show(fig, 400, key="risk_seg")
    with right:
        fig = go.Figure()
        for cat in RISK_ORDER:
            d = customers.loc[customers["risk_category"] == cat, "days_inactive"]
            if len(d):
                fig.add_histogram(x=d, name=cat, marker_color=RISK_COLORS[cat], xbins=dict(size=15))
        fig.update_layout(title="Distribution of days since last purchase", barmode="stack",
                          xaxis_title="Days inactive", yaxis_title="Customers", bargap=0.05)
        show(fig, 400, key="risk_hist")

    st.subheader("Priority win-back list")
    st.caption("High-value customers (top 20% by historical revenue) who are At Risk or Lapsed, or overdue "
               "relative to their own purchase rhythm.")
    wb = data.get("priority_win_back", filters, limit=25)
    if wb.empty:
        st.info("No high-value customers currently meet the win-back criteria.")
    else:
        st.dataframe(wb, hide_index=True, width="stretch", column_config=_columns())

    st.subheader("Customer inactivity table")
    c1, c2, c3, c4 = st.columns([2, 2, 1.2, 1.2])
    q = c1.text_input("Search", placeholder="Customer ID, country or segment", key="risk_search")
    cats = c2.multiselect("Risk category", list(RISK_ORDER), default=["At Risk", "Lapsed"], key="risk_cats")
    tier = c3.multiselect("Value tier", ["High", "Medium", "Low"], key="risk_tier", placeholder="All")
    overdue = c4.checkbox("Overdue only", key="risk_overdue",
                          help="Inactive for longer than the overdue multiplier x their own average gap.")
    view = search_filter(customers, q, ["customer_id", "country", "segment"])
    if cats:
        view = view[view["risk_category"].isin(cats)]
    if tier:
        view = view[view["value_tier"].isin(tier)]
    if overdue:
        view = view[view["is_overdue"] == 1]
    st.caption(f"{len(view):,} customers | {money(view['historical_revenue'].sum(), cur)} historical net revenue")
    st.dataframe(view, hide_index=True, width="stretch", height=420, column_config=_columns())
    csv_download(view, "customeriq_inactive_customers.csv", key="dl_inactive")


def _columns() -> dict:
    return {
        "customer_id": "Customer", "country": "Country", "segment": "Segment", "first_purchase": "First purchase",
        "last_purchase": "Last purchase", "days_inactive": "Days inactive", "orders": "Orders",
        "historical_revenue": st.column_config.NumberColumn("Historical revenue", format="localized"),
        "avg_days_between_orders": st.column_config.NumberColumn("Avg days between orders", format="%.0f"),
        "risk_category": "Risk category",
        "is_overdue": st.column_config.CheckboxColumn("Overdue"),
        "value_tier": "Value tier",
    }

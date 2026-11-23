"""4. Revenue Analytics."""
from __future__ import annotations

import plotly.graph_objects as go
import streamlit as st

from src.analytics.revenue import gini_coefficient
from src.ui import data, state
from src.ui.components import csv_download, explain, money, pct, search_filter
from src.ui.pages._common import no_rows, require_filters, show
from src.ui.story import first_insight, story_banner, takeaway
from src.ui.theme import ACCENT, NAVY, NEGATIVE, SLATE


def _trend_summary(monthly, cur: str) -> str:
    """Plain sentence about the latest month and the strongest/weakest months (from the monthly table)."""
    if monthly.empty:
        return ""
    last = monthly.iloc[-1]
    best = monthly.loc[monthly["net_revenue"].idxmax()]
    worst = monthly.loc[monthly["net_revenue"].idxmin()]
    line = f"Latest month, <b>{last['month']}</b>: {money(last['net_revenue'], cur)} after returns"
    mom = last.get("net_revenue_mom_pct")
    if mom is not None and mom == mom:  # not NaN
        line += f", {'up' if mom >= 0 else 'down'} <b>{abs(mom):.0f}%</b> on the month before"
    if len(monthly) > 2:
        strongest = ("that is also your strongest month" if best["month"] == last["month"]
                     else f"strongest month {best['month']} ({money(best['net_revenue'], cur)})")
        line += f". {strongest[0].upper()}{strongest[1:]}; weakest {worst['month']} ({money(worst['net_revenue'], cur)})"
    return line + "."


def render() -> None:
    filters = require_filters("Revenue Analytics", "How much money comes in, from whom, and how it changes.")
    if filters is None:
        return
    cur = state.currency()
    monthly = data.get("monthly_revenue", filters)
    if monthly.empty:
        no_rows()
        return
    story_banner("revenue", _trend_summary(monthly, cur))
    takeaway(first_insight(data.get("insights", filters, currency=cur), "Revenue", "Products"))

    tab_trend, tab_conc, tab_cust, tab_prod = st.tabs(
        ["Trend", "Who drives revenue", "Customers", "Products & markets"])

    with tab_trend:
        fig = go.Figure()
        fig.add_bar(x=monthly["month"], y=monthly["gross_sales"], name="Gross sales", marker_color="#E3CDB0",
                    hovertemplate=f"%{{x}}<br>Gross sales: {cur}%{{y:,.0f}}<extra></extra>")
        fig.add_bar(x=monthly["month"], y=-monthly["returns_value"], name="Returns", marker_color=NEGATIVE,
                    hovertemplate=f"%{{x}}<br>Returns: {cur}%{{y:,.0f}}<extra></extra>")
        fig.add_scatter(x=monthly["month"], y=monthly["net_revenue"], name="Net revenue", mode="lines+markers",
                        line=dict(color=NAVY, width=2.5),
                        hovertemplate=f"%{{x}}<br>Net revenue: {cur}%{{y:,.0f}}<extra></extra>")
        fig.update_layout(title="Gross sales, returns and net revenue by month", barmode="relative",
                          yaxis_tickformat=",.0f")
        show(fig, 400, key="rev_trend")
        explain("Pale bars are everything sold each month; the orange bars below zero are refunds for returned "
                "items; the dark line is what you kept.",
                "Watch the gap between bars and line: a widening gap means returns are eating more of your sales.")
        c1, c2 = st.columns(2, gap="large")
        with c1:
            f2 = go.Figure(go.Scatter(x=monthly["month"], y=monthly["avg_order_value"], mode="lines+markers",
                                      line=dict(color=ACCENT, width=2),
                                      hovertemplate=f"%{{x}}<br>AOV: {cur}%{{y:,.2f}}<extra></extra>"))
            f2.update_layout(title="Average order value by month", yaxis_rangemode="tozero")
            show(f2, 300, key="rev_aov")
        with c2:
            f3 = go.Figure(go.Bar(x=monthly["month"], y=monthly["orders"], marker_color=NAVY,
                                  hovertemplate="%{x}<br>%{y:,} orders<extra></extra>"))
            f3.update_layout(title="Orders by month")
            show(f3, 300, key="rev_orders")
        explain("Left: the average amount spent per order. Right: how many orders you received.",
                "Revenue can grow by more orders or by bigger orders; these two charts show which one is moving.")
        with st.expander("Monthly figures as a table", icon=":material/table:"):
            _monthly_table(monthly)
            csv_download(monthly, "customeriq_monthly_revenue.csv", key="dl_monthly")

    _other_tabs(filters, cur, tab_conc, tab_cust, tab_prod)


def _monthly_table(monthly) -> None:
    st.dataframe(monthly, hide_index=True, width="stretch", column_config={
        "month": "Month", "gross_sales": st.column_config.NumberColumn("Gross sales", format="localized"),
        "returns_value": st.column_config.NumberColumn("Returns", format="localized"),
        "net_revenue": st.column_config.NumberColumn("Net revenue", format="localized"),
        "orders": "Orders", "active_customers": "Active customers", "new_customers": "New customers",
        "returning_customers": "Returning customers",
        "avg_order_value": st.column_config.NumberColumn("AOV", format="%.2f"),
        "net_revenue_mom_pct": st.column_config.NumberColumn("Net revenue MoM %", format="%.1f%%")})


def _other_tabs(filters, cur, tab_conc, tab_cust, tab_prod) -> None:
    with tab_conc:
        conc = data.get("revenue_concentration", filters)
        curve = data.get("pareto_curve", filters)
        customers = data.get("revenue_by_customer", filters)
        if conc.empty:
            no_rows("No customers with positive net revenue in this selection.")
        else:
            gini = gini_coefficient(customers["net_revenue"])
            cols = st.columns(4)
            tiers = conc.set_index("top_pct")
            for col, p in zip(cols, (1, 10, 20)):
                col.metric(f"Top {p}% of customers", pct(tiers.loc[p, "revenue_share_pct"]),
                           f"{int(tiers.loc[p, 'customers_in_tier']):,} customers", delta_color="off", delta_arrow="off", border=True,
                           help=f"Share of net revenue generated by the top {p}% of customers ranked by net revenue.")
            cols[3].metric("Gini coefficient", f"{gini:.2f}" if gini is not None else "n/a", border=True,
                           help="0 = every customer spends the same; 1 = one customer generates all revenue.")
            fig = go.Figure()
            fig.add_scatter(x=curve["cumulative_customer_pct"], y=curve["cumulative_revenue_pct"], mode="lines",
                            line=dict(color=NAVY, width=2.5), name="Cumulative revenue",
                            hovertemplate="Top %{x:.1f}% of customers<br>%{y:.1f}% of revenue<extra></extra>")
            fig.add_scatter(x=[0, 100], y=[0, 100], mode="lines", line=dict(color=SLATE, dash="dot", width=1),
                            name="Perfect equality", hoverinfo="skip")
            fig.update_layout(title="Revenue concentration curve", xaxis_title="Customers ranked by revenue (cumulative %)",
                              yaxis_title="Net revenue (cumulative %)", xaxis_ticksuffix="%", yaxis_ticksuffix="%")
            show(fig, 400, key="rev_pareto")
            explain("Follow the curve from left to right: it shows what share of revenue your biggest spenders "
                    "add up to. The dotted line is what it would look like if everyone spent the same.",
                    "The further the curve bows above the dotted line, the more you depend on a few customers; "
                    "losing one of them would hurt.")
            st.dataframe(conc.rename(columns={"top_pct": "Top %", "customer_base": "Customers (positive revenue)",
                                              "customers_in_tier": "Customers in tier", "tier_revenue": "Tier revenue",
                                              "revenue_share_pct": "Share of revenue %"}),
                         hide_index=True, width="stretch",
                         column_config={"Tier revenue": st.column_config.NumberColumn(format="localized")})

    with tab_cust:
        customers = data.get("revenue_by_customer", filters)
        c1, c2 = st.columns([2, 1])
        q = c1.text_input("Search customers", placeholder="Customer ID, country or segment", key="rev_search")
        top_n = c2.selectbox("Show", [25, 100, 500, "All"], index=1, key="rev_topn")
        view = search_filter(customers, q, ["customer_id", "country", "segment"])
        if top_n != "All":
            view = view.head(int(top_n))
        st.dataframe(view, hide_index=True, width="stretch", height=420, column_config={
            "revenue_rank": "Rank", "customer_id": "Customer", "country": "Country",
            "first_purchase": "First purchase", "last_purchase": "Last purchase", "orders": "Orders",
            "gross_sales": st.column_config.NumberColumn("Gross sales", format="localized"),
            "returns_value": st.column_config.NumberColumn("Returns", format="localized"),
            "net_revenue": st.column_config.NumberColumn("Net revenue", format="localized"),
            "avg_order_value": st.column_config.NumberColumn("AOV", format="%.2f"),
            "revenue_share_pct": st.column_config.NumberColumn("Share %", format="%.2f%%"),
            "cumulative_share_pct": st.column_config.ProgressColumn("Cumulative share", format="%.1f%%",
                                                                    min_value=0, max_value=100),
            "segment": "Segment"})
        st.caption(f"{len(customers):,} customers with activity in the period; showing {len(view):,}.")
        csv_download(customers, "customeriq_revenue_by_customer.csv", key="dl_customers")

    with tab_prod:
        products = data.get("product_performance", filters)
        cats = data.get("category_performance", filters)
        left, right = st.columns([3, 2])
        with left:
            n = st.slider("Top products", 5, max(5, min(30, len(products))), min(12, max(5, len(products))),
                          key="rev_prod_n") if len(products) > 5 else len(products)
            top = products.head(n).iloc[::-1]
            labels = top["description"].fillna(top["product_id"]).str.slice(0, 32)
            fig = go.Figure(go.Bar(y=labels, x=top["net_revenue"], orientation="h", marker_color=NAVY,
                                   customdata=top[["units_sold", "customers", "return_rate_pct"]],
                                   hovertemplate=f"%{{y}}<br>Net revenue: {cur}%{{x:,.0f}}<br>Units: %{{customdata[0]:,}}"
                                                 "<br>Customers: %{customdata[1]:,}<br>Return rate: %{customdata[2]:.1f}%"
                                                 "<extra></extra>"))
            fig.update_layout(title=f"Top {n} products by net revenue", xaxis_tickformat=",.0f")
            show(fig, max(320, 26 * n + 80), key="rev_products")
        with right:
            fig = go.Figure(go.Bar(x=cats["category"], y=cats["net_revenue"], marker_color="#9A4A66",
                                   text=cats["revenue_share_pct"].map(lambda v: f"{v:.0f}%"), textposition="outside",
                                   hovertemplate=f"%{{x}}<br>{cur}%{{y:,.0f}}<extra></extra>"))
            fig.update_layout(title="Net revenue by category", yaxis_tickformat=",.0f")
            show(fig, max(320, 26 * n + 80), key="rev_cats")
            if (cats["category"] == "Uncategorised").all():
                st.caption("This dataset has no product category column.")
        st.dataframe(products, hide_index=True, width="stretch", height=320, column_config={
            "revenue_rank": "Rank", "product_id": "Product ID", "description": "Description", "category": "Category",
            "units_sold": "Units sold", "units_returned": "Units returned",
            "gross_sales": st.column_config.NumberColumn("Gross sales", format="localized"),
            "returns_value": st.column_config.NumberColumn("Returns", format="localized"),
            "net_revenue": st.column_config.NumberColumn("Net revenue", format="localized"),
            "orders": "Orders", "customers": "Customers",
            "return_rate_pct": st.column_config.NumberColumn("Return rate %", format="%.2f"),
            "revenue_share_pct": st.column_config.NumberColumn("Share %", format="%.2f")})
        csv_download(products, "customeriq_products.csv", key="dl_products")
        st.markdown("**Markets**")
        countries = data.get("country_performance", filters)
        st.dataframe(countries, hide_index=True, width="stretch", column_config={
            "country": "Country", "customers": "Customers", "orders": "Orders",
            "gross_sales": st.column_config.NumberColumn("Gross sales", format="localized"),
            "returns_value": st.column_config.NumberColumn("Returns", format="localized"),
            "net_revenue": st.column_config.NumberColumn("Net revenue", format="localized"),
            "avg_order_value": st.column_config.NumberColumn("AOV", format="%.2f")})

"""Transparent, rule-based business insight engine.

Every insight is computed from SQL query results for the current filters. Each rule
has an explicit minimum-sample guard and is skipped (never fabricated) when the data
cannot support it. Every insight states:

1. what was observed,
2. the supporting metric,
3. why it matters,
4. a practical action the business could consider.

Note on RFM segments: segments are defined by recency, so "declining activity" in a
segment such as *Hibernating* is true by construction. Trend rules therefore use
product categories and the overall business, not RFM segments.
"""
from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass

import pandas as pd

from src.analytics import behaviour, cohorts, revenue, risk
from src.analytics.context import AnalysisContext
from src.segments import service as segments

MIN_CUSTOMERS = 20
MIN_ELIGIBLE_COHORT = 30
MIN_SEGMENT_CUSTOMERS = 10
MIN_TREND_ORDERS = 20


@dataclass
class Insight:
    key: str
    category: str      # Revenue | Retention | Segments | Risk | Behaviour | Products
    kind: str          # opportunity | risk | info
    title: str
    observation: str
    metric: str
    why_it_matters: str
    action: str
    value: float       # the headline number, for testing and sorting

    def to_dict(self) -> dict:
        return asdict(self)


def money(value: float, currency: str = "") -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}{currency}{abs(value):,.0f}"


def pct(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}%"


# --------------------------------------------------------------------------- rules

def _repeat_revenue(conn, ctx, currency) -> Insight | None:
    df = revenue.repeat_vs_one_time(conn, ctx)
    if df["customers"].sum() < MIN_CUSTOMERS or set(df["customer_type"]) != {"One-time", "Repeat"}:
        return None
    rep = df.set_index("customer_type").loc["Repeat"]
    share, cust_share = float(rep["revenue_share_pct"]), float(rep["customer_share_pct"])
    if share >= 50:
        return Insight(
            "repeat_revenue_share", "Revenue", "opportunity",
            "Repeat customers drive most revenue",
            f"Customers with two or more orders account for {pct(share)} of net revenue in the period "
            f"while representing {pct(cust_share)} of active customers.",
            f"Repeat revenue share: {pct(share)} | repeat customer share: {pct(cust_share)}",
            "Revenue depends disproportionately on retained customers, so retention has a larger "
            "revenue effect than the customer count suggests.",
            "Protect repeat buyers with loyalty benefits and service quality; track repeat rate as a core KPI.",
            share,
        )
    return Insight(
        "repeat_revenue_share", "Revenue", "risk",
        "Revenue relies on one-time buyers",
        f"Repeat customers generate only {pct(share)} of net revenue; one-time buyers generate the rest.",
        f"Repeat revenue share: {pct(share)}",
        "Revenue that depends on constant new-customer acquisition is usually more expensive to sustain.",
        "Introduce second-purchase incentives and post-purchase follow-ups to convert first-time buyers.",
        share,
    )


def _concentration(conn, ctx, currency) -> Insight | None:
    df = revenue.revenue_concentration(conn, ctx)
    if df.empty or int(df["customer_base"].iloc[0]) < MIN_CUSTOMERS:
        return None
    top10 = df.set_index("top_pct").loc[10]
    top1 = df.set_index("top_pct").loc[1]
    share = float(top10["revenue_share_pct"])
    kind = "risk" if share >= 50 else "info"
    level = "highly concentrated" if share >= 50 else ("moderately concentrated" if share >= 30 else "broadly spread")
    return Insight(
        "revenue_concentration", "Revenue", kind,
        f"Revenue is {level}",
        f"The top 10% of customers ({int(top10['customers_in_tier'])} customers) generate {pct(share)} of net "
        f"revenue; the top 1% generate {pct(float(top1['revenue_share_pct']))}.",
        f"Top 10% share: {pct(share)} | top 1% share: {pct(float(top1['revenue_share_pct']))}",
        "When a small group of customers drives revenue, losing a few of them has an outsized impact."
        if share >= 50 else "Revenue is less exposed to the loss of any single customer group.",
        "Assign account-level attention to top customers and monitor their activity monthly."
        if share >= 50 else "Focus on lifting average customer value across the broad base.",
        share,
    )


def _first_month_retention(conn, ctx, currency) -> Insight | None:
    long = cohorts.cohort_long(conn, ctx)
    curve = cohorts.average_retention_curve(long, ctx.filters.end_date)
    if curve.empty or len(curve) < 2:
        return None
    m1 = curve.loc[curve["month_index"] == 1].iloc[0]
    if m1["eligible_customers"] < MIN_ELIGIBLE_COHORT:
        return None
    m1_pct = float(m1["retention_pct"])
    m3 = curve.loc[curve["month_index"] == 3]
    extra = ""
    if not m3.empty and m3.iloc[0]["eligible_customers"] >= MIN_ELIGIBLE_COHORT:
        extra = f" By month 3 the figure is {pct(float(m3.iloc[0]['retention_pct']))}."
    return Insight(
        "first_month_retention", "Retention", "risk" if m1_pct < 25 else "info",
        "Most customers do not return the month after their first purchase",
        f"On average only {pct(m1_pct)} of a cohort purchases again in the month after acquisition "
        f"({int(m1['eligible_customers'])} customers across {int(m1['cohorts'])} cohorts).{extra}",
        f"Month-1 cohort retention: {pct(m1_pct)}",
        "The largest drop in customer activity happens immediately after the first order, so early "
        "lifecycle communication has the most customers to influence.",
        "Test a structured post-purchase journey (thank-you, usage tips, timed second-order offer) and "
        "measure month-1 retention by cohort.",
        m1_pct,
    )


def _segment_aov(conn, ctx, currency) -> Insight | None:
    seg = segments.segment_summary(conn, ctx)
    seg = seg[seg["customers"] >= MIN_SEGMENT_CUSTOMERS]
    if len(seg) < 2:
        return None
    overall = revenue.kpis(conn, ctx, start="0000-01-01")["avg_order_value"]
    if not overall:
        return None
    top = seg.sort_values("avg_order_value", ascending=False).iloc[0]
    ratio = float(top["avg_order_value"]) / overall
    if ratio < 1.15:
        return None
    return Insight(
        "segment_aov", "Segments", "opportunity",
        f"{top['segment']} place larger orders",
        f"The {top['segment']} segment has an average order value of {money(top['avg_order_value'], currency)}, "
        f"{pct((ratio - 1) * 100, 0)} above the overall average of {money(overall, currency)}.",
        f"{top['segment']} AOV: {money(top['avg_order_value'], currency)} vs overall {money(overall, currency)} "
        f"({int(top['customers'])} customers)",
        "Segments with higher basket values respond to range and bundle offers rather than discounts.",
        f"Use {top['segment']} purchase patterns to design bundles and premium recommendations.",
        round(ratio, 3),
    )


def _three_month_windows(months: list[str], end_date: str) -> tuple[list[str], list[str], str] | None:
    """Last three complete months, compared with the same months one year earlier
    (seasonality-aware) or, if unavailable, the three months before."""
    end_month = end_date[:7]
    last_day_is_month_end = (pd.Timestamp(end_date) + pd.Timedelta(days=1)).day == 1
    complete = [m for m in months if m < end_month or (m == end_month and last_day_is_month_end)]
    if len(complete) < 6:
        return None
    recent = complete[-3:]
    yoy = [f"{int(m[:4]) - 1}{m[4:]}" for m in recent]
    if all(m in months for m in yoy):
        return recent, yoy, "the same months a year earlier"
    return recent, complete[-6:-3], "the previous three months"


def _revenue_trend(conn, ctx, currency) -> Insight | None:
    monthly = revenue.monthly_revenue(conn, ctx)
    windows = _three_month_windows(list(monthly["month"]), ctx.filters.end_date)
    if windows is None:
        return None
    recent, base, label = windows
    m = monthly.set_index("month")
    cur, prev = float(m.loc[recent, "net_revenue"].sum()), float(m.loc[base, "net_revenue"].sum())
    if prev <= 0 or m.loc[base, "orders"].sum() < MIN_TREND_ORDERS:
        return None
    change = 100 * (cur - prev) / prev
    growing = change >= 0
    return Insight(
        "revenue_trend", "Revenue", "opportunity" if growing else "risk",
        f"Net revenue {'grew' if growing else 'declined'} {pct(abs(change))} in the latest quarter",
        f"Net revenue for {recent[0]} to {recent[-1]} was {money(cur, currency)} versus {money(prev, currency)} "
        f"for {label} ({base[0]} to {base[-1]}).",
        f"Change: {'+' if growing else '-'}{pct(abs(change))}",
        "Comparing equivalent periods separates genuine momentum from seasonal swings.",
        "Identify which customers and categories drove the change before adjusting budgets."
        if growing else "Break the decline down by new vs returning customers and by category to find the cause.",
        round(change, 2),
    )


def _category_decline(conn, ctx, currency) -> Insight | None:
    # Category trends use SQL monthly figures per category via the product query on two windows.
    monthly = revenue.monthly_revenue(conn, ctx)
    windows = _three_month_windows(list(monthly["month"]), ctx.filters.end_date)
    if windows is None:
        return None
    recent, base, label = windows

    def window_bounds(months):
        start = f"{months[0]}-01"
        end = (pd.Timestamp(f"{months[-1]}-01") + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
        return start, end

    cur = revenue.category_performance(conn, ctx.with_dates(*window_bounds(recent)))
    prev = revenue.category_performance(conn, ctx.with_dates(*window_bounds(base)))
    merged = prev.merge(cur, on="category", how="left", suffixes=("_prev", "_cur")).fillna({"net_revenue_cur": 0, "orders_cur": 0})
    merged = merged[(merged["orders_prev"] >= MIN_TREND_ORDERS) & (merged["category"] != "Uncategorised")]
    if merged.empty:
        return None
    merged["change_pct"] = 100 * (merged["net_revenue_cur"] - merged["net_revenue_prev"]) / merged["net_revenue_prev"]
    worst = merged.sort_values("change_pct").iloc[0]
    if worst["change_pct"] > -10:
        return None
    return Insight(
        "category_decline", "Products", "risk",
        f"{worst['category']} purchase activity is declining",
        f"{worst['category']} net revenue fell {pct(abs(worst['change_pct']))} in {recent[0]} to {recent[-1]} "
        f"compared with {label}, while orders went from {int(worst['orders_prev'])} to {int(worst['orders_cur'])}.",
        f"{worst['category']}: {money(worst['net_revenue_prev'], currency)} -> {money(worst['net_revenue_cur'], currency)}",
        "A sustained category decline can signal range, pricing or availability problems.",
        f"Review {worst['category']} pricing, stock availability and range freshness; check which customers stopped buying it.",
        round(float(worst["change_pct"]), 2),
    )


def _high_value_at_risk(conn, ctx, currency) -> Insight | None:
    ic = risk.inactive_customers(conn, ctx)
    if len(ic) < MIN_CUSTOMERS:
        return None
    flagged = ic[(ic["value_tier"] == "High") & ic["risk_category"].isin(["At Risk", "Lapsed"])]
    if flagged.empty:
        return None
    total = float(ic["historical_revenue"].sum())
    value = float(flagged["historical_revenue"].sum())
    share = 100 * value / total if total else 0.0
    r = ctx.filters.risk
    return Insight(
        "high_value_at_risk", "Risk", "risk",
        "High-value customers have gone quiet",
        f"{len(flagged)} customers in the top 20% by historical revenue have not purchased for more than "
        f"{r.cooling_days} days. Together they represent {money(value, currency)} of historical net revenue.",
        f"{len(flagged)} customers | {money(value, currency)} | {pct(share)} of historical revenue",
        "Re-engaging a known high-value customer is typically cheaper than acquiring a new one of similar value.",
        "Prioritise these customers for personal win-back outreach; the Inactive Customers page lists them.",
        value,
    )


def _second_order_timing(conn, ctx, currency) -> Insight | None:
    gaps = behaviour.interpurchase_gaps(conn, ctx)
    second = gaps[gaps["order_number"] == 2]
    if len(second) < MIN_CUSTOMERS:
        return None
    median = float(second["gap_days"].median())
    within_90 = 100 * float((second["gap_days"] <= 90).mean())
    return Insight(
        "second_order_timing", "Behaviour", "info",
        f"Second orders typically follow within {median:.0f} days",
        f"Among {len(second)} customers who placed a second order in the period, the median gap after the first "
        f"order was {median:.0f} days; {pct(within_90)} returned within 90 days.",
        f"Median days to second order: {median:.0f}",
        "Knowing the natural repurchase window shows when reminders are timely rather than premature or too late.",
        f"Schedule second-purchase prompts shortly before day {max(int(median * 0.8), 1)} after a first order.",
        median,
    )


def _returns(conn, ctx, currency) -> Insight | None:
    k = revenue.kpis(conn, ctx)
    if k["orders"] < MIN_TREND_ORDERS or k["gross_sales"] <= 0:
        return None
    rate = k["return_rate_pct"]
    products = revenue.product_performance(conn, ctx)
    products = products[products["units_sold"] >= 20].sort_values("return_rate_pct", ascending=False)
    top_line = ""
    if not products.empty and products.iloc[0]["return_rate_pct"] > 0:
        p = products.iloc[0]
        top_line = f" The highest product return rate is {p['description'] or p['product_id']} at {pct(p['return_rate_pct'])} of units."
    return Insight(
        "returns_rate", "Products", "risk" if rate >= 5 else "info",
        f"Returns reduce gross sales by {pct(rate)}",
        f"Returned value was {money(k['returns_value'], currency)} against gross sales of "
        f"{money(k['gross_sales'], currency)}.{top_line}",
        f"Return rate (value): {pct(rate)}",
        "Returns erode margin and often point to product description, quality or fulfilment issues.",
        "Review product pages and quality for the most-returned items; track return reasons if available."
        if rate >= 5 else "Keep monitoring; the return rate is currently low.",
        rate,
    )


RULES = (_repeat_revenue, _concentration, _first_month_retention, _high_value_at_risk, _revenue_trend,
         _category_decline, _segment_aov, _second_order_timing, _returns)


def generate_insights(conn: sqlite3.Connection, ctx: AnalysisContext, currency: str = "") -> list[Insight]:
    insights: list[Insight] = []
    for rule in RULES:
        result = rule(conn, ctx, currency)
        if result is not None:
            insights.append(result)
    priority = {"risk": 0, "opportunity": 1, "info": 2}
    return sorted(insights, key=lambda i: priority[i.kind])


def insights_frame(insights: list[Insight]) -> pd.DataFrame:
    return pd.DataFrame([i.to_dict() for i in insights])

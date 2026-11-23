# Analytical Methodology

This document explains how CustomerIQ calculates its analyses and what they can and cannot tell you. All thresholds come from `src/config.py`, and most can be changed in the dashboard sidebar.

## 1. Reporting period and snapshot

- **Period metrics** (revenue, orders, AOV, products, behaviour) use transactions inside the selected date range.
- **Customer-state metrics** (RFM, inactivity, first purchase, cohorts) use each customer's **full history up to the end date**. The end date is the *snapshot date*: "as of this day, how recently did the customer buy?"
- **KPI comparisons** use the equal-length window immediately before the selected period. When that window has no data, no change is shown rather than a misleading +100%.

## 2. RFM segmentation

**Inputs (per customer, as of the snapshot date):**
- *Recency*: days since the last sales order
- *Frequency*: distinct sales invoices
- *Monetary*: net revenue (sales minus returns)

**Scoring (1–5).** Two methods are available:

| Method | Rule |
|---|---|
| Quantile (default) | `score = MIN(5, FLOOR(PERCENT_RANK × 5) + 1)`, ranked within the customer base. Recency is ranked so that fewer days score higher. Ties always share a score. |
| Fixed thresholds | Four ascending cut points produce five scores. Defaults: recency 30 / 90 / 180 / 365 days (≤30 → 5, >365 → 1); frequency 1 / 2 / 4 / 7 orders; monetary 100 / 300 / 750 / 2000. |

A combined **FM score** = `(F + M + 1) // 2` (rounds half up).

**Segment rules.** These are evaluated in order, and the first match wins:

| Segment | Rule | Suggested action |
|---|---|---|
| Champions | R 4–5 and FM 4–5 | Reward and retain |
| New Customers | R 4–5 and F = 1 | Onboard, encourage a second purchase |
| Loyal Customers | R 3–5 and FM 3–5 | Upsell / cross-sell |
| Potential Loyalists | R 3–5 and FM 1–2 | Nurture to build frequency |
| Cannot Lose Them | R = 1 and FM 4–5 | Personal win-back |
| At Risk | R 1–2 and FM 3–5 | Targeted reactivation |
| Hibernating | R 1–2 and FM 1–2 | Low-cost reactivation only |
| Other | No rule matched | — |

**Caveat.** RFM is a widely used *descriptive* heuristic. Segments summarise past behaviour. They are not statistically validated classes or predictions of future spending.

## 3. Cohort retention

- **Cohort**: the calendar month of a customer's first-ever sales order, computed over the full history, so changing the date filter never reassigns customers.
- **Activity**: any sales order in a calendar month.
- **Retention at month *k*** = cohort customers active in month *k* after acquisition ÷ cohort size. Month 0 is 100% by definition.
- Months after the snapshot date are **unobservable** and shown blank, not as 0%.
- **Average retention curve**: for each month *k*, only cohorts old enough to have reached month *k* are included, and they are weighted by cohort size. This avoids young cohorts dragging down later months.
- **Month-over-month retention**: of customers active in month *m − 1*, the share also active in month *m*.

Validated against hand-calculated results in `tests/test_cohorts.py`.

## 4. Inactivity and risk (rule-based)

| Category | Days since last purchase (defaults) |
|---|---|
| Active | ≤ 60 |
| Cooling | 61 – 120 |
| At Risk | 121 – 240 |
| Lapsed | > 240 |

Additional indicators:
- **Overdue**: a repeat customer whose days inactive exceed **2×** their own average gap between orders. This captures customers who break their personal rhythm, even when they are not yet "At Risk" by the absolute rule.
- **Value tier**: High = top 20% by historical net revenue, Low = bottom 50%, Medium otherwise.
- **Priority win-back list**: high-value customers who are At Risk, Lapsed or Overdue, ordered by historical revenue.

**These are transparent rules, not a churn prediction model.** No machine-learning model is used, because there is no labelled churn data to train or evaluate one. The thresholds are business judgements and should be tuned to each business's purchase cycle.

## 5. Revenue concentration

Customers with positive net revenue are ranked by net revenue. For tiers p ∈ {1, 5, 10, 20, 50}%, the top `max(1, ceil(N × p / 100))` customers are summed and divided by total net revenue. The Pareto curve plots cumulative customer share against cumulative revenue share.

## 6. Business insight rules

`src/insights/engine.py` contains nine rules. Each one runs only when it has enough data (for example at least 20 customers, at least 30 eligible cohort customers, or at least 20 orders in the comparison window) and is skipped otherwise. Nothing is estimated or invented.

| Rule | Observation | Classification |
|---|---|---|
| Repeat revenue share | Share of net revenue from customers with 2+ orders | Opportunity if ≥ 50%, otherwise risk |
| Revenue concentration | Top 10% and top 1% revenue share | Risk if top 10% ≥ 50% |
| First-month retention | Average month-1 cohort retention (and month 3 when observable) | Risk if < 25% |
| High-value customers gone quiet | High-value-tier customers who are At Risk or Lapsed, and their historical revenue | Risk |
| Revenue trend | Last 3 complete months vs the same months a year earlier (seasonality-aware), or vs the prior 3 months | Opportunity if growing, risk if declining |
| Category decline | Category with the largest decline (≤ −10%) over the same windows | Risk |
| Segment AOV | Segment whose AOV is ≥ 15% above overall (segments with ≥ 10 customers) | Opportunity |
| Second-order timing | Median days to a second order and the share within 90 days | Info |
| Returns | Return rate by value and the most-returned product | Risk if ≥ 5% |

Each finding states **what was observed**, **the supporting metric**, **why it matters** and **an action to consider**. Segment-level "declining activity" rules are deliberately not used. RFM segments are defined by recency, so declining activity in, for example, *Hibernating* is true by construction and would not be a finding.

## 7. Data quality

Rows that cannot be attributed or valued reliably are excluded, never imputed. Each exclusion is recorded in `rejected_rows` with a reason. Revenue is recomputed rather than trusted from the source. See [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## 8. Interpreting synthetic results

The demo dataset is generated from invented behavioural parameters. Patterns found in it (seasonality, concentration, retention levels) reflect the generator's design, not any real market. They show that the analyses work, not how real customers behave.

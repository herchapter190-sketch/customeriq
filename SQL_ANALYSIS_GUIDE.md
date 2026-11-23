# SQL Analysis Guide

All analytical queries live in [`src/sql/queries/`](src/sql/queries). Each file starts with a header that documents its purpose, parameters, output and the SQL techniques it uses. You can read and run every query from the app's **SQL Library** page.

## Conventions

**Parameters** are SQLite named parameters, always bound and never string-formatted:

| Parameter | Meaning |
|---|---|
| `:start_date`, `:end_date` | Reporting window (`YYYY-MM-DD`, inclusive). `:end_date` is also the RFM / risk snapshot date. |
| `:run_key` | Identifies the materialised RFM run in `customer_segments`. |
| `:seg_filter`, `:segments` | `1` plus a JSON array of segment names when the sidebar segment filter is active. |
| `:active_days`, `:cooling_days`, `:at_risk_days`, `:overdue_multiplier` | Inactivity rules. |
| `:customer_id` | Customer drill-down. |

**Macros** are expanded by `src/sql/runner.py` before execution, so every query filters identically:

```sql
{{FILTERED_TX}}  -- transactions with invoice_day BETWEEN :start_date AND :end_date (+ segment filter)
{{HISTORY_TX}}   -- transactions with invoice_day <= :end_date               (+ segment filter)
```

**Definitions** used throughout:

- An *order* is a distinct sales invoice (`is_return = 0`).
- *Net revenue* is `SUM(revenue)`. Returns carry negative revenue.
- *Gross sales* is `SUM(CASE WHEN is_return = 0 THEN revenue END)`.

## Query catalogue

| Requirement | Query | Key techniques |
|---|---|---|
| Customer revenue analysis | `kpi_summary` | CTEs, scalar subqueries, conditional aggregation |
| Revenue by customer | `revenue_by_customer` | `RANK()`, running `SUM() OVER (ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`, LEFT JOIN to segments |
| Average order value | `kpi_summary`, `monthly_revenue`, `country_performance` | Two-level aggregation (line → order → group) |
| Monthly trend | `monthly_revenue` | Date bucketing, `LAG()` for month-over-month growth |
| Repeat purchase | `repeat_purchase` | CASE classification on lifetime orders, share-of-total window |
| Purchase frequency | `purchase_frequency` | CASE bucketing, `VALUES` dimension table + LEFT JOIN so empty bands appear |
| Time between orders | `interpurchase_gaps` | `LAG()` and `ROW_NUMBER()` partitioned by customer, `julianday()` arithmetic |
| Monthly customer acquisition | `monthly_acquisition` | First-purchase lookup, new vs returning CASE, cumulative `SUM() OVER` |
| Customer retention | `monthly_retention` | Self-join on `month_num - 1` |
| Cohort analysis | `cohort_retention` | First-purchase month over full history, month offset via integer `month_num` |
| Revenue concentration | `revenue_concentration`, `pareto_curve` | `VALUES` tier list, `ROW_NUMBER()`, `COUNT()/SUM() OVER ()`, CROSS JOIN, named `WINDOW` |
| Product / category / country | `product_performance`, `category_performance`, `country_performance` | `DENSE_RANK()`, `NULLIF` guards, `COALESCE` |
| Order value distribution | `order_value_bands` | CASE bucketing, `VALUES` dimension |
| Purchase timing | `weekday_hour` | `strftime()` date parts |
| RFM segmentation | `rfm_scores` (+ `rfm_customers`, `rfm_grid`, `segment_summary`, `segment_activity_trend`) | `PERCENT_RANK()` or threshold CASE, generated segment CASE, `HAVING` |
| Inactive customers | `inactive_customers` | `LAG()` gaps, `PERCENT_RANK()` value tiers, rule CASE, LEFT JOIN to segments |
| Customer drill-down | `customer_orders` | Running lifetime value with `SUM() OVER` |
| Dataset profile | `data_overview` | Aggregates and scalar subqueries |

## Worked examples

### Revenue concentration (top X% of customers)

```sql
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
customer_net AS (
    SELECT customer_id, SUM(revenue) AS net_revenue
    FROM tx
    GROUP BY customer_id
    HAVING SUM(revenue) > 0
),
ranked AS (
    SELECT customer_id, net_revenue,
           ROW_NUMBER() OVER (ORDER BY net_revenue DESC, customer_id) AS rn,
           COUNT(*)         OVER ()                                   AS n_customers,
           SUM(net_revenue) OVER ()                                   AS total_net
    FROM customer_net
),
tiers(top_pct) AS (VALUES (1), (5), (10), (20), (50)),
tier_members AS (
    SELECT t.top_pct, r.n_customers, r.total_net,
           CASE WHEN r.rn <= MAX(1, CAST(r.n_customers * t.top_pct / 100.0 + 0.999999 AS INTEGER))
                THEN r.net_revenue END AS member_revenue
    FROM tiers t
    CROSS JOIN ranked r
)
SELECT top_pct,
       MAX(n_customers)                                                    AS customer_base,
       COUNT(member_revenue)                                               AS customers_in_tier,
       ROUND(SUM(COALESCE(member_revenue, 0)), 2)                          AS tier_revenue,
       ROUND(100.0 * SUM(COALESCE(member_revenue, 0)) / MAX(total_net), 2) AS revenue_share_pct
FROM tier_members
GROUP BY top_pct
ORDER BY top_pct;
```

Fully refunded customers (net ≤ 0) are excluded. Tier size is the ceiling of N × p / 100, with at least one customer. `customer_id` breaks ties so the ranking is deterministic.

### Cohort retention

1. `first_purchase`: `MIN(month_num)` of sales orders per customer over the **full history up to `:end_date`**, so the date filter selects cohorts but never reassigns customers.
2. `activity`: the distinct `(customer, month_num)` pairs with a sales order.
3. Join the two and compute `month_index = activity.month_num - cohort.month_num`.
4. `retention_pct = active_customers / cohort_size × 100`. Month 0 is 100% by definition.

The Python layer pivots this long result into a matrix. It also tells apart a true 0% from a month that **cannot be observed yet** (after `:end_date`), which is left blank rather than shown as zero.

### RFM scoring (quantile method)

```sql
MIN(5, CAST(PERCENT_RANK() OVER (ORDER BY frequency ASC) * 5 AS INTEGER) + 1) AS f_score
```

Recency is ranked in descending order, so a smaller number of days earns a higher score. `PERCENT_RANK` gives tied values the same rank, so customers with identical behaviour always receive the same score. This matters a great deal for frequency, where many customers have exactly one order.

## Verification

`tests/conftest.py` defines a nine-line dataset whose metrics were calculated by hand: gross 475.00, returns 10.00, net 465.00, 7 orders, 4 customers, 2 repeat customers. The tests in `test_sql_revenue.py`, `test_cohorts.py`, `test_risk.py` and `test_rfm.py` assert the SQL outputs against those independent values. `test_sql_library.py` executes every query file with the same parameters the dashboard uses.

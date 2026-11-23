-- =============================================================================
-- inactive_customers
-- Purpose : Rule-based inactivity indicators for every customer, as of :end_date.
-- Params  : :end_date, :run_key, :active_days, :cooling_days, :at_risk_days,
--           :overdue_multiplier (+ segment filter params)
-- Returns : one row per customer with at least one sales order
-- SQL     : CTEs, LAG() for gaps between orders, PERCENT_RANK() for value tier,
--           CASE rules, julianday() arithmetic, LEFT JOIN to segments
-- Rules   : risk_category from days inactive:
--             <= active_days  -> Active
--             <= cooling_days -> Cooling
--             <= at_risk_days -> At Risk
--             otherwise       -> Lapsed
--           is_overdue = 1 when a repeat customer's days inactive exceed
--           overdue_multiplier x their own average days between orders.
--           value_tier: High = top 20% by historical net revenue, Low = bottom 50%.
-- These are transparent rules, NOT a churn prediction model.
-- =============================================================================
WITH history AS MATERIALIZED (
    {{HISTORY_TX}}
),
orders AS (
    SELECT customer_id, invoice_id, MIN(invoice_day) AS order_day
    FROM history
    WHERE is_return = 0
    GROUP BY customer_id, invoice_id
),
gaps AS (
    SELECT customer_id,
           julianday(order_day)
             - julianday(LAG(order_day) OVER (PARTITION BY customer_id ORDER BY order_day, invoice_id)) AS gap_days
    FROM orders
),
gap_stats AS (
    SELECT customer_id, AVG(gap_days) AS avg_gap_days
    FROM gaps
    WHERE gap_days IS NOT NULL
    GROUP BY customer_id
),
customers AS (
    SELECT
        customer_id,
        MAX(country)                                                  AS country,
        MIN(CASE WHEN is_return = 0 THEN invoice_day END)             AS first_purchase,
        MAX(CASE WHEN is_return = 0 THEN invoice_day END)             AS last_purchase,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)   AS orders,
        SUM(revenue)                                                  AS historical_revenue
    FROM history
    GROUP BY customer_id
    HAVING COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) > 0
),
measured AS (
    SELECT
        c.*,
        CAST(julianday(:end_date) - julianday(c.last_purchase) AS INTEGER) AS days_inactive,
        g.avg_gap_days,
        PERCENT_RANK() OVER (ORDER BY c.historical_revenue)                AS value_pct_rank
    FROM customers c
    LEFT JOIN gap_stats g ON g.customer_id = c.customer_id
)
SELECT
    m.customer_id,
    m.country,
    COALESCE(cs.segment, 'Unsegmented')                               AS segment,
    m.first_purchase,
    m.last_purchase,
    m.days_inactive,
    m.orders,
    ROUND(m.historical_revenue, 2)                                    AS historical_revenue,
    ROUND(m.avg_gap_days, 1)                                          AS avg_days_between_orders,
    CASE
        WHEN m.days_inactive <= :active_days  THEN 'Active'
        WHEN m.days_inactive <= :cooling_days THEN 'Cooling'
        WHEN m.days_inactive <= :at_risk_days THEN 'At Risk'
        ELSE 'Lapsed'
    END                                                               AS risk_category,
    CASE
        WHEN m.avg_gap_days IS NOT NULL
         AND m.days_inactive > :overdue_multiplier * MAX(m.avg_gap_days, 1) THEN 1
        ELSE 0
    END                                                               AS is_overdue,
    CASE
        WHEN m.value_pct_rank >= 0.8 THEN 'High'
        WHEN m.value_pct_rank >= 0.5 THEN 'Medium'
        ELSE 'Low'
    END                                                               AS value_tier
FROM measured m
LEFT JOIN customer_segments cs
       ON cs.customer_id = m.customer_id AND cs.run_key = :run_key
ORDER BY m.historical_revenue DESC, m.customer_id

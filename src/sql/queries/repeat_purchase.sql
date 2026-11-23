-- =============================================================================
-- repeat_purchase
-- Purpose : Compare one-time and repeat customers on count, revenue and AOV.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : two rows: 'One-time' and 'Repeat'
-- SQL     : CTEs, CASE classification, JOIN, GROUP BY, share-of-total window
-- Notes   : A customer is "Repeat" when they have 2+ distinct sales orders in
--           their history up to :end_date (lifetime-to-date classification).
--           Revenue and orders are measured inside the selected period.
-- =============================================================================
WITH history AS MATERIALIZED (
    {{HISTORY_TX}}
),
lifetime AS (
    SELECT customer_id,
           COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) AS lifetime_orders
    FROM history
    GROUP BY customer_id
),
period AS (
    SELECT customer_id,
           COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) AS period_orders,
           SUM(CASE WHEN is_return = 0 THEN revenue ELSE 0 END)        AS period_gross,
           SUM(revenue)                                                AS period_net
    FROM history
    WHERE invoice_day >= :start_date
    GROUP BY customer_id
    HAVING COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) > 0
)
SELECT
    CASE WHEN l.lifetime_orders >= 2 THEN 'Repeat' ELSE 'One-time' END     AS customer_type,
    COUNT(*)                                                               AS customers,
    SUM(p.period_orders)                                                   AS orders,
    ROUND(SUM(p.period_net), 2)                                            AS net_revenue,
    ROUND(SUM(p.period_gross) / NULLIF(SUM(p.period_orders), 0), 2)        AS avg_order_value,
    ROUND(1.0 * SUM(p.period_orders) / COUNT(*), 2)                        AS orders_per_customer,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)                     AS customer_share_pct,
    ROUND(100.0 * SUM(p.period_net) / NULLIF(SUM(SUM(p.period_net)) OVER (), 0), 2) AS revenue_share_pct
FROM period p
JOIN lifetime l ON l.customer_id = p.customer_id
GROUP BY CASE WHEN l.lifetime_orders >= 2 THEN 'Repeat' ELSE 'One-time' END
ORDER BY customer_type;

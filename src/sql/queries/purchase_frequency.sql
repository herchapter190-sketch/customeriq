-- =============================================================================
-- purchase_frequency
-- Purpose : Distribution of customers by number of orders in the period.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per frequency band, including empty bands
-- SQL     : CTEs, CASE bucketing, VALUES dimension table, LEFT JOIN,
--           GROUP BY, window share-of-total
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
customer_orders AS (
    SELECT customer_id,
           COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) AS n_orders,
           SUM(revenue)                                                AS net_revenue
    FROM tx
    GROUP BY customer_id
    HAVING COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) > 0
),
banded AS (
    SELECT customer_id, n_orders, net_revenue,
           CASE
               WHEN n_orders = 1 THEN 1
               WHEN n_orders = 2 THEN 2
               WHEN n_orders = 3 THEN 3
               WHEN n_orders BETWEEN 4 AND 5  THEN 4
               WHEN n_orders BETWEEN 6 AND 10 THEN 5
               ELSE 6
           END AS band_order
    FROM customer_orders
),
bands(band_order, frequency_band) AS (
    VALUES (1, '1 order'), (2, '2 orders'), (3, '3 orders'),
           (4, '4-5 orders'), (5, '6-10 orders'), (6, '11+ orders')
)
SELECT
    b.frequency_band,
    COUNT(c.customer_id)                                                  AS customers,
    ROUND(COALESCE(SUM(c.net_revenue), 0), 2)                             AS net_revenue,
    ROUND(100.0 * COUNT(c.customer_id) / NULLIF(SUM(COUNT(c.customer_id)) OVER (), 0), 2) AS customer_share_pct,
    ROUND(100.0 * COALESCE(SUM(c.net_revenue), 0)
          / NULLIF(SUM(SUM(c.net_revenue)) OVER (), 0), 2)                AS revenue_share_pct
FROM bands b
LEFT JOIN banded c ON c.band_order = b.band_order
GROUP BY b.band_order, b.frequency_band
ORDER BY b.band_order;

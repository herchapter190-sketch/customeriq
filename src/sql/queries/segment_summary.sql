-- =============================================================================
-- segment_summary
-- Purpose : Size, revenue contribution and behaviour of each RFM segment.
-- Params  : :end_date, :run_key (+ segment filter params)
-- Returns : one row per segment present in the run
-- SQL     : CTEs, LEFT JOIN, GROUP BY, AVG/SUM, window share-of-total
-- Notes   : Revenue = RFM monetary value (net revenue up to the snapshot date).
--           AOV = gross sales / orders over the same history.
-- =============================================================================
WITH history AS MATERIALIZED (
    {{HISTORY_TX}}
),
seg AS (
    SELECT * FROM customer_segments
    WHERE run_key = :run_key
      AND customer_id IN (SELECT customer_id FROM history)
),
order_values AS (
    SELECT customer_id, invoice_id, SUM(revenue) AS order_value
    FROM history
    WHERE is_return = 0
    GROUP BY customer_id, invoice_id
),
customer_orders AS (
    SELECT customer_id, SUM(order_value) AS gross_sales, COUNT(*) AS orders
    FROM order_values
    GROUP BY customer_id
)
SELECT
    s.segment,
    COUNT(*)                                                         AS customers,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)               AS customer_share_pct,
    ROUND(SUM(s.monetary), 2)                                        AS net_revenue,
    ROUND(100.0 * SUM(s.monetary) / NULLIF(SUM(SUM(s.monetary)) OVER (), 0), 2) AS revenue_share_pct,
    ROUND(AVG(s.recency_days), 1)                                    AS avg_recency_days,
    ROUND(AVG(s.frequency), 2)                                       AS avg_frequency,
    ROUND(AVG(s.monetary), 2)                                        AS avg_monetary,
    ROUND(SUM(c.gross_sales) / NULLIF(SUM(c.orders), 0), 2)          AS avg_order_value
FROM seg s
LEFT JOIN customer_orders c ON c.customer_id = s.customer_id
GROUP BY s.segment
ORDER BY net_revenue DESC;

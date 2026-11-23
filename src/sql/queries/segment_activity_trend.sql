-- =============================================================================
-- segment_activity_trend
-- Purpose : Monthly orders, customers and sales per RFM segment, used to detect
--           segments whose purchasing activity is declining.
-- Params  : :start_date, :end_date, :run_key (+ segment filter params)
-- Returns : one row per (month, segment)
-- SQL     : CTE, INNER JOIN to materialised segments, GROUP BY
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
)
SELECT
    t.invoice_month                          AS month,
    cs.segment,
    COUNT(DISTINCT t.invoice_id)             AS orders,
    COUNT(DISTINCT t.customer_id)            AS customers,
    ROUND(SUM(t.revenue), 2)                 AS gross_sales
FROM tx t
JOIN customer_segments cs
  ON cs.customer_id = t.customer_id
 AND cs.run_key = :run_key
WHERE t.is_return = 0
GROUP BY t.invoice_month, cs.segment
ORDER BY t.invoice_month, cs.segment;

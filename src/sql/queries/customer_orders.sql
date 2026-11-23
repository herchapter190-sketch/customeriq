-- =============================================================================
-- customer_orders
-- Purpose : Order history for one customer (drill-down view).
-- Params  : :customer_id, :end_date
-- Returns : one row per invoice (sales and returns)
-- SQL     : WHERE filter, GROUP BY, CASE, running SUM() OVER for lifetime value
-- =============================================================================
SELECT
    invoice_id,
    MIN(invoice_ts)                                         AS invoice_ts,
    CASE WHEN MAX(is_return) = 1 THEN 'Return' ELSE 'Sale' END AS type,
    COUNT(*)                                                AS lines,
    SUM(quantity)                                           AS units,
    ROUND(SUM(revenue), 2)                                  AS value,
    ROUND(SUM(SUM(revenue)) OVER (ORDER BY MIN(invoice_ts), invoice_id
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS cumulative_value
FROM transactions
WHERE customer_id = :customer_id
  AND invoice_day <= :end_date
GROUP BY invoice_id, is_return
ORDER BY invoice_ts, invoice_id;

-- =============================================================================
-- interpurchase_gaps
-- Purpose : Days between consecutive orders for each customer.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per repeat order (order_number >= 2)
-- SQL     : CTEs, window functions LAG() and ROW_NUMBER() partitioned by
--           customer, julianday() date arithmetic
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
orders AS (
    SELECT customer_id, invoice_id, MIN(invoice_day) AS order_day
    FROM tx
    WHERE is_return = 0
    GROUP BY customer_id, invoice_id
),
sequenced AS (
    SELECT
        customer_id,
        invoice_id,
        order_day,
        LAG(order_day) OVER (PARTITION BY customer_id ORDER BY order_day, invoice_id)    AS previous_order_day,
        ROW_NUMBER()   OVER (PARTITION BY customer_id ORDER BY order_day, invoice_id)    AS order_number
    FROM orders
)
SELECT
    customer_id,
    invoice_id,
    order_number,
    previous_order_day,
    order_day,
    CAST(julianday(order_day) - julianday(previous_order_day) AS INTEGER) AS gap_days
FROM sequenced
WHERE previous_order_day IS NOT NULL
ORDER BY customer_id, order_number;

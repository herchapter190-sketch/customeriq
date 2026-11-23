-- =============================================================================
-- monthly_acquisition
-- Purpose : New vs returning customers and their revenue for each month, plus
--           the cumulative customer base.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per month
-- SQL     : CTEs, JOIN to a first-purchase lookup, CASE classification,
--           GROUP BY, running SUM() OVER for the cumulative base
-- Notes   : "New" = the month contains the customer's first purchase ever.
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
first_month AS (
    SELECT customer_id, MIN(invoice_month) AS first_month
    FROM transactions
    WHERE is_return = 0
    GROUP BY customer_id
),
customer_month AS (
    SELECT t.invoice_month AS month,
           t.customer_id,
           CASE WHEN t.invoice_month = f.first_month THEN 'New' ELSE 'Returning' END AS customer_type,
           SUM(t.revenue) AS revenue
    FROM tx t
    JOIN first_month f ON f.customer_id = t.customer_id
    WHERE t.is_return = 0
    GROUP BY t.invoice_month, t.customer_id
)
SELECT
    month,
    SUM(CASE WHEN customer_type = 'New' THEN 1 ELSE 0 END)                  AS new_customers,
    SUM(CASE WHEN customer_type = 'Returning' THEN 1 ELSE 0 END)            AS returning_customers,
    ROUND(SUM(CASE WHEN customer_type = 'New' THEN revenue ELSE 0 END), 2)  AS new_customer_sales,
    ROUND(SUM(CASE WHEN customer_type = 'Returning' THEN revenue ELSE 0 END), 2) AS returning_customer_sales,
    SUM(SUM(CASE WHEN customer_type = 'New' THEN 1 ELSE 0 END))
        OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_new_customers
FROM customer_month
GROUP BY month
ORDER BY month;

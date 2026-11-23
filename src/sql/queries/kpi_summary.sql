-- =============================================================================
-- kpi_summary
-- Purpose : Headline business KPIs for the selected period.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row
-- SQL     : CTEs, JOIN, scalar subqueries, conditional aggregation (CASE)
-- Notes   : * An "order" is a distinct sales invoice (is_return = 0).
--           * Net revenue = gross sales + returns (returns carry negative revenue).
--           * New customers = first purchase EVER falls inside the period.
--           * Repeat customers = 2+ distinct orders inside the period.
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
orders AS (
    SELECT invoice_id, customer_id, SUM(revenue) AS order_value
    FROM tx
    WHERE is_return = 0
    GROUP BY invoice_id, customer_id
),
customer_orders AS (
    SELECT customer_id, COUNT(*) AS n_orders
    FROM orders
    GROUP BY customer_id
),
first_purchase AS (
    SELECT customer_id, MIN(invoice_day) AS first_day
    FROM transactions
    WHERE is_return = 0
    GROUP BY customer_id
)
SELECT
    ROUND(COALESCE(SUM(CASE WHEN is_return = 0 THEN revenue END), 0), 2)  AS gross_sales,
    ROUND(COALESCE(-SUM(CASE WHEN is_return = 1 THEN revenue END), 0), 2) AS returns_value,
    ROUND(COALESCE(SUM(revenue), 0), 2)                                   AS net_revenue,
    COALESCE(SUM(CASE WHEN is_return = 0 THEN quantity END), 0)           AS units_sold,
    (SELECT COUNT(*) FROM orders)                                         AS orders,
    (SELECT COUNT(*) FROM customer_orders)                                AS active_customers,
    (SELECT COUNT(*) FROM customer_orders WHERE n_orders >= 2)            AS repeat_customers,
    (SELECT ROUND(AVG(order_value), 2) FROM orders)                       AS avg_order_value,
    (SELECT COUNT(*)
       FROM first_purchase fp
       JOIN customer_orders co ON co.customer_id = fp.customer_id
      WHERE fp.first_day BETWEEN :start_date AND :end_date)               AS new_customers,
    (SELECT COUNT(DISTINCT invoice_id) FROM tx WHERE is_return = 1)       AS return_invoices
FROM tx;

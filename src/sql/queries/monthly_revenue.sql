-- =============================================================================
-- monthly_revenue
-- Purpose : Month-by-month revenue, orders, customers and average order value.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per calendar month with activity
-- SQL     : CTEs, GROUP BY on a date bucket, CASE aggregation, subquery (IN),
--           LEFT JOIN, window function LAG() for month-over-month growth
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
monthly AS (
    SELECT
        invoice_month                                                AS month,
        SUM(CASE WHEN is_return = 0 THEN revenue ELSE 0 END)         AS gross_sales,
        -SUM(CASE WHEN is_return = 1 THEN revenue ELSE 0 END)        AS returns_value,
        SUM(revenue)                                                 AS net_revenue,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)  AS orders,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN customer_id END) AS active_customers
    FROM tx
    GROUP BY invoice_month
),
new_by_month AS (
    SELECT fm.first_month AS month, COUNT(*) AS new_customers
    FROM first_month fm
    WHERE fm.customer_id IN (SELECT customer_id FROM tx WHERE is_return = 0)
    GROUP BY fm.first_month
)
SELECT
    m.month,
    ROUND(m.gross_sales, 2)                                   AS gross_sales,
    ROUND(m.returns_value, 2)                                 AS returns_value,
    ROUND(m.net_revenue, 2)                                   AS net_revenue,
    m.orders,
    m.active_customers,
    COALESCE(n.new_customers, 0)                              AS new_customers,
    m.active_customers - COALESCE(n.new_customers, 0)         AS returning_customers,
    ROUND(m.gross_sales / NULLIF(m.orders, 0), 2)             AS avg_order_value,
    ROUND(100.0 * (m.net_revenue - LAG(m.net_revenue) OVER (ORDER BY m.month))
          / NULLIF(LAG(m.net_revenue) OVER (ORDER BY m.month), 0), 2) AS net_revenue_mom_pct
FROM monthly m
LEFT JOIN new_by_month n ON n.month = m.month
ORDER BY m.month;

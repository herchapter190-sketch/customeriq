-- =============================================================================
-- country_performance
-- Purpose : Revenue, customers and average order value by country.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per country
-- SQL     : CTE, two-level aggregation (order level -> country level), JOIN
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
orders AS (
    SELECT invoice_id, customer_id, MAX(COALESCE(country, 'Unknown')) AS country,
           SUM(revenue) AS order_value
    FROM tx
    WHERE is_return = 0
    GROUP BY invoice_id, customer_id
),
returns_by_country AS (
    SELECT COALESCE(country, 'Unknown') AS country, -SUM(revenue) AS returns_value
    FROM tx
    WHERE is_return = 1
    GROUP BY COALESCE(country, 'Unknown')
)
SELECT
    o.country,
    COUNT(DISTINCT o.customer_id)                                         AS customers,
    COUNT(*)                                                              AS orders,
    ROUND(SUM(o.order_value), 2)                                          AS gross_sales,
    ROUND(COALESCE(MAX(r.returns_value), 0), 2)                           AS returns_value,
    ROUND(SUM(o.order_value) - COALESCE(MAX(r.returns_value), 0), 2)      AS net_revenue,
    ROUND(AVG(o.order_value), 2)                                          AS avg_order_value
FROM orders o
LEFT JOIN returns_by_country r ON r.country = o.country
GROUP BY o.country
ORDER BY net_revenue DESC;

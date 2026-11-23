-- =============================================================================
-- product_performance
-- Purpose : Revenue, units, reach and return rate per product.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per product, ranked by net revenue
-- SQL     : CTE, GROUP BY, CASE aggregation, DENSE_RANK(), NULLIF guards
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
per_product AS (
    SELECT
        product_id,
        MAX(description)                                              AS description,
        COALESCE(MAX(category), 'Uncategorised')                      AS category,
        SUM(CASE WHEN is_return = 0 THEN quantity ELSE 0 END)         AS units_sold,
        -SUM(CASE WHEN is_return = 1 THEN quantity ELSE 0 END)        AS units_returned,
        SUM(CASE WHEN is_return = 0 THEN revenue ELSE 0 END)          AS gross_sales,
        -SUM(CASE WHEN is_return = 1 THEN revenue ELSE 0 END)         AS returns_value,
        SUM(revenue)                                                  AS net_revenue,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)   AS orders,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN customer_id END)  AS customers
    FROM tx
    GROUP BY product_id
)
SELECT
    DENSE_RANK() OVER (ORDER BY net_revenue DESC)                     AS revenue_rank,
    product_id,
    description,
    category,
    units_sold,
    units_returned,
    ROUND(gross_sales, 2)                                             AS gross_sales,
    ROUND(returns_value, 2)                                           AS returns_value,
    ROUND(net_revenue, 2)                                             AS net_revenue,
    orders,
    customers,
    ROUND(100.0 * units_returned / NULLIF(units_sold, 0), 2)          AS return_rate_pct,
    ROUND(100.0 * net_revenue / NULLIF(SUM(net_revenue) OVER (), 0), 3) AS revenue_share_pct
FROM per_product
ORDER BY net_revenue DESC, product_id;

-- =============================================================================
-- category_performance
-- Purpose : Revenue and customer reach by product category (when available).
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per category; 'Uncategorised' when the source has no category
-- SQL     : CTE, COALESCE, GROUP BY, CASE aggregation, window share-of-total
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
)
SELECT
    COALESCE(category, 'Uncategorised')                                   AS category,
    COUNT(DISTINCT product_id)                                            AS products,
    SUM(CASE WHEN is_return = 0 THEN quantity ELSE 0 END)                 AS units_sold,
    ROUND(SUM(CASE WHEN is_return = 0 THEN revenue ELSE 0 END), 2)        AS gross_sales,
    ROUND(-SUM(CASE WHEN is_return = 1 THEN revenue ELSE 0 END), 2)       AS returns_value,
    ROUND(SUM(revenue), 2)                                                AS net_revenue,
    COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)           AS orders,
    COUNT(DISTINCT CASE WHEN is_return = 0 THEN customer_id END)          AS customers,
    ROUND(100.0 * SUM(revenue) / NULLIF(SUM(SUM(revenue)) OVER (), 0), 2) AS revenue_share_pct
FROM tx
GROUP BY COALESCE(category, 'Uncategorised')
ORDER BY net_revenue DESC;

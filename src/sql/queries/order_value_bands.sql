-- =============================================================================
-- order_value_bands
-- Purpose : Distribution of orders by order value, with basket depth per band.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per value band (empty bands included)
-- SQL     : CTEs, CASE bucketing, VALUES dimension, LEFT JOIN, GROUP BY,
--           window share-of-total
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
orders AS (
    SELECT invoice_id,
           SUM(revenue)               AS order_value,
           COUNT(*)                   AS lines,
           SUM(quantity)              AS units
    FROM tx
    WHERE is_return = 0
    GROUP BY invoice_id
),
banded AS (
    SELECT *,
           CASE
               WHEN order_value < 25   THEN 1
               WHEN order_value < 50   THEN 2
               WHEN order_value < 100  THEN 3
               WHEN order_value < 250  THEN 4
               WHEN order_value < 500  THEN 5
               WHEN order_value < 1000 THEN 6
               ELSE 7
           END AS band_order
    FROM orders
),
bands(band_order, value_band) AS (
    VALUES (1, 'Under 25'), (2, '25-50'), (3, '50-100'), (4, '100-250'),
           (5, '250-500'), (6, '500-1,000'), (7, '1,000+')
)
SELECT
    b.value_band,
    COUNT(o.invoice_id)                                                  AS orders,
    ROUND(COALESCE(SUM(o.order_value), 0), 2)                            AS gross_sales,
    ROUND(AVG(o.lines), 2)                                               AS avg_lines_per_order,
    ROUND(AVG(o.units), 2)                                               AS avg_units_per_order,
    ROUND(100.0 * COUNT(o.invoice_id) / NULLIF(SUM(COUNT(o.invoice_id)) OVER (), 0), 2) AS order_share_pct
FROM bands b
LEFT JOIN banded o ON o.band_order = b.band_order
GROUP BY b.band_order, b.value_band
ORDER BY b.band_order;

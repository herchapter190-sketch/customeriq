-- =============================================================================
-- weekday_hour
-- Purpose : When do customers place orders? Orders and sales by weekday x hour.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per (weekday, hour) with at least one order
-- SQL     : CTE, strftime() date parts, CASE mapping, GROUP BY
-- Notes   : weekday_num follows SQLite: 0 = Sunday ... 6 = Saturday.
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
orders AS (
    SELECT invoice_id, MIN(invoice_ts) AS order_ts, SUM(revenue) AS order_value
    FROM tx
    WHERE is_return = 0
    GROUP BY invoice_id
)
SELECT
    CAST(strftime('%w', order_ts) AS INTEGER)                      AS weekday_num,
    CASE CAST(strftime('%w', order_ts) AS INTEGER)
        WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
        WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END         AS weekday,
    CAST(strftime('%H', order_ts) AS INTEGER)                      AS hour,
    COUNT(*)                                                       AS orders,
    ROUND(SUM(order_value), 2)                                     AS gross_sales
FROM orders
GROUP BY weekday_num, hour
ORDER BY weekday_num, hour;

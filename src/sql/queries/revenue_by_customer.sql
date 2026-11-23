-- =============================================================================
-- revenue_by_customer
-- Purpose : Customer-level revenue league table with rank and cumulative share.
-- Params  : :start_date, :end_date, :run_key (+ segment filter params)
-- Returns : one row per customer with activity in the period
-- SQL     : CTEs, GROUP BY, CASE, window functions RANK(), running SUM() OVER
--           with an explicit frame, LEFT JOIN to materialised RFM segments
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
per_customer AS (
    SELECT
        customer_id,
        MAX(country)                                                 AS country,
        MIN(CASE WHEN is_return = 0 THEN invoice_day END)            AS first_purchase,
        MAX(CASE WHEN is_return = 0 THEN invoice_day END)            AS last_purchase,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)  AS orders,
        SUM(CASE WHEN is_return = 0 THEN revenue ELSE 0 END)         AS gross_sales,
        -SUM(CASE WHEN is_return = 1 THEN revenue ELSE 0 END)        AS returns_value,
        SUM(revenue)                                                 AS net_revenue
    FROM tx
    GROUP BY customer_id
),
ranked AS (
    SELECT
        pc.*,
        RANK() OVER (ORDER BY net_revenue DESC)                      AS revenue_rank,
        SUM(net_revenue) OVER ()                                     AS total_net,
        SUM(net_revenue) OVER (ORDER BY net_revenue DESC, customer_id
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_net
    FROM per_customer pc
)
SELECT
    r.revenue_rank,
    r.customer_id,
    r.country,
    r.first_purchase,
    r.last_purchase,
    r.orders,
    ROUND(r.gross_sales, 2)                                          AS gross_sales,
    ROUND(r.returns_value, 2)                                        AS returns_value,
    ROUND(r.net_revenue, 2)                                          AS net_revenue,
    ROUND(r.gross_sales / NULLIF(r.orders, 0), 2)                    AS avg_order_value,
    ROUND(100.0 * r.net_revenue / NULLIF(r.total_net, 0), 3)         AS revenue_share_pct,
    ROUND(100.0 * r.running_net / NULLIF(r.total_net, 0), 3)         AS cumulative_share_pct,
    COALESCE(cs.segment, 'Unsegmented')                              AS segment
FROM ranked r
LEFT JOIN customer_segments cs
       ON cs.customer_id = r.customer_id AND cs.run_key = :run_key
ORDER BY r.net_revenue DESC, r.customer_id;

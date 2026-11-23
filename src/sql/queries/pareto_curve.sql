-- =============================================================================
-- pareto_curve
-- Purpose : Cumulative revenue curve (Pareto / Lorenz) across ranked customers.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per customer: cumulative customer % vs cumulative revenue %
-- SQL     : CTE, HAVING, named WINDOW, ROW_NUMBER(), running SUM() frame
-- =============================================================================
WITH tx AS MATERIALIZED (
    {{FILTERED_TX}}
),
customer_net AS (
    SELECT customer_id, SUM(revenue) AS net_revenue
    FROM tx
    GROUP BY customer_id
    HAVING SUM(revenue) > 0
)
SELECT
    ROW_NUMBER() OVER w                                                   AS customer_rank,
    ROUND(100.0 * ROW_NUMBER() OVER w / COUNT(*) OVER (), 3)              AS cumulative_customer_pct,
    ROUND(100.0 * SUM(net_revenue) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
          / SUM(net_revenue) OVER (), 3)                                  AS cumulative_revenue_pct
FROM customer_net
WINDOW w AS (ORDER BY net_revenue DESC, customer_id)
ORDER BY customer_rank;

-- =============================================================================
-- rfm_grid
-- Purpose : Customer counts and revenue for each Recency x Frequency score cell.
-- Params  : :run_key (+ segment filter params)
-- Returns : one row per (r_score, f_score) cell with customers
-- SQL     : GROUP BY on two score dimensions, aggregate functions
-- =============================================================================
SELECT
    r_score,
    f_score,
    COUNT(*)                 AS customers,
    ROUND(SUM(monetary), 2)  AS net_revenue,
    ROUND(AVG(monetary), 2)  AS avg_monetary
FROM customer_segments
WHERE run_key = :run_key
  AND (:seg_filter = 0 OR segment IN (SELECT value FROM json_each(:segments)))
GROUP BY r_score, f_score
ORDER BY r_score, f_score;

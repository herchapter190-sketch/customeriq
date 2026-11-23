-- =============================================================================
-- rfm_customers
-- Purpose : Customer-level RFM table for a materialised run, with country.
-- Params  : :run_key, :end_date (+ segment filter params)
-- Returns : one row per segmented customer
-- SQL     : WHERE with JSON-array subquery filter, correlated subquery, ORDER BY
-- =============================================================================
SELECT
    cs.customer_id,
    (SELECT MAX(t.country) FROM transactions t WHERE t.customer_id = cs.customer_id) AS country,
    cs.segment,
    cs.rfm_code,
    cs.r_score,
    cs.f_score,
    cs.m_score,
    cs.fm_score,
    cs.last_purchase,
    cs.recency_days,
    cs.frequency,
    cs.monetary
FROM customer_segments cs
WHERE cs.run_key = :run_key
  AND (:seg_filter = 0 OR cs.segment IN (SELECT value FROM json_each(:segments)))
ORDER BY cs.monetary DESC, cs.customer_id;

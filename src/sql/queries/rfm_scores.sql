-- =============================================================================
-- rfm_scores
-- Purpose : Recency, Frequency and Monetary values, 1-5 scores and segment for
--           every customer, as of the snapshot date :end_date.
-- Params  : :end_date
-- Returns : one row per customer with at least one sales order up to :end_date
-- SQL     : CTEs, HAVING, CASE, julianday() arithmetic, window function
--           PERCENT_RANK() (quantile method), string concatenation
-- Method  : Recency   = days between the last sales order and :end_date
--           Frequency = distinct sales invoices
--           Monetary  = net revenue (sales minus returns)
--           FM score  = (F + M + 1) / 2 using integer division (rounds half up)
-- Template: The R_SCORE, F_SCORE, M_SCORE and SEGMENT_CASE comment markers in
--           the body are replaced by src/segments/rfm.py with expressions built
--           from validated numeric configuration only.
-- =============================================================================
WITH history AS MATERIALIZED (
    SELECT * FROM transactions WHERE invoice_day <= :end_date
),
customer_base AS (
    SELECT
        customer_id,
        MAX(CASE WHEN is_return = 0 THEN invoice_day END)            AS last_purchase,
        COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)  AS frequency,
        ROUND(SUM(revenue), 2)                                       AS monetary
    FROM history
    GROUP BY customer_id
    HAVING COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END) > 0
),
rfm_values AS (
    SELECT *,
           CAST(julianday(:end_date) - julianday(last_purchase) AS INTEGER) AS recency_days
    FROM customer_base
),
scored AS (
    SELECT *,
           /*R_SCORE*/ AS r_score,
           /*F_SCORE*/ AS f_score,
           /*M_SCORE*/ AS m_score
    FROM rfm_values
),
combined AS (
    SELECT *, (f_score + m_score + 1) / 2 AS fm_score
    FROM scored
)
SELECT
    customer_id,
    last_purchase,
    recency_days,
    frequency,
    monetary,
    r_score,
    f_score,
    m_score,
    fm_score,
    CAST(r_score AS TEXT) || CAST(f_score AS TEXT) || CAST(m_score AS TEXT) AS rfm_code,
    /*SEGMENT_CASE*/ AS segment
FROM combined
ORDER BY customer_id;

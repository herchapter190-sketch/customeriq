-- =============================================================================
-- monthly_retention
-- Purpose : Month-over-month customer retention: of the customers who bought in
--           the previous calendar month, how many bought again this month?
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : one row per month in the period
-- SQL     : CTEs, DISTINCT, self-JOIN on (month_num - 1), LEFT JOINs, GROUP BY
-- Notes   : The prior month may fall before :start_date so the first month of
--           the period still has a valid comparison.
-- =============================================================================
WITH history AS MATERIALIZED (
    {{HISTORY_TX}}
),
activity AS MATERIALIZED (
    SELECT DISTINCT customer_id, month_num, invoice_month
    FROM history
    WHERE is_return = 0
),
month_totals AS (
    SELECT month_num, invoice_month, COUNT(*) AS active_customers
    FROM activity
    GROUP BY month_num, invoice_month
),
retained AS (
    SELECT cur.month_num, COUNT(*) AS retained_customers
    FROM activity cur
    JOIN activity prev
      ON prev.customer_id = cur.customer_id
     AND prev.month_num   = cur.month_num - 1
    GROUP BY cur.month_num
)
SELECT
    m.invoice_month                                                    AS month,
    m.active_customers,
    COALESCE(p.active_customers, 0)                                    AS prior_month_customers,
    COALESCE(r.retained_customers, 0)                                  AS retained_customers,
    ROUND(100.0 * COALESCE(r.retained_customers, 0)
          / NULLIF(p.active_customers, 0), 2)                          AS retention_rate_pct
FROM month_totals m
LEFT JOIN month_totals p ON p.month_num = m.month_num - 1
LEFT JOIN retained r     ON r.month_num = m.month_num
WHERE m.invoice_month >= substr(:start_date, 1, 7)
ORDER BY m.month_num;

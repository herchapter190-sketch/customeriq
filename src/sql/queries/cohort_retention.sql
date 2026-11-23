-- =============================================================================
-- cohort_retention
-- Purpose : Monthly acquisition cohorts and the share of each cohort that
--           purchased again N months after their first purchase.
-- Params  : :start_date, :end_date (+ segment filter params)
-- Returns : long format: cohort_month, month_index, cohort_size,
--           active_customers, retention_pct
-- SQL     : CTEs, subquery (IN), self-referencing JOINs, DISTINCT,
--           date arithmetic on an integer month number, GROUP BY
-- Method  : * Cohort = calendar month of a customer's first-ever sales order
--             (computed over the full history so customers are never
--             re-assigned by the date filter).
--           * Only cohorts whose month falls inside the selected period are shown.
--           * Activity = any sales order in a month, observed up to :end_date.
--           * month_index 0 is always 100% by definition.
-- =============================================================================
WITH history AS MATERIALIZED (
    {{HISTORY_TX}}
),
first_purchase AS (
    SELECT customer_id,
           MIN(month_num)     AS cohort_num,
           MIN(invoice_month) AS cohort_month
    FROM transactions
    WHERE is_return = 0
    GROUP BY customer_id
),
cohort_members AS MATERIALIZED (
    SELECT fp.customer_id, fp.cohort_num, fp.cohort_month
    FROM first_purchase fp
    WHERE fp.cohort_month BETWEEN substr(:start_date, 1, 7) AND substr(:end_date, 1, 7)
      AND fp.customer_id IN (SELECT customer_id FROM history WHERE is_return = 0)
),
cohort_size AS (
    SELECT cohort_month, COUNT(*) AS cohort_size
    FROM cohort_members
    GROUP BY cohort_month
),
activity AS MATERIALIZED (
    SELECT DISTINCT customer_id, month_num
    FROM history
    WHERE is_return = 0
)
SELECT
    cm.cohort_month,
    a.month_num - cm.cohort_num                                     AS month_index,
    cs.cohort_size,
    COUNT(DISTINCT a.customer_id)                                   AS active_customers,
    ROUND(100.0 * COUNT(DISTINCT a.customer_id) / cs.cohort_size, 2) AS retention_pct
FROM cohort_members cm
JOIN activity a     ON a.customer_id = cm.customer_id
JOIN cohort_size cs ON cs.cohort_month = cm.cohort_month
GROUP BY cm.cohort_month, a.month_num - cm.cohort_num, cs.cohort_size
ORDER BY cm.cohort_month, month_index;

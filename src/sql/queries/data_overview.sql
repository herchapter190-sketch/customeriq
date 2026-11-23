-- =============================================================================
-- data_overview
-- Purpose : Profile of the loaded dataset for the Data Management page and the
--           report's data-source section.
-- Params  : none
-- Returns : one row
-- SQL     : aggregate functions, CASE, scalar subqueries
-- =============================================================================
SELECT
    COUNT(*)                                                     AS total_rows,
    SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END)               AS sales_rows,
    SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END)               AS return_rows,
    COUNT(DISTINCT customer_id)                                  AS customers,
    COUNT(DISTINCT CASE WHEN is_return = 0 THEN invoice_id END)  AS sales_invoices,
    COUNT(DISTINCT CASE WHEN is_return = 1 THEN invoice_id END)  AS return_invoices,
    COUNT(DISTINCT product_id)                                   AS products,
    COUNT(DISTINCT country)                                      AS countries,
    SUM(CASE WHEN category IS NOT NULL THEN 1 ELSE 0 END)        AS rows_with_category,
    MIN(invoice_day)                                             AS first_date,
    MAX(invoice_day)                                             AS last_date,
    ROUND(SUM(revenue), 2)                                       AS net_revenue,
    (SELECT COUNT(*) FROM rejected_rows)                         AS rejected_rows
FROM transactions;

# Data Dictionary

## 1. Import fields (standard transaction schema)

Uploaded CSV or Excel columns are mapped to these fields. Common header names are suggested automatically (for example `InvoiceNo`, `Invoice`, `OrderID` → *Invoice ID*), including the headers of the UCI *Online Retail* and *Online Retail II* datasets. You can override any mapping before importing.

| Field | Required | Description | Validation |
|---|---|---|---|
| `invoice_id` | Yes | Order / invoice number. Lines sharing an ID form one order. | Must not be empty. One invoice may not belong to several customers. |
| `customer_id` | Yes | Customer identifier. | Must not be empty. Allowed characters: letters, digits, `_ . -` (max 64). Numeric IDs exported as floats (`12345.0`) are normalised to `12345`. |
| `invoice_date` | Yes | Transaction date and time. | Must parse. Mixed formats are supported, and day-first parsing is optional. |
| `quantity` | Yes | Units on the line. Negative values denote returns. | Numeric and non-zero. |
| `unit_price` | Yes, or `revenue` | Price per unit. | Numeric and ≥ 0. Zero-price lines are rejected by default (configurable). Currency symbols (`$ US$ CA$ C$ A$ AU$ £ €`) and thousands separators are stripped. |
| `product_id` | No | SKU / stock code. | Missing values are labelled `UNKNOWN`. |
| `description` | No | Product name. | — |
| `category` | No | Product category. | Missing values become `Uncategorised` in category analysis. |
| `country` | No | Customer or shipping country. | — |
| `revenue` | Yes, or `unit_price` | Line total from the source. | Always **recomputed** as quantity × unit price. A warning is shown when the source values disagree. Without unit prices, unit price is derived as line total ÷ quantity (a warning says so); a negative total on a positive quantity is rejected as a negative price. |
| `currency` | No | Currency code of the line. | All lines must share one currency, from this column or from the symbols in the prices; a file mixing currencies is refused before anything is written. A bare `$` could be USD, CAD or AUD, so it is never assumed: map this column or choose the currency during import. Supported codes: USD, CAD, AUD, EUR, GBP, JOD, AED, SAR; any other code is refused with its name. The single currency is stored with the dataset and sets the display symbol. Nothing is converted. |

**Excel.** `.xlsx` / `.xlsm` workbooks: the first sheet with data rows is read by default, and the import screen lets you pick any other sheet.

**Returns.** A line is treated as a return when its quantity is negative **or** its invoice ID starts with the cancellation prefix (`C` by default) followed by a digit, for example `C536379`. Returns are kept with negative quantity and revenue and `is_return = 1`. They reduce net revenue but are never counted as orders.

**Duplicates.** Exact duplicate lines (same values in every mapped field) are removed, keeping the first. The same product on the same invoice with a different quantity is *not* a duplicate.

## 2. Database tables (SQLite)

### `transactions`
| Column | Type | Description |
|---|---|---|
| `row_id` | INTEGER PK | Surrogate key |
| `invoice_id` | TEXT | Invoice / order ID |
| `customer_id` | TEXT | Customer ID |
| `invoice_ts` | TEXT | `YYYY-MM-DD HH:MM:SS` |
| `invoice_day` | TEXT | `YYYY-MM-DD` (used for date filters) |
| `invoice_month` | TEXT | `YYYY-MM` |
| `month_num` | INTEGER | `year × 12 + (month − 1)`, used for cohort month offsets |
| `product_id` | TEXT | SKU (`UNKNOWN` when missing) |
| `description` | TEXT | Product description |
| `category` | TEXT | Product category (nullable) |
| `quantity` | REAL | Units (negative for returns) |
| `unit_price` | REAL | ≥ 0 |
| `revenue` | REAL | quantity × unit_price (negative for returns) |
| `country` | TEXT | Country (nullable) |
| `is_return` | INTEGER | 1 = return line, 0 = sale |

Indexes: customer, day, invoice, (is_return, day), product.

### `rejected_rows`
Audit trail of every row excluded during cleaning: `source_row` (row number in the uploaded file), `reason` (rule code, see below), `raw` (original values as JSON).

| Reason code | Meaning |
|---|---|
| `missing_invoice_id` | Invoice ID empty |
| `missing_customer_id` | Customer ID empty (for example a guest checkout), so the row cannot be attributed to a customer |
| `invalid_customer_id` | Customer ID has invalid characters |
| `invalid_date` | Date could not be parsed |
| `invalid_quantity` / `zero_quantity` | Quantity not numeric, or zero |
| `invalid_unit_price` / `negative_unit_price` / `zero_unit_price` | Price not numeric, negative (an accounting adjustment) or zero |
| `duplicate_row` | Exact duplicate of an earlier line |
| `invoice_customer_conflict` | Invoice ID used by more than one customer |

### `dataset_meta`
Key/value metadata (JSON values): `source_name`, `is_synthetic`, `data_label`, `mapping` (column mapping used), `cleaning_summary` (row counts, totals, date range), `warnings`, `loaded_at` (also the dataset version used for cache invalidation).

### `customer_segments`
Materialised RFM results, one row per `(run_key, customer_id)`: `last_purchase`, `recency_days`, `frequency`, `monetary`, `r_score`, `f_score`, `m_score`, `fm_score`, `rfm_code` (for example `545`), `segment`. `run_key` encodes the dataset version, snapshot date and RFM configuration. The most recent runs are kept and older ones are pruned.

## 3. Derived metrics

| Metric | Definition |
|---|---|
| Gross sales | Sum of revenue on sales lines |
| Returns value | Absolute sum of revenue on return lines |
| Net revenue | Gross sales − returns value (= `SUM(revenue)`) |
| Orders | Distinct sales invoices |
| Active customers | Customers with at least one sales order in the period |
| Average order value (AOV) | Gross sales ÷ orders |
| New customers | Customers whose first-ever sales order falls in the period |
| Repeat customer rate | Customers with 2+ orders in the period ÷ active customers |
| Revenue per customer | Net revenue ÷ active customers |
| Return rate | Returns value ÷ gross sales |
| Previous period | The equal-length window immediately before the selected period (used for KPI deltas) |
| Recency | Days from last sales order to the snapshot date (end of period) |
| Frequency | Distinct sales invoices up to the snapshot date |
| Monetary | Net revenue up to the snapshot date |
| Days inactive | Same as recency, used by the inactivity rules |
| Average gap | Mean days between consecutive orders (repeat customers only) |
| Retention % (cohort) | Customers from a cohort with a sales order in month *k* ÷ cohort size |
| Month-over-month retention | Customers who bought in both month *m − 1* and month *m* ÷ customers in month *m − 1* |

## 4. Synthetic demo dataset

Produced by `src/etl/synthetic.py` (seed `20240101`) and **clearly labelled as synthetic** in the app and in every export. It covers 2023-01-01 to 2024-12-31, about 1,600 customers, 40 products in 6 categories and several countries. Customers follow invented personas (VIP, regular, occasional, one-time, seasonal gift buyers) with persona-dependent lifetimes, so some genuinely become inactive. Demand rises seasonally in November and December, and about 3% of orders have a partial return. The generator deliberately injects data-quality problems (duplicates, missing customer IDs, zero prices, zero quantities, bad dates) so the cleaning pipeline has real work to do.

`data/sample/sample_transactions.csv` and `.xlsx` are small synthetic files for trying the import flow (`scripts/generate_sample_files.py`).

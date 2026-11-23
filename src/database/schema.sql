-- CustomerIQ SQLite schema
-- One active dataset at a time. Sales and returns share one table and are
-- distinguished by is_return so that net revenue = SUM(revenue).

CREATE TABLE IF NOT EXISTS transactions (
    row_id        INTEGER PRIMARY KEY,
    invoice_id    TEXT    NOT NULL,
    customer_id   TEXT    NOT NULL,
    invoice_ts    TEXT    NOT NULL,           -- 'YYYY-MM-DD HH:MM:SS'
    invoice_day   TEXT    NOT NULL,           -- 'YYYY-MM-DD'
    invoice_month TEXT    NOT NULL,           -- 'YYYY-MM'
    month_num     INTEGER NOT NULL,           -- year * 12 + (month - 1); used for cohort offsets
    product_id    TEXT    NOT NULL,
    description   TEXT,
    category      TEXT,
    quantity      REAL    NOT NULL,           -- negative for returns
    unit_price    REAL    NOT NULL CHECK (unit_price >= 0),
    revenue       REAL    NOT NULL,           -- quantity * unit_price (negative for returns)
    country       TEXT,
    is_return     INTEGER NOT NULL DEFAULT 0 CHECK (is_return IN (0, 1))
);

CREATE INDEX IF NOT EXISTS ix_tx_customer      ON transactions (customer_id);
CREATE INDEX IF NOT EXISTS ix_tx_day           ON transactions (invoice_day);
CREATE INDEX IF NOT EXISTS ix_tx_invoice       ON transactions (invoice_id);
CREATE INDEX IF NOT EXISTS ix_tx_return_day    ON transactions (is_return, invoice_day);
CREATE INDEX IF NOT EXISTS ix_tx_product       ON transactions (product_id);

-- Key/value metadata about the loaded dataset (source, synthetic flag, load time ...)
CREATE TABLE IF NOT EXISTS dataset_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Rows excluded during cleaning, kept for auditability.
CREATE TABLE IF NOT EXISTS rejected_rows (
    source_row INTEGER,
    reason     TEXT NOT NULL,
    raw        TEXT
);

-- Materialised RFM results. run_key identifies (dataset version, snapshot date, config)
-- so concurrent filter states never overwrite each other's segments.
CREATE TABLE IF NOT EXISTS customer_segments (
    run_key       TEXT    NOT NULL,
    customer_id   TEXT    NOT NULL,
    last_purchase TEXT,
    recency_days  INTEGER NOT NULL,
    frequency     INTEGER NOT NULL,
    monetary      REAL    NOT NULL,
    r_score       INTEGER NOT NULL,
    f_score       INTEGER NOT NULL,
    m_score       INTEGER NOT NULL,
    fm_score      INTEGER NOT NULL,
    rfm_code      TEXT    NOT NULL,
    segment       TEXT    NOT NULL,
    PRIMARY KEY (run_key, customer_id)
);

CREATE INDEX IF NOT EXISTS ix_seg_run_segment ON customer_segments (run_key, segment);

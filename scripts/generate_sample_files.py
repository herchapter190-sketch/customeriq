"""Write small SYNTHETIC sample files for testing the CSV and Excel import paths.

Usage:  python scripts/generate_sample_files.py
Outputs data/sample/sample_transactions.csv and data/sample/sample_transactions.xlsx.
The files are generated (not real customers) and include a few deliberate data-quality
issues so the validation summary has something to report.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.config import SAMPLE_DIR  # noqa: E402
from src.etl.synthetic import generate_demo_transactions  # noqa: E402


def main() -> None:
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    raw = generate_demo_transactions(n_customers=250, seed=7)
    # Rename to a different, common export style so column auto-mapping is exercised.
    csv = raw.rename(columns={"InvoiceNo": "Invoice", "CustomerID": "Customer ID", "UnitPrice": "Price"})
    csv.to_csv(SAMPLE_DIR / "sample_transactions.csv", index=False)
    xlsx = raw.rename(columns={"InvoiceNo": "Order ID", "StockCode": "SKU", "InvoiceDate": "Order Date",
                               "UnitPrice": "Unit Price", "CustomerID": "Customer"})
    xlsx.to_excel(SAMPLE_DIR / "sample_transactions.xlsx", index=False, sheet_name="Transactions")
    print(f"Wrote {len(raw):,} rows to {SAMPLE_DIR}")


if __name__ == "__main__":
    main()

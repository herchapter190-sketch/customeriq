"""Shared fixtures.

``known_conn`` loads a tiny dataset whose every metric has been calculated by hand
(see the table below), so SQL results can be checked against independent values.

Customer A: 2024-01-05 inv 1001 (2 x 10.00 + 1 x 5.00 = 25.00)
            2024-02-10 inv 1002 (3 x 10.00 = 30.00)
            2024-02-12 return C1002 (-1 x 10.00 = -10.00)
            2024-03-15 inv 1003 (1 x 50.00 = 50.00)
Customer B: 2024-01-20 inv 1004 (4 x 25.00 = 100.00)
            2024-03-02 inv 1005 (2 x 25.00 = 50.00)
Customer C: 2024-02-03 inv 1006 (1 x 200.00 = 200.00)
Customer D: 2024-03-28 inv 1007 (5 x 4.00 = 20.00)

Totals: gross 475.00, returns 10.00, net 465.00, 7 orders, 4 customers, 2 repeat.
"""
from __future__ import annotations

import pandas as pd
import pytest

from src.analytics.context import AnalysisFilters, prepare_context
from src.database.connection import connect
from src.etl.pipeline import import_dataframe, load_demo_dataset

KNOWN_MAPPING = {
    "invoice_id": "Invoice", "customer_id": "Customer", "invoice_date": "Date", "quantity": "Qty",
    "unit_price": "Price", "product_id": "SKU", "description": "Name", "category": "Category",
    "country": "Country", "revenue": None,
}

KNOWN_ROWS = [
    # Invoice, Customer, Date, SKU, Name, Category, Qty, Price, Country
    ("1001", "A", "2024-01-05 10:00", "P1", "Mug", "Kitchen", 2, 10.0, "UK"),
    ("1001", "A", "2024-01-05 10:00", "P2", "Towel", "Kitchen", 1, 5.0, "UK"),
    ("1002", "A", "2024-02-10 11:00", "P1", "Mug", "Kitchen", 3, 10.0, "UK"),
    ("C1002", "A", "2024-02-12 09:00", "P1", "Mug", "Kitchen", -1, 10.0, "UK"),
    ("1003", "A", "2024-03-15 12:00", "P3", "Lamp", "Lighting", 1, 50.0, "UK"),
    ("1004", "B", "2024-01-20 13:00", "P4", "Vase", "Decor", 4, 25.0, "France"),
    ("1005", "B", "2024-03-02 14:00", "P4", "Vase", "Decor", 2, 25.0, "France"),
    ("1006", "C", "2024-02-03 15:00", "P5", "Mirror", "Decor", 1, 200.0, "Germany"),
    ("1007", "D", "2024-03-28 16:00", "P6", "Card", "Stationery", 5, 4.0, "UK"),
]


def known_frame() -> pd.DataFrame:
    return pd.DataFrame(KNOWN_ROWS, columns=["Invoice", "Customer", "Date", "SKU", "Name", "Category", "Qty",
                                             "Price", "Country"])


@pytest.fixture
def known_conn():
    conn = connect(":memory:")
    result = import_dataframe(conn, known_frame(), KNOWN_MAPPING, source_name="known test data")
    assert result.summary["clean_rows"] == len(KNOWN_ROWS)
    yield conn
    conn.close()


@pytest.fixture
def known_ctx(known_conn):
    return prepare_context(known_conn, AnalysisFilters("2024-01-01", "2024-03-31"))


@pytest.fixture(scope="session")
def demo_conn():
    conn = connect(":memory:")
    load_demo_dataset(conn, n_customers=400)
    yield conn
    conn.close()


@pytest.fixture(scope="session")
def demo_ctx(demo_conn):
    from src.analytics.context import default_filters
    return prepare_context(demo_conn, default_filters(demo_conn))

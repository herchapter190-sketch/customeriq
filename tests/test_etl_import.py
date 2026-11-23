"""CSV / Excel import, column mapping and the end-to-end import pipeline."""
from __future__ import annotations

import io

import pandas as pd
import pytest

from src.database.connection import connect, get_meta, has_data
from src.etl.loader import apply_mapping, read_table, suggest_mapping
from src.etl.pipeline import import_dataframe
from tests.conftest import KNOWN_MAPPING, known_frame


def test_read_csv_comma(tmp_path):
    path = tmp_path / "tx.csv"
    known_frame().to_csv(path, index=False)
    df = read_table(path)
    assert len(df) == 9
    assert list(df.columns)[:3] == ["Invoice", "Customer", "Date"]
    # CSV values are read as text so validation (not the parser) decides validity
    assert df.loc[0, "Customer"] == "A"


def test_read_csv_semicolon_and_bom():
    text = "﻿Invoice;Customer;Date;Qty;Price\n1;A;2024-01-01;2;3.5\n"
    df = read_table(text.encode("utf-8"), "export.csv")
    assert list(df.columns) == ["Invoice", "Customer", "Date", "Qty", "Price"]
    assert len(df) == 1


def test_read_csv_latin1_fallback():
    data = "Invoice,Customer,Date,Qty,Price,Name\n1,A,2024-01-01,1,2,Caf\xe9 mug\n".encode("latin-1")
    df = read_table(data, "legacy.csv")
    assert df.loc[0, "Name"] == "Café mug"


def test_read_excel(tmp_path):
    path = tmp_path / "tx.xlsx"
    frame = known_frame()
    frame["Date"] = pd.to_datetime(frame["Date"])  # native Excel dates
    frame.to_excel(path, index=False)
    df = read_table(path)
    assert len(df) == 9
    conn = connect(":memory:")
    result = import_dataframe(conn, df, KNOWN_MAPPING, source_name="tx.xlsx")
    assert result.summary["clean_rows"] == 9
    assert result.summary["net_revenue"] == pytest.approx(465.0)


def test_read_rejects_unknown_extension():
    with pytest.raises(ValueError, match="Unsupported file type"):
        read_table(b"abc", "data.json")


def test_read_rejects_empty_file():
    with pytest.raises(ValueError, match="empty"):
        read_table(b"", "data.csv")


def test_suggest_mapping_uci_online_retail():
    cols = ["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice", "CustomerID", "Country"]
    m = suggest_mapping(cols)
    assert m["invoice_id"] == "InvoiceNo"
    assert m["customer_id"] == "CustomerID"
    assert m["invoice_date"] == "InvoiceDate"
    assert m["unit_price"] == "UnitPrice"
    assert m["product_id"] == "StockCode"
    assert m["category"] is None


def test_suggest_mapping_online_retail_ii():
    cols = ["Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"]
    m = suggest_mapping(cols)
    assert (m["invoice_id"], m["customer_id"], m["unit_price"]) == ("Invoice", "Customer ID", "Price")


def test_apply_mapping_requires_required_fields():
    with pytest.raises(ValueError, match="Required fields"):
        apply_mapping(known_frame(), {**KNOWN_MAPPING, "customer_id": None})


def test_apply_mapping_rejects_duplicate_columns():
    with pytest.raises(ValueError, match="only one field"):
        apply_mapping(known_frame(), {**KNOWN_MAPPING, "description": "SKU"})


def test_import_writes_metadata_and_is_atomic():
    conn = connect(":memory:")
    import_dataframe(conn, known_frame(), KNOWN_MAPPING, source_name="first.csv")
    assert has_data(conn)
    meta = get_meta(conn)
    assert meta["source_name"] == "first.csv"
    assert meta["is_synthetic"] is False

    # A file with no valid rows must NOT wipe the existing dataset.
    bad = known_frame().assign(Customer="")
    result = import_dataframe(conn, bad, KNOWN_MAPPING, source_name="bad.csv")
    assert result.clean.empty
    assert get_meta(conn)["source_name"] == "first.csv"
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 9


def test_sample_csv_roundtrip_through_buffer():
    buf = io.BytesIO()
    known_frame().to_csv(buf, index=False)
    buf.seek(0)
    buf.name = "upload.csv"
    df = read_table(buf)
    assert len(df) == 9

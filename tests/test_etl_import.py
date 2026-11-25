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


def test_read_csv_trailing_delimiter_keeps_columns_aligned():
    # Every row ends with a delimiter the header lacks; pandas would otherwise index on Invoice and shift values left.
    df = read_table(b"Invoice,Customer,Date,Qty,Price\n1,A,2024-01-01,2,3.5,\n2,B,2024-01-02,1,4,\n", "export.csv")
    assert list(df.columns) == ["Invoice", "Customer", "Date", "Qty", "Price"]
    assert df.to_dict("records")[1] == {"Invoice": "2", "Customer": "B", "Date": "2024-01-02", "Qty": "1", "Price": "4"}


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


# --------------------------------------------------------------------------- sheets, currency, line totals
from src.etl.cleaner import clean_transactions, detect_currency  # noqa: E402

LINE_MAP = {"invoice_id": "Invoice", "customer_id": "Customer", "invoice_date": "Date", "quantity": "Qty",
            "revenue": "Total"}


def _xlsx(**sheets: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for name, df in sheets.items():
            df.to_excel(xw, sheet_name=name, index=False)
    return buf.getvalue()


def test_excel_sheet_selection_and_first_sheet_with_data():
    data = _xlsx(Notes=pd.DataFrame(), Sales=known_frame(), Old=known_frame().head(2))
    df = read_table(data, "book.xlsx")
    assert df.attrs["sheets"] == ["Notes", "Sales", "Old"] and df.attrs["sheet"] == "Sales" and len(df) == 9
    old = read_table(data, "book.xlsx", sheet="Old")
    assert old.attrs["sheet"] == "Old" and len(old) == 2
    with pytest.raises(ValueError, match="Sheet not found"):
        read_table(data, "book.xlsx", sheet="Missing")


def test_line_totals_without_unit_price():
    raw = pd.DataFrame({"Invoice": ["1", "1", "C2"], "Customer": ["A", "A", "A"],
                        "Date": ["2024-01-01", "2024-01-01", "2024-01-05"], "Qty": ["2", "3", "-1"],
                        "Total": ["7.00", "4.50", "-3.50"]})
    res = clean_transactions(apply_mapping(raw, LINE_MAP))
    assert res.clean["unit_price"].round(2).tolist() == [3.5, 1.5, 3.5]
    assert res.clean["revenue"].tolist() == [7.0, 4.5, -3.5]
    assert any("derived" in w for w in res.warnings)
    with pytest.raises(ValueError, match="Unit price or Line total"):
        apply_mapping(raw, {k: v for k, v in LINE_MAP.items() if k != "revenue"})


def test_mixed_currencies_are_refused_single_currency_is_recorded():
    base = {"Invoice": ["1", "2"], "Customer": ["A", "B"], "Date": ["2024-01-01"] * 2, "Qty": ["1", "1"]}
    with pytest.raises(ValueError, match=r"Mixed currencies found \(\$, EUR\)"):
        clean_transactions(apply_mapping(pd.DataFrame(base | {"Total": ["$5", "€5"]}), LINE_MAP))
    cur = pd.DataFrame(base | {"Total": ["5", "6"], "Cur": ["usd", "GBP"]})
    with pytest.raises(ValueError, match="Mixed currencies"):
        detect_currency(apply_mapping(cur, LINE_MAP | {"currency": "Cur"}))
    one = clean_transactions(apply_mapping(pd.DataFrame(base | {"Total": ["£5", "£6"]}), LINE_MAP))
    assert one.summary["currency"] == "GBP" and one.clean["revenue"].sum() == 11
    assert clean_transactions(apply_mapping(known_frame(), KNOWN_MAPPING)).summary["currency"] is None


def test_bare_dollar_is_never_assumed_to_be_usd():
    from src.etl.cleaner import AmbiguousCurrency
    base = {"Invoice": ["1", "2"], "Customer": ["A", "B"], "Date": ["2024-01-01"] * 2, "Qty": ["1", "1"]}
    dollars = apply_mapping(pd.DataFrame(base | {"Total": ["$5", "$6"]}), LINE_MAP)
    with pytest.raises(AmbiguousCurrency, match="USD, CAD or AUD"):
        clean_transactions(dollars)
    chosen = clean_transactions(dollars, currency="CAD")
    assert chosen.summary["currency"] == "CAD" and chosen.clean["revenue"].sum() == 11
    with pytest.raises(ValueError, match="Currency conflict"):
        detect_currency(dollars, "GBP")
    with pytest.raises(ValueError, match="Unsupported currency: XYZ"):
        detect_currency(dollars, "XYZ")
    # A currency column or a prefixed symbol names the dollar; "CA$" is not misread as "A$" or "$".
    col = pd.DataFrame(base | {"Total": ["$5", "$6"], "Cur": ["aud", "AUD"]})
    assert detect_currency(apply_mapping(col, LINE_MAP | {"currency": "Cur"})) == "AUD"
    cad = clean_transactions(apply_mapping(pd.DataFrame(base | {"Total": ["CA$5", "CA$1,000.50"]}), LINE_MAP))
    assert cad.summary["currency"] == "CAD" and cad.clean["revenue"].sum() == 1005.5
    for totals in (["US$5", "A$6"], ["$5", "£6"]):
        with pytest.raises(ValueError, match="Mixed currencies"):
            detect_currency(apply_mapping(pd.DataFrame(base | {"Total": totals}), LINE_MAP))
    # Codes the app cannot label are named, never shown as another currency or as "not specified".
    inr = pd.DataFrame(base | {"Total": ["5", "6"], "Cur": ["INR", "INR"]})
    with pytest.raises(ValueError, match=r"Unsupported currency: INR\. Supported: USD, CAD, AUD"):
        clean_transactions(apply_mapping(inr, LINE_MAP | {"currency": "Cur"}))

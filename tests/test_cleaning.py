"""Validation and cleaning rules, including edge cases."""
from __future__ import annotations

import pandas as pd
import pytest

from src.config import CleaningOptions
from src.etl.cleaner import clean_transactions
from src.etl.loader import apply_mapping
from tests.conftest import KNOWN_MAPPING, known_frame


def clean(df, **opts):
    return clean_transactions(apply_mapping(df, KNOWN_MAPPING), CleaningOptions(**opts))


def row(**overrides):
    base = {"Invoice": "9001", "Customer": "Z", "Date": "2024-05-01 10:00", "SKU": "P1", "Name": "Mug",
            "Category": "Kitchen", "Qty": 1, "Price": 10.0, "Country": "UK"}
    base.update(overrides)
    return base


def test_clean_known_dataset_totals():
    r = clean(known_frame())
    s = r.summary
    assert s["input_rows"] == 9 and s["clean_rows"] == 9 and s["rejected_rows"] == 0
    assert s["sales_rows"] == 8 and s["return_rows"] == 1
    assert s["gross_sales"] == pytest.approx(475.0)
    assert s["returns_value"] == pytest.approx(10.0)
    assert s["net_revenue"] == pytest.approx(465.0)
    assert s["customers"] == 4 and s["sales_invoices"] == 7


def test_exact_duplicate_rows_removed_keep_first():
    df = pd.DataFrame([row(), row(), row(Invoice="9002")])
    r = clean(df)
    assert r.summary["duplicate_rows"] == 1
    assert r.summary["rejection_counts"]["duplicate_row"] == 1
    assert len(r.clean) == 2
    assert r.rejected.iloc[0]["source_row"] == 2


def test_same_product_different_quantity_is_not_duplicate():
    df = pd.DataFrame([row(), row(Qty=2)])
    assert len(clean(df).clean) == 2


def test_missing_customer_ids_rejected():
    df = pd.DataFrame([row(Customer=""), row(Customer=None), row(Customer="nan"), row(Invoice="9002")])
    r = clean(df)
    assert r.summary["rejection_counts"]["missing_customer_id"] == 3
    assert len(r.clean) == 1


def test_invalid_customer_id_rejected():
    df = pd.DataFrame([row(Customer="bad id!"), row(Invoice="9002", Customer="C-12_3.x")])
    r = clean(df)
    assert r.summary["rejection_counts"]["invalid_customer_id"] == 1
    assert list(r.clean["customer_id"]) == ["C-12_3.x"]


def test_numeric_customer_ids_normalised():
    df = pd.DataFrame([row(Customer=12345.0), row(Invoice="9002", Customer="12345.0")])
    r = clean(df)
    assert set(r.clean["customer_id"]) == {"12345"}


def test_negative_quantity_is_return_not_sale():
    df = pd.DataFrame([row(), row(Invoice="9002", Qty=-1)])
    r = clean(df)
    returns = r.clean[r.clean["is_return"] == 1]
    assert len(returns) == 1
    assert returns.iloc[0]["revenue"] == pytest.approx(-10.0)
    assert r.summary["net_revenue"] == pytest.approx(0.0)


def test_cancellation_prefix_forces_return_sign():
    df = pd.DataFrame([row(Invoice="C9001", Qty=2)])
    r = clean(df)
    assert r.clean.iloc[0]["is_return"] == 1
    assert r.clean.iloc[0]["quantity"] == -2
    # A prefix that is not followed by a digit is a normal invoice ID
    r2 = clean(pd.DataFrame([row(Invoice="CUST01")]))
    assert r2.clean.iloc[0]["is_return"] == 0


def test_return_prefix_option_can_be_disabled():
    r = clean(pd.DataFrame([row(Invoice="C9001", Qty=2)]), return_invoice_prefix="")
    assert r.clean.iloc[0]["is_return"] == 0


def test_invalid_dates_rejected():
    df = pd.DataFrame([row(Date="2024-13-45"), row(Date="not a date"), row(Date="2023-02-30"),
                       row(Invoice="9002", Date="2024-05-02")])
    r = clean(df)
    assert r.summary["rejection_counts"]["invalid_date"] == 3
    assert list(r.clean["invoice_day"]) == ["2024-05-02"]


def test_mixed_date_formats_parsed():
    df = pd.DataFrame([row(Date="2024-05-01 10:00"), row(Invoice="2", Date="2024/05/03"),
                       row(Invoice="3", Date="05/04/2024 09:30")])
    r = clean(df)
    assert r.summary["rejected_rows"] == 0
    assert sorted(r.clean["invoice_day"]) == ["2024-05-01", "2024-05-03", "2024-05-04"]


def test_dayfirst_option():
    r = clean(pd.DataFrame([row(Date="03/04/2024")]), dayfirst=True)
    assert r.clean.iloc[0]["invoice_day"] == "2024-04-03"


def test_zero_and_negative_prices_and_zero_quantity():
    df = pd.DataFrame([row(Price=0), row(Invoice="2", Price=-5), row(Invoice="3", Qty=0),
                       row(Invoice="4", Price="abc"), row(Invoice="5", Qty="x"), row(Invoice="6")])
    r = clean(df)
    c = r.summary["rejection_counts"]
    assert (c["zero_unit_price"], c["negative_unit_price"], c["zero_quantity"],
            c["invalid_unit_price"], c["invalid_quantity"]) == (1, 1, 1, 1, 1)
    assert len(r.clean) == 1


def test_zero_price_kept_when_option_disabled():
    r = clean(pd.DataFrame([row(Price=0)]), drop_zero_price=False)
    assert len(r.clean) == 1 and r.clean.iloc[0]["revenue"] == 0


def test_currency_and_thousands_separators_parsed():
    r = clean(pd.DataFrame([row(Price="£1,234.50"), row(Invoice="2", Price="12,5")]))
    assert sorted(r.clean["unit_price"]) == [12.5, 1234.5]


def test_invoice_linked_to_two_customers_rejected():
    df = pd.DataFrame([row(), row(Customer="Y", SKU="P2"), row(Invoice="9002")])
    r = clean(df)
    assert r.summary["rejection_counts"]["invoice_customer_conflict"] == 2
    assert list(r.clean["invoice_id"]) == ["9002"]
    assert any("more than one customer" in w for w in r.warnings)


def test_missing_invoice_id_rejected():
    r = clean(pd.DataFrame([row(Invoice=""), row(Invoice="9002")]))
    assert r.summary["rejection_counts"]["missing_invoice_id"] == 1


def test_missing_product_id_labelled_unknown():
    r = clean(pd.DataFrame([row(SKU="")]))
    assert r.clean.iloc[0]["product_id"] == "UNKNOWN"
    assert any("no product ID" in w for w in r.warnings)


def test_revenue_column_mismatch_warning():
    df = pd.DataFrame([{**row(), "Rev": 999}])
    mapping = {**KNOWN_MAPPING, "revenue": "Rev"}
    r = clean_transactions(apply_mapping(df, mapping))
    assert r.clean.iloc[0]["revenue"] == pytest.approx(10.0)  # recomputed
    assert any("recalculated" in w for w in r.warnings)


def test_empty_dataset():
    empty = known_frame().iloc[0:0]
    r = clean(empty)
    assert r.clean.empty and r.summary["input_rows"] == 0
    assert "no rows" in r.warnings[0]


def test_all_rows_invalid():
    r = clean(known_frame().assign(Customer=""))
    assert r.clean.empty
    assert r.summary["rejected_rows"] == 9


def test_derived_date_columns():
    r = clean(pd.DataFrame([row(Date="2024-12-31 23:59")]))
    rec = r.clean.iloc[0]
    assert rec["invoice_ts"] == "2024-12-31 23:59:00"
    assert rec["invoice_month"] == "2024-12"
    assert rec["month_num"] == 2024 * 12 + 11

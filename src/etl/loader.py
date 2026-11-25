"""Read CSV / Excel files and map source columns onto the CustomerIQ schema."""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from typing import BinaryIO

import pandas as pd

# Standard field -> (required?, human label)
STANDARD_FIELDS: dict[str, tuple[bool, str]] = {
    "invoice_id": (True, "Invoice ID"),
    "customer_id": (True, "Customer ID"),
    "invoice_date": (True, "Transaction date"),
    "quantity": (True, "Quantity"),
    "unit_price": (False, "Unit price (or map Line total)"),
    "product_id": (False, "Product ID"),
    "description": (False, "Product description"),
    "category": (False, "Category"),
    "country": (False, "Country"),
    "revenue": (False, "Line total (used when there is no unit price)"),
    "currency": (False, "Currency"),
}

REQUIRED_FIELDS = [k for k, (req, _) in STANDARD_FIELDS.items() if req]
# One of these must be mapped: with only a line total, unit price is derived as total / quantity.
PRICE_FIELDS = ("unit_price", "revenue")

# Normalised synonyms (lower-case, alphanumerics only). Covers the UCI "Online
# Retail" and "Online Retail II" datasets and common e-commerce exports.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "invoice_id": ("invoiceid", "invoiceno", "invoice", "invoicenumber", "orderid", "orderno",
                   "ordernumber", "order", "transactionid", "receiptid"),
    "customer_id": ("customerid", "customer", "customerno", "customernumber", "clientid",
                    "userid", "buyerid", "accountid"),
    "invoice_date": ("invoicedate", "date", "orderdate", "transactiondate", "purchasedate",
                     "timestamp", "datetime", "invoicedatetime", "createdat"),
    "quantity": ("quantity", "qty", "units", "unitsordered", "itemquantity", "count"),
    "unit_price": ("unitprice", "price", "itemprice", "priceeach", "unitcost", "saleprice"),
    "product_id": ("productid", "stockcode", "sku", "itemid", "productcode", "itemcode", "product"),
    "description": ("description", "productdescription", "productname", "itemname", "itemdescription", "name"),
    "category": ("category", "productcategory", "department", "itemcategory", "categoryname"),
    "country": ("country", "countryname", "region", "market", "shipcountry"),
    "revenue": ("revenue", "sales", "amount", "totalprice", "linetotal", "total", "salesamount"),
    "currency": ("currency", "currencycode", "curr", "currencyid", "ccy"),
}

SUPPORTED_EXTENSIONS = (".csv", ".txt", ".xlsx", ".xlsm")
MAX_UPLOAD_MB = 200
# An .xlsx is a ZIP archive; a small upload can expand to gigabytes of XML ("zip bomb").
# The declared uncompressed sizes are checked before parsing; Python's zipfile never
# yields more bytes than a member declares, so the limit also bounds what openpyxl reads.
# 1 GiB comfortably fits real exports (UCI Online Retail II is ~45 MB zipped).
MAX_XLSX_EXPANDED_MB = 1024
MAX_XLSX_MEMBERS = 10_000


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def suggest_mapping(columns: list[str]) -> dict[str, str | None]:
    """Best-effort automatic mapping from standard fields to source columns."""
    normalised = {_norm(c): c for c in columns}
    mapping: dict[str, str | None] = {}
    used: set[str] = set()
    for field, candidates in SYNONYMS.items():
        mapping[field] = None
        for cand in (field.replace("_", ""), *candidates):
            col = normalised.get(cand)
            if col is not None and col not in used:
                mapping[field] = col
                used.add(col)
                break
    return mapping


def read_table(source: str | Path | BinaryIO | bytes, filename: str | None = None,
               sheet: str | None = None) -> pd.DataFrame:
    """Read a CSV or Excel file into a DataFrame of raw (mostly string) values.

    ``source`` may be a path, raw bytes or a file-like object (e.g. a Streamlit upload).
    Columns are read as strings for CSV so that validation, not the parser, decides
    what is valid. Excel cells keep native types (dates stay dates).

    Excel: ``sheet`` picks a worksheet by name; without it the first sheet with data rows is
    read. The workbook's sheet names and the sheet read are in ``df.attrs["sheets"]`` / ``["sheet"]``.
    """
    if isinstance(source, (str, Path)):
        filename = filename or str(source)
        data = Path(source).read_bytes()
    elif isinstance(source, bytes):
        data = source
    else:
        data = source.read()
        filename = filename or getattr(source, "name", None)
    if not filename:
        raise ValueError("A filename is required to determine the file type")
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type {ext!r}. Use CSV or Excel (.xlsx).")
    if len(data) == 0:
        raise ValueError("The file is empty.")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise ValueError(f"File exceeds {MAX_UPLOAD_MB} MB.")

    if ext in (".xlsx", ".xlsm"):
        check_xlsx_expansion(data)
        with pd.ExcelFile(io.BytesIO(data), engine="openpyxl") as xl:
            sheets = [str(n) for n in xl.sheet_names]
            if sheet is not None and sheet not in sheets:
                raise ValueError("Sheet not found in the workbook.")
            for name in [sheet] if sheet is not None else sheets:
                df = _tidy(xl.parse(name))
                if not df.empty:
                    break
        df.attrs.update(sheets=sheets, sheet=name)
        return df
    return _tidy(_read_csv_bytes(data))


def _tidy(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [str(c).strip() for c in df.columns]
    return df.dropna(how="all").reset_index(drop=True)


def check_xlsx_expansion(data: bytes, max_mb: int | None = None, max_members: int | None = None) -> None:
    """Reject an Excel workbook whose ZIP contents would expand beyond ``max_mb``."""
    max_mb = MAX_XLSX_EXPANDED_MB if max_mb is None else max_mb
    max_members = MAX_XLSX_MEMBERS if max_members is None else max_members
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
    except (zipfile.BadZipFile, OSError):
        raise ValueError("The file is not a valid Excel workbook.") from None
    if len(infos) > max_members:
        raise ValueError(f"Excel workbook expands to too many parts (over {max_members:,}).")
    if sum(i.file_size for i in infos) > max_mb * 1024 * 1024:
        raise ValueError(f"Excel workbook expands beyond {max_mb:,} MB when unpacked; "
                         "export it as CSV or split it into smaller files.")


def _read_csv_bytes(data: bytes) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
        first_line = text.split("\n", 1)[0]
        sep = max((",", ";", "\t", "|"), key=first_line.count)
        # index_col=False: a trailing delimiter on every row must not turn the first column into the index.
        return pd.read_csv(io.StringIO(text), sep=sep, dtype=str, keep_default_na=False,
                           na_values=[""], skipinitialspace=True, index_col=False)
    raise ValueError(f"Could not decode file: {last_error}")


def apply_mapping(raw: pd.DataFrame, mapping: dict[str, str | None]) -> pd.DataFrame:
    """Rename mapped source columns to standard names; unmapped optional fields become empty."""
    missing = [STANDARD_FIELDS[f][1] for f in REQUIRED_FIELDS if not mapping.get(f)]
    if not any(mapping.get(f) for f in PRICE_FIELDS):
        missing.append("Unit price or Line total")
    if missing:
        labels = ", ".join(missing)
        raise ValueError(f"Required fields are not mapped: {labels}")
    chosen = [c for c in mapping.values() if c]
    if len(chosen) != len(set(chosen)):
        raise ValueError("Each source column can be mapped to only one field.")
    absent = [c for c in chosen if c not in raw.columns]
    if absent:
        raise ValueError(f"Mapped columns not found in file: {absent}")
    out = pd.DataFrame(index=raw.index)
    for field in STANDARD_FIELDS:
        col = mapping.get(field)
        out[field] = raw[col] if col else pd.Series([None] * len(raw), index=raw.index, dtype=object)
    return out

"""Validation and cleaning of transaction lines.

Input: a DataFrame with the standard field names produced by
:func:`src.etl.loader.apply_mapping`. Output: clean rows ready for the database,
an audit table of rejected rows with a reason, and a summary.

Rules (applied in this order, first failing rule wins):

=========================== =====================================================
missing_invoice_id          invoice ID empty
missing_customer_id         customer ID empty (e.g. guest checkout) - cannot be
                            attributed to a customer, so excluded from analysis
invalid_customer_id         contains characters outside ``A-Z a-z 0-9 _ . -``
invalid_date                date cannot be parsed
invalid_quantity            quantity not numeric
zero_quantity               quantity equals zero
invalid_unit_price          unit price not numeric
negative_unit_price         unit price below zero (accounting adjustments)
zero_unit_price             unit price zero (free items / samples), optional
duplicate_row               exact duplicate of an earlier line
invoice_customer_conflict   one invoice ID used by several customers
=========================== =====================================================

Returns: a line is a return when its quantity is negative or the invoice ID starts
with the cancellation prefix followed by a digit (``C536379``). Return lines are kept
with negative quantity and revenue and ``is_return = 1``.
"""
from __future__ import annotations

import json
import re
import warnings as warnings_module
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd

from src.config import CleaningOptions

REJECTION_REASONS: dict[str, str] = {
    "missing_invoice_id": "Missing invoice ID",
    "missing_customer_id": "Missing customer ID",
    "invalid_customer_id": "Invalid customer ID format",
    "invalid_date": "Unparseable transaction date",
    "invalid_quantity": "Quantity is not numeric",
    "zero_quantity": "Quantity is zero",
    "invalid_unit_price": "Unit price (or line total) is not numeric",
    "negative_unit_price": "Negative unit price (adjustment)",
    "zero_unit_price": "Zero unit price",
    "duplicate_row": "Exact duplicate line",
    "invoice_customer_conflict": "Invoice ID linked to multiple customers",
}

COMMON_FORMATS = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S",
                  "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y", "%Y/%m/%d %H:%M", "%Y/%m/%d"]
DAYFIRST_FORMATS = ["%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%d.%m.%Y %H:%M", "%d.%m.%Y",
                    "%d-%m-%Y %H:%M", "%d-%m-%Y"]
NULL_TOKENS = {"", "nan", "none", "null", "na", "n/a", "nat", "-", "?"}
CUSTOMER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$")
INTEGER_FLOAT_PATTERN = re.compile(r"^-?\d+\.0+$")
CLEAN_COLUMNS = [
    "invoice_id", "customer_id", "invoice_ts", "invoice_day", "invoice_month", "month_num",
    "product_id", "description", "category", "quantity", "unit_price", "revenue",
    "country", "is_return",
]


@dataclass
class CleaningResult:
    clean: pd.DataFrame
    rejected: pd.DataFrame
    summary: dict
    warnings: list[str] = field(default_factory=list)

    @property
    def rejection_table(self) -> pd.DataFrame:
        counts = self.summary.get("rejection_counts", {})
        rows = [{"Rule": REJECTION_REASONS.get(k, k), "Code": k, "Rows": v} for k, v in counts.items() if v]
        return pd.DataFrame(rows, columns=["Rule", "Code", "Rows"])


def _omap(series: pd.Series, fn) -> pd.Series:
    """Element-wise map that always returns an object Series (None stays None).

    pandas 3 infers a string dtype from ``Series.map`` and converts None to NaN,
    which would break the explicit None checks used throughout this module.
    """
    return pd.Series([fn(v) for v in series.astype(object)], index=series.index, dtype=object)


def _to_text(series: pd.Series) -> pd.Series:
    def conv(v):
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        text = str(v).strip()
        return None if text.lower() in NULL_TOKENS else text
    return _omap(series, conv)


def _normalise_id(series: pd.Series) -> pd.Series:
    """Text IDs; '12345.0' (an artefact of numeric parsing) becomes '12345'."""
    text = _to_text(series)
    return _omap(text, lambda v: v.split(".")[0] if v is not None and INTEGER_FLOAT_PATTERN.match(v) else v)


def _to_number(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce").astype(float)
    text = _omap(_to_text(series), lambda v: v if v is None else re.sub(r"(?:US|CA|AU|C|A)?\$|[£€\s]", "", v))
    # European decimal comma ("12,5") -> "12.5"; otherwise commas are thousand separators.
    text = _omap(text, lambda v: v if v is None else (v.replace(",", ".") if re.fullmatch(r"-?\d+,\d{1,2}", v) else v.replace(",", "")))
    return pd.to_numeric(text, errors="coerce").astype(float)


def _to_datetime(series: pd.Series, dayfirst: bool) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(series):
        parsed = pd.to_datetime(series, errors="coerce")
    else:
        values = _omap(series, lambda v: v.strip() if isinstance(v, str) else v)
        values = _omap(values, lambda v: None if isinstance(v, str) and v.lower() in NULL_TOKENS else v)
        # Fast path: the explicit format that parses the most values wins.
        formats = DAYFIRST_FORMATS + COMMON_FORMATS if dayfirst else COMMON_FORMATS + DAYFIRST_FORMATS
        sample = values.dropna().astype(str).head(500)
        best_fmt, best_hits = None, 0
        for fmt in formats:
            hits = int(pd.to_datetime(sample, errors="coerce", format=fmt).notna().sum()) if len(sample) else 0
            if hits > best_hits:
                best_fmt, best_hits = fmt, hits
        if best_fmt is not None:
            parsed = pd.to_datetime(values.astype(str).where(values.notna(), None), errors="coerce", format=best_fmt)
        else:
            parsed = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
        # Per-element fallback only for values the explicit format missed
        # (mixed formats, native datetime objects from Excel, ...).
        retry = parsed.isna() & values.notna()
        if retry.any():
            with warnings_module.catch_warnings():
                warnings_module.simplefilter("ignore")
                parsed.loc[retry] = pd.to_datetime(values[retry], errors="coerce", dayfirst=dayfirst, format="mixed")
    if getattr(parsed.dt, "tz", None) is not None:
        parsed = parsed.dt.tz_localize(None)
    return parsed


def _empty_result(input_rows: int, warnings: list[str]) -> CleaningResult:
    clean = pd.DataFrame(columns=CLEAN_COLUMNS)
    rejected = pd.DataFrame(columns=["source_row", "reason", "raw"])
    return CleaningResult(clean, rejected, _summary(clean, rejected, input_rows, 0), warnings)


def _summary(clean: pd.DataFrame, rejected: pd.DataFrame, input_rows: int, duplicates: int) -> dict:
    sales = clean[clean["is_return"] == 0] if len(clean) else clean
    returns = clean[clean["is_return"] == 1] if len(clean) else clean
    counts = rejected["reason"].value_counts().to_dict() if len(rejected) else {}
    return {
        "input_rows": int(input_rows),
        "clean_rows": int(len(clean)),
        "sales_rows": int(len(sales)),
        "return_rows": int(len(returns)),
        "rejected_rows": int(len(rejected)),
        "duplicate_rows": int(duplicates),
        "rejection_counts": {k: int(counts.get(k, 0)) for k in REJECTION_REASONS},
        "customers": int(clean["customer_id"].nunique()) if len(clean) else 0,
        "sales_invoices": int(sales["invoice_id"].nunique()) if len(sales) else 0,
        "return_invoices": int(returns["invoice_id"].nunique()) if len(returns) else 0,
        "products": int(clean["product_id"].nunique()) if len(clean) else 0,
        "date_min": str(clean["invoice_day"].min()) if len(clean) else None,
        "date_max": str(clean["invoice_day"].max()) if len(clean) else None,
        "gross_sales": round(float(sales["revenue"].sum()), 2) if len(sales) else 0.0,
        "returns_value": round(float(-returns["revenue"].sum()), 2) if len(returns) else 0.0,
        "net_revenue": round(float(clean["revenue"].sum()), 2) if len(clean) else 0.0,
    }


# Currencies the app can label; web/src/lib/format.ts CURRENCIES lists the same codes.
SUPPORTED_CURRENCIES = ("USD", "CAD", "AUD", "EUR", "GBP", "JOD", "AED", "SAR")
DOLLAR_CURRENCIES = ("USD", "CAD", "AUD")
DOLLAR = "$"  # a bare "$" could be any dollar currency, so on its own it never decides the currency
# Symbols the number parser strips. Prefixed dollars come first so "CA$" is not also read as "A$" or "$".
CURRENCY_SYMBOLS = {"US$": "USD", "CA$": "CAD", "AU$": "AUD", "C$": "CAD", "A$": "AUD", "£": "GBP", "€": "EUR",
                    "$": DOLLAR}


class AmbiguousCurrency(ValueError):
    """Prices use a bare "$" and neither a currency column nor the importer says which dollar."""


def detect_currency(df: pd.DataFrame, declared: str | None = None) -> str | None:
    """The one currency of a mapped table (``declared``, a currency column or price symbols), or None.

    Raises ValueError when several currencies appear (their amounts would otherwise be summed as one),
    when a currency is not supported, or when ``declared`` contradicts the file; AmbiguousCurrency when
    prices use a bare "$" and nothing names the dollar.
    """
    found: set[str] = set()
    if "currency" in df:
        codes = _to_text(df["currency"]).dropna().str.upper()
        found |= {CURRENCY_SYMBOLS.get(c, c) for c in codes.unique()}
    for col in ("unit_price", "revenue"):
        if col in df and not pd.api.types.is_numeric_dtype(df[col]):
            text = df[col].dropna().astype(str)
            for sym, code in CURRENCY_SYMBOLS.items():
                if text.str.contains(sym, regex=False).any():
                    found.add(code)
                    text = text.str.replace(sym, "", regex=False)
    unsupported = sorted(found - {DOLLAR, *SUPPORTED_CURRENCIES})
    if declared is not None and declared not in SUPPORTED_CURRENCIES:
        unsupported.insert(0, declared)
    if unsupported:
        more = "…" if len(unsupported) > 5 else ""
        raise ValueError(f"Unsupported currency: {', '.join(unsupported[:5])}{more}. "
                         f"Supported: {', '.join(SUPPORTED_CURRENCIES)}.")
    named = found - {DOLLAR}
    if len(named) > 1 or (DOLLAR in found and named - set(DOLLAR_CURRENCIES)):
        raise ValueError(f"Mixed currencies found ({', '.join(sorted(found))}). Totals would add different "
                         "currencies together; import one currency per file.")
    if declared is not None:
        if (named and named != {declared}) or (DOLLAR in found and declared not in DOLLAR_CURRENCIES):
            raise ValueError(f"Currency conflict: the file uses {', '.join(sorted(found))}, not {declared}.")
        return declared
    if named:
        return next(iter(named))
    if DOLLAR in found:
        raise AmbiguousCurrency("Prices use '$', which could be USD, CAD or AUD. Choose the currency, "
                                "or map a Currency column.")
    return None


def clean_transactions(df: pd.DataFrame, options: CleaningOptions | None = None,
                       currency: str | None = None) -> CleaningResult:
    options = options or CleaningOptions()
    warnings: list[str] = []
    input_rows = len(df)
    if input_rows == 0:
        return _empty_result(0, ["The dataset contains no rows."])
    currency = detect_currency(df, currency)

    work = pd.DataFrame(index=df.index)
    work["source_row"] = np.arange(1, input_rows + 1)  # 1-based data row number
    work["invoice_id"] = _normalise_id(df["invoice_id"])
    work["customer_id"] = _normalise_id(df["customer_id"])
    work["ts"] = _to_datetime(df["invoice_date"], options.dayfirst)
    work["quantity"] = _to_number(df["quantity"])
    work["unit_price"] = _to_number(df["unit_price"])
    work["product_id"] = _normalise_id(df["product_id"]) if "product_id" in df else None
    work["description"] = _to_text(df["description"]) if "description" in df else None
    work["category"] = _to_text(df["category"]) if "category" in df else None
    work["country"] = _to_text(df["country"]) if "country" in df else None
    source_revenue = _to_number(df["revenue"]) if "revenue" in df else pd.Series(np.nan, index=df.index)
    # No unit prices, only line totals: derive the price; zero/invalid quantities are rejected first.
    derived_price = bool(work["unit_price"].isna().all() and source_revenue.notna().any())
    if derived_price:
        work["unit_price"] = source_revenue / work["quantity"].where(work["quantity"] != 0)

    reason = pd.Series([None] * input_rows, index=df.index, dtype=object)

    def flag(mask: pd.Series, code: str) -> None:
        reason[mask & reason.isna()] = code

    flag(work["invoice_id"].isna(), "missing_invoice_id")
    flag(work["customer_id"].isna(), "missing_customer_id")
    flag(_omap(work["customer_id"], lambda v: v is not None and not CUSTOMER_ID_PATTERN.match(v)).astype(bool),
         "invalid_customer_id")
    flag(work["ts"].isna(), "invalid_date")
    flag(work["quantity"].isna(), "invalid_quantity")
    flag(work["quantity"] == 0, "zero_quantity")
    flag(work["unit_price"].isna(), "invalid_unit_price")
    flag(work["unit_price"] < 0, "negative_unit_price")
    if options.drop_zero_price:
        flag(work["unit_price"] == 0, "zero_unit_price")

    # Exact duplicates among otherwise-valid rows (keep the first occurrence).
    dup_key = ["invoice_id", "customer_id", "ts", "product_id", "description", "quantity", "unit_price"]
    valid = reason.isna()
    dup_mask = pd.Series(False, index=df.index)
    dup_mask[valid] = work.loc[valid, dup_key].astype(str).duplicated(keep="first")
    flag(dup_mask, "duplicate_row")
    duplicates = int(dup_mask.sum())

    # One invoice must belong to one customer.
    valid = reason.isna()
    per_invoice = work.loc[valid].groupby("invoice_id")["customer_id"].nunique()
    conflicted = set(per_invoice[per_invoice > 1].index)
    if conflicted:
        flag(work["invoice_id"].isin(conflicted), "invoice_customer_conflict")
        warnings.append(f"{len(conflicted)} invoice ID(s) were linked to more than one customer and were excluded.")

    rejected_idx = reason.notna()
    raw_records = df.loc[rejected_idx].astype(object).where(df.loc[rejected_idx].notna(), None).to_dict("records")
    rejected = pd.DataFrame({
        "source_row": work.loc[rejected_idx, "source_row"].astype(int).to_numpy(),
        "reason": reason[rejected_idx].to_numpy(),
        "raw": [json.dumps(r, default=str) for r in raw_records],
    })

    good = work.loc[~rejected_idx].copy()
    if good.empty:
        warnings.append("No valid transactions remain after validation.")
        result = _empty_result(input_rows, warnings)
        result.rejected = rejected
        result.summary = _summary(result.clean, rejected, input_rows, duplicates) | {"currency": currency}
        return result

    prefix = options.return_invoice_prefix
    prefix_return = (good["invoice_id"].str.match(rf"^{re.escape(prefix)}\d") if prefix
                     else pd.Series(False, index=good.index)).astype(bool)
    good["is_return"] = ((good["quantity"] < 0) | prefix_return).astype(int)
    good["quantity"] = np.where(good["is_return"] == 1, -good["quantity"].abs(), good["quantity"].abs())
    good["revenue"] = (good["quantity"] * good["unit_price"]).round(2)

    mixed = good.groupby("invoice_id")["is_return"].nunique()
    if (mixed > 1).any():
        warnings.append(f"{int((mixed > 1).sum())} invoice(s) contain both sale and return lines; "
                        "return lines are analysed as returns.")

    src_rev = source_revenue.loc[good.index]
    comparable = src_rev.notna()
    if derived_price:
        warnings.append(f"No unit prices supplied: unit price was derived as line total / quantity "
                        f"for {len(good):,} line(s).")
    elif comparable.any():
        mismatch = (src_rev[comparable].abs() - good.loc[comparable, "revenue"].abs()).abs() > 0.01
        if mismatch.any():
            warnings.append(f"{int(mismatch.sum())} line(s) had a revenue value that did not equal quantity x "
                            "unit price; revenue was recalculated.")

    missing_product = good["product_id"].isna()
    if missing_product.any():
        warnings.append(f"{int(missing_product.sum())} line(s) had no product ID; labelled 'UNKNOWN'.")
        good.loc[missing_product, "product_id"] = "UNKNOWN"
    good["country"] = good["country"].fillna("Unknown")
    if good["category"].isna().all():
        warnings.append("No product category supplied; category analysis will show 'Uncategorised'.")

    future = good["ts"] > pd.Timestamp(datetime.now())
    if future.any():
        warnings.append(f"{int(future.sum())} line(s) are dated in the future. Check the source system's dates.")

    ts = good["ts"]
    good["invoice_ts"] = ts.dt.strftime("%Y-%m-%d %H:%M:%S")
    good["invoice_day"] = ts.dt.strftime("%Y-%m-%d")
    good["invoice_month"] = ts.dt.strftime("%Y-%m")
    good["month_num"] = (ts.dt.year * 12 + ts.dt.month - 1).astype(int)
    clean = good[CLEAN_COLUMNS].sort_values(["invoice_ts", "invoice_id"]).reset_index(drop=True)
    summary = _summary(clean, rejected, input_rows, duplicates) | {"currency": currency}
    return CleaningResult(clean, rejected, summary, warnings)

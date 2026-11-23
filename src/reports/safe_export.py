"""Spreadsheet formula-injection protection for CSV and Excel exports.

Customer-supplied text (product descriptions, IDs, countries, file names ...) can begin
with ``=``, ``+``, ``-`` or ``@``. Spreadsheet programs evaluate such cells as formulas
when a CSV is opened, and openpyxl writes any string starting with ``=`` as a live
formula. Following the OWASP guidance, such text values are neutralised:

* CSV: the value is prefixed with a single quote (``'=SUM(A1)``), so it opens as text.
* Excel: the cell is stored as a string with Excel's "quote prefix" flag, so the exact
  text is shown (no visible apostrophe) and it stays text even if the cell is edited.

Only text is touched. Real numbers (int/float columns) are never changed, and a text
value that is itself a plain number such as ``"-12.5"`` is left alone, because a
spreadsheet reads it as a number, not a formula.
"""
from __future__ import annotations

import re

import pandas as pd
from openpyxl import Workbook

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_PLAIN_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def needs_escape(value: object) -> bool:
    """True for a text value a spreadsheet could interpret as a formula."""
    return (isinstance(value, str) and value.startswith(FORMULA_PREFIXES)
            and _PLAIN_NUMBER.fullmatch(value) is None)


def escape_text(value: object) -> object:
    """Return ``value`` with a leading quote if it could be read as a formula."""
    return "'" + value if needs_escape(value) else value


def sanitize_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Copy of ``df`` with every text cell and column name made formula-safe."""
    out = df.copy()
    for col in out.columns:
        s = out[col]
        if isinstance(s.dtype, pd.CategoricalDtype) or pd.api.types.is_object_dtype(s) \
                or pd.api.types.is_string_dtype(s):
            out[col] = s.astype(object).map(escape_text)
    out.columns = [escape_text(c) for c in out.columns]
    return out


def csv_bytes(df: pd.DataFrame) -> bytes:
    """UTF-8 CSV export of ``df`` with formula injection neutralised."""
    return sanitize_frame(df).to_csv(index=False).encode("utf-8")


def harden_workbook(wb: Workbook) -> int:
    """Mark every formula-like text cell in ``wb`` as literal text. Returns the count.

    Exports never contain intentional formulas, so any cell openpyxl classified as a
    formula (data_type ``"f"``) came from data and is converted back to text too.
    """
    changed = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if needs_escape(cell.value):
                    cell.data_type = "s"
                    cell.quotePrefix = True
                    changed += 1
    return changed

"""Local security fixes: loopback-only Streamlit, formula-safe exports, Excel expansion limit."""
from __future__ import annotations

import io
import tomllib
import zipfile
from pathlib import Path

import pandas as pd
import pytest
from openpyxl import load_workbook

from src.etl import loader
from src.etl.loader import check_xlsx_expansion, read_table
from src.etl.pipeline import import_dataframe
from src.reports.excel_export import build_excel_workbook
from src.reports.safe_export import csv_bytes, escape_text, needs_escape, sanitize_frame
from src.analytics.context import AnalysisFilters, prepare_context
from src.database.connection import connect
from tests.conftest import KNOWN_MAPPING, known_frame

ROOT = Path(__file__).resolve().parents[1]
ATTACKS = ["=HYPERLINK(\"http://x\",\"a\")", "+1+cmd|' /C calc'!A0", "-2+3", "@SUM(1,1)", "\t=1", "\r=1"]


# --- 1. Streamlit binds to loopback only ----------------------------------------------------
def test_streamlit_config_binds_loopback():
    cfg = tomllib.loads((ROOT / ".streamlit" / "config.toml").read_text(encoding="utf-8"))
    assert cfg["server"]["address"] == "127.0.0.1"


# --- 2. Formula injection ---------------------------------------------------------------------
@pytest.mark.parametrize("value", ATTACKS)
def test_formula_like_text_is_escaped(value):
    assert needs_escape(value)
    assert escape_text(value) == "'" + value


@pytest.mark.parametrize("value", ["-12.5", "+3", "-1e5", ".5", "abc", "", "a=b", "85123A", "C536379"])
def test_plain_text_and_numeric_strings_untouched(value):
    assert escape_text(value) == value


@pytest.mark.parametrize("value", [-5, -1.25, 0, None, float("nan")])
def test_non_text_values_untouched(value):
    assert not needs_escape(value)


def test_csv_preserves_numbers_and_escapes_text():
    df = pd.DataFrame({"description": ATTACKS[:4], "revenue": [-10.5, 2.0, -3.0, 4.25],
                       "qty": [-1, 2, 3, 4], "cat": pd.Categorical(["=x", "ok", "ok", "-y"])})
    back = pd.read_csv(io.BytesIO(csv_bytes(df)))
    assert back["description"].tolist() == ["'" + a for a in ATTACKS[:4]]
    assert back["revenue"].tolist() == [-10.5, 2.0, -3.0, 4.25]  # negative numbers keep their sign
    assert back["qty"].tolist() == [-1, 2, 3, 4]
    assert back["cat"].tolist() == ["'=x", "ok", "ok", "'-y"]
    assert df["description"].tolist() == ATTACKS[:4]  # caller's frame not mutated


def test_sanitize_frame_escapes_column_names():
    assert list(sanitize_frame(pd.DataFrame({"=evil": [1]})).columns) == ["'=evil"]


@pytest.fixture
def malicious_conn():
    raw = known_frame()
    raw.loc[8, "Name"] = "=HYPERLINK(\"http://x\",\"click\")"
    raw.loc[8, "Country"] = "@SUM(1,1)"
    raw.loc[8, "SKU"] = "+1+1"
    conn = connect(":memory:")
    import_dataframe(conn, raw, KNOWN_MAPPING, source_name="=cmd.csv")
    yield conn
    conn.close()


def test_excel_export_contains_no_formulas(malicious_conn):
    conn = malicious_conn
    ctx = prepare_context(conn, AnalysisFilters("2024-01-01", "2024-03-31"))
    wb = load_workbook(io.BytesIO(build_excel_workbook(conn, ctx, "")))
    formulas, texts, numbers = [], set(), 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.data_type == "f":
                    formulas.append((ws.title, c.coordinate, c.value))
                elif isinstance(c.value, str):
                    texts.add(c.value)
                    if c.value[:1] in "=+-@":
                        assert c.quotePrefix, (ws.title, c.coordinate)
                elif isinstance(c.value, (int, float)):
                    numbers += 1
    assert formulas == []
    # exact text preserved (no visible apostrophe), shown as literal text by Excel
    assert "=HYPERLINK(\"http://x\",\"click\")" in texts and "@SUM(1,1)" in texts and "+1+1" in texts
    assert "=cmd.csv" in texts  # file name on the About sheet
    assert numbers > 0  # numeric cells stay numeric
    kpis = wb["KPIs"]
    assert any(isinstance(c.value, (int, float)) for row in kpis.iter_rows(min_row=2) for c in row)


def test_csv_export_of_real_table_escaped(malicious_conn):
    from src.services import registry
    df = registry.run(malicious_conn, "product_performance", AnalysisFilters("2024-01-01", "2024-03-31"))
    back = pd.read_csv(io.BytesIO(csv_bytes(df)), dtype=str)
    flat = set(back.to_numpy().ravel())
    assert "'=HYPERLINK(\"http://x\",\"click\")" in flat and "'+1+1" in flat
    assert not any(isinstance(v, str) and v[:1] in "=+@" for v in flat)


# --- 3. Excel expansion limit -----------------------------------------------------------------
def _zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_zip_bomb_rejected_before_parsing():
    bomb = _zip({"xl/worksheets/sheet1.xml": b"0" * (3 * 1024 * 1024)})
    assert len(bomb) < 50_000  # tiny on the wire
    with pytest.raises(ValueError, match="expands beyond 2 MB"):
        check_xlsx_expansion(bomb, max_mb=2)


def test_read_table_applies_expansion_limit(monkeypatch):
    monkeypatch.setattr(loader, "MAX_XLSX_EXPANDED_MB", 1)
    bomb = _zip({"xl/worksheets/sheet1.xml": b"0" * (2 * 1024 * 1024)})
    with pytest.raises(ValueError, match="Excel workbook expands beyond"):
        read_table(bomb, "big.xlsx")


def test_too_many_members_rejected():
    with pytest.raises(ValueError, match="too many parts"):
        check_xlsx_expansion(_zip({f"f{i}": b"" for i in range(6)}), max_members=5)


def test_not_a_zip_rejected():
    with pytest.raises(ValueError, match="not a valid Excel workbook"):
        read_table(b"not a zip", "x.xlsx")


def test_real_workbooks_still_import(tmp_path):
    sample = ROOT / "data" / "sample" / "sample_transactions.xlsx"
    assert len(read_table(sample)) > 0
    path = tmp_path / "tx.xlsx"
    known_frame().to_excel(path, index=False)
    assert len(read_table(path)) == len(known_frame())

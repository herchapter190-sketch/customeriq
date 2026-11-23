"""Formatted Excel workbook export using OpenPyXL."""
from __future__ import annotations

import io
import sqlite3
from datetime import datetime

import pandas as pd
from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from src.analytics import cohorts, revenue, risk
from src.analytics.context import AnalysisContext
from src.config import APP_NAME, APP_TAGLINE
from src.database.connection import get_meta
from src.insights.engine import generate_insights, insights_frame
from src.reports.safe_export import harden_workbook
from src.segments import service as segments

HEADER_FILL = PatternFill("solid", fgColor="14243E")
HEADER_FONT = Font(bold=True, color="FFFFFF")
MONEY_HINTS = ("revenue", "sales", "value", "monetary", "returns")
PCT_HINTS = ("_pct",)


def _write_sheet(wb: Workbook, title: str, df: pd.DataFrame) -> None:
    ws = wb.create_sheet(title[:31])
    ws.append(list(df.columns))
    for row in df.itertuples(index=False):
        ws.append([None if (isinstance(v, float) and pd.isna(v)) else (v.item() if hasattr(v, "item") else v)
                   for v in row])
    for cell in ws[1]:
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    for j, col in enumerate(df.columns, start=1):
        letter = get_column_letter(j)
        name = str(col).lower()
        fmt = None
        if any(h in name for h in PCT_HINTS):
            fmt = '0.00"%"'
        elif any(h in name for h in MONEY_HINTS) or name == "avg_order_value":
            fmt = "#,##0.00"
        if fmt:
            for cell in ws[letter][1:]:
                cell.number_format = fmt
        width = max([len(str(col))] + [len(str(v)) for v in df[col].head(200)]) + 2
        ws.column_dimensions[letter].width = min(max(width, 10), 48)
    ws.freeze_panes = "A2"


def build_excel_workbook(conn: sqlite3.Connection, ctx: AnalysisContext, currency: str = "") -> bytes:
    meta = get_meta(conn)
    f = ctx.filters
    wb = Workbook()
    about = wb.active
    about.title = "About"
    rows = [
        (APP_NAME, APP_TAGLINE),
        ("Reporting period", f"{f.start_date} to {f.end_date}"),
        ("Data source", str(meta.get("source_name", "n/a"))),
        ("Data classification", str(meta.get("data_label", "n/a"))),
        ("Segment filter", ", ".join(f.segments) if f.segments else "All segments"),
        ("RFM method", f.rfm.method),
        ("Risk thresholds (days)", f"Active <= {f.risk.active_days}, Cooling <= {f.risk.cooling_days}, "
                                   f"At Risk <= {f.risk.at_risk_days}, Lapsed > {f.risk.at_risk_days}"),
        ("Currency", currency or "not specified"),
        ("Generated", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    for r in rows:
        about.append(r)
    about["A1"].font = Font(bold=True, size=14, color="14243E")
    for cell in about["A"][1:]:
        cell.font = Font(bold=True)
    about.column_dimensions["A"].width = 26
    about.column_dimensions["B"].width = 90

    _write_sheet(wb, "KPIs", revenue.kpi_comparison(conn, ctx))
    _write_sheet(wb, "Monthly Revenue", revenue.monthly_revenue(conn, ctx))
    _write_sheet(wb, "Segments", segments.segment_summary(conn, ctx))
    _write_sheet(wb, "RFM Customers", segments.rfm_customers(conn, ctx))
    long = cohorts.cohort_long(conn, ctx)
    matrix = cohorts.cohort_matrix(long, f.end_date)
    if not matrix.empty:
        m = matrix.copy()
        m.columns = [f"M{c}" for c in m.columns]
        m.insert(0, "cohort_size", cohorts.cohort_sizes(long).reindex(m.index).to_numpy())
        _write_sheet(wb, "Cohort Retention", m.reset_index().rename(columns={"cohort_month": "cohort"}))
        ws = wb["Cohort Retention"]
        last_col = get_column_letter(ws.max_column)
        ws.conditional_formatting.add(
            f"C2:{last_col}{ws.max_row}",
            ColorScaleRule(start_type="num", start_value=0, start_color="F3F5F8",
                           end_type="num", end_value=60, end_color="14243E"))
    _write_sheet(wb, "Revenue Concentration", revenue.revenue_concentration(conn, ctx))
    _write_sheet(wb, "Customers", revenue.revenue_by_customer(conn, ctx))
    _write_sheet(wb, "Products", revenue.product_performance(conn, ctx))
    _write_sheet(wb, "Inactive Customers", risk.inactive_customers(conn, ctx))
    ins = insights_frame(generate_insights(conn, ctx, currency))
    if not ins.empty:
        _write_sheet(wb, "Insights", ins.drop(columns=["value"]))

    harden_workbook(wb)  # customer text such as "=HYPERLINK(...)" must stay text, not a formula
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

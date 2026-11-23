"""Professional PDF report built with ReportLab (charts are native vector graphics)."""
from __future__ import annotations

import io
import sqlite3
from datetime import datetime

import pandas as pd
from reportlab.graphics.charts.barcharts import HorizontalBarChart, VerticalBarChart
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (CondPageBreak, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from src.analytics import cohorts, revenue, risk
from src.analytics.context import AnalysisContext
from src.config import APP_NAME, APP_TAGLINE
from src.database.connection import get_meta, has_data
from src.insights.engine import Insight, generate_insights, money
from src.segments import service as segments
from src.sql.runner import run_query

# CustomerIQ palette (identical to the app): lime, burgundy, ivory, espresso, burnt orange, plus tints.
LIME = colors.HexColor("#D6FF3F")
BURGUNDY = colors.HexColor("#641C36")
IVORY = colors.HexColor("#F4EBD9")
ESPRESSO = colors.HexColor("#27231F")
ORANGE = colors.HexColor("#E66B43")

NAVY = BURGUNDY                         # legacy name: primary data colour
INK = ESPRESSO
SLATE = colors.HexColor("#6B6158")      # espresso tint
RULE = colors.HexColor("#DCCDB2")       # ivory shade
PANEL = colors.HexColor("#FAF5EB")      # ivory tint
ACCENT = ORANGE
BLUE = BURGUNDY                         # legacy name: bar colour
RISK = colors.HexColor("#B84A2E")       # orange shade
GOOD = colors.HexColor("#5C7A0E")       # lime shade, readable on white

# Built-in PDF fonts keep the report portable (no font files to embed): Times for display, Helvetica for text.
DISPLAY, DISPLAY_IT, TEXT, TEXT_B = "Times-Roman", "Times-Italic", "Helvetica", "Helvetica-Bold"

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
COVER_H = 56 * mm


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    s = {
        "title": ParagraphStyle("title", parent=base["Title"], fontName=DISPLAY, fontSize=26,
                                leading=30, textColor=INK, alignment=TA_LEFT, spaceAfter=4),
        "subtitle": ParagraphStyle("subtitle", fontName=TEXT, fontSize=11, leading=15, textColor=SLATE),
        "h1": ParagraphStyle("h1", fontName=DISPLAY, fontSize=21, leading=25, textColor=INK,
                             spaceBefore=4, spaceAfter=10),
        "h2": ParagraphStyle("h2", fontName=DISPLAY, fontSize=13.5, leading=17, textColor=BURGUNDY,
                             spaceBefore=10, spaceAfter=5),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK,
                               spaceAfter=5),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, leading=11, textColor=SLATE),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8, leading=10, textColor=INK),
        "cell_r": ParagraphStyle("cell_r", fontName="Helvetica", fontSize=8, leading=10, textColor=INK,
                                 alignment=TA_RIGHT),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=SLATE),
    }
    return s


class _NumberedCanvas(rl_canvas.Canvas):
    """Adds 'Page x of y' and a running footer to every page."""

    def __init__(self, *args, footer_text: str = APP_NAME, **kwargs):
        super().__init__(*args, **kwargs)
        self.footer_text = footer_text
        self._saved_pages: list[dict] = []

    def showPage(self):
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_pages)
        for state in self._saved_pages:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total: int) -> None:
        self.setStrokeColor(ESPRESSO)
        self.setLineWidth(0.8)
        self.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
        self.setFont(TEXT, 7.5)
        self.setFillColor(SLATE)
        self.drawString(MARGIN, 9.5 * mm, self.footer_text)
        tail = f"  /  {total:02d}"
        self.drawRightString(PAGE_W - MARGIN, 9.5 * mm, tail)
        self.setFont(DISPLAY_IT, 10)
        self.setFillColor(ORANGE)
        self.drawRightString(PAGE_W - MARGIN - self.stringWidth(tail, TEXT, 7.5), 9.3 * mm, f"{self._pageNumber:02d}")


def _draw_cover(c: rl_canvas.Canvas, _doc) -> None:
    """Espresso band across the top of page 1 with the wordmark and report title."""
    c.saveState()
    c.setFillColor(ESPRESSO)
    c.rect(0, PAGE_H - COVER_H, PAGE_W, COVER_H, stroke=0, fill=1)
    c.setFillColor(LIME)
    c.rect(MARGIN, PAGE_H - 15 * mm, 3.2 * mm, 3.2 * mm, stroke=0, fill=1)
    c.setFont(TEXT_B, 10)
    c.drawString(MARGIN + 6 * mm, PAGE_H - 14.6 * mm, APP_NAME)
    c.setFillColor(IVORY)
    c.setFont(DISPLAY, 30)
    c.drawString(MARGIN, PAGE_H - 32 * mm, "Customer intelligence")
    c.setFont(DISPLAY_IT, 30)
    c.setFillColor(LIME)
    c.drawString(MARGIN, PAGE_H - 43 * mm, "report.")
    c.setFillColor(colors.HexColor("#C9BBA3"))
    c.setFont(TEXT, 9)
    c.drawString(MARGIN, PAGE_H - 50 * mm, APP_TAGLINE)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - COVER_H - 1.6 * mm, PAGE_W, 1.6 * mm, stroke=0, fill=1)
    c.restoreState()


def _draw_header(c: rl_canvas.Canvas, _doc) -> None:
    """Running header on pages 2+: lime mark, wordmark and a thin espresso rule."""
    c.saveState()
    y = PAGE_H - 11 * mm
    c.setFillColor(LIME)
    c.rect(MARGIN, y - 0.4 * mm, 2.4 * mm, 2.4 * mm, stroke=0, fill=1)
    c.setFillColor(ESPRESSO)
    c.rect(MARGIN, y - 0.4 * mm, 2.4 * mm, 2.4 * mm, stroke=1, fill=0)
    c.setFont(TEXT_B, 7.5)
    c.drawString(MARGIN + 4.5 * mm, y, APP_NAME)
    c.setFont(TEXT, 7.5)
    c.setFillColor(SLATE)
    c.drawRightString(PAGE_W - MARGIN, y, "Customer intelligence report")
    c.setStrokeColor(ESPRESSO)
    c.setLineWidth(0.8)
    c.line(MARGIN, y - 3 * mm, PAGE_W - MARGIN, y - 3 * mm)
    c.restoreState()


def _h1(number: int, text: str, styles) -> Paragraph:
    """Section heading: orange italic chapter number + display title."""
    return Paragraph(f"<font name='{DISPLAY_IT}' color='#E66B43'>{number:02d}</font>&nbsp;&nbsp;{text}", styles["h1"])


def _canvas_factory(footer: str):
    def make(*args, **kwargs):
        return _NumberedCanvas(*args, footer_text=footer, **kwargs)
    return make


def _table(df: pd.DataFrame, col_widths: list[float] | None = None, numeric_cols: set[str] | None = None,
           header_bg=ESPRESSO) -> Table:
    styles = _styles()
    numeric_cols = numeric_cols or set()
    col_style = [styles["cell_r"] if c in numeric_cols else styles["cell"] for c in df.columns]
    header = [Paragraph(f"<font color='#F4EBD9'><b>{c}</b></font>", st) for c, st in zip(df.columns, col_style)]
    body = []
    for row in df.itertuples(index=False):
        body.append([Paragraph(str(v), st) for v, st in zip(row, col_style)])
    t = Table([header] + body, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(body) + 1):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), PANEL))
    for j, col in enumerate(df.columns):
        if col in numeric_cols:
            style.append(("ALIGN", (j, 0), (j, -1), "RIGHT"))
    t.setStyle(TableStyle(style))
    return t


def _kpi_tiles(items: list[tuple[str, str, str]]) -> Table:
    """Row of KPI tiles: (label, value, note)."""
    styles = _styles()
    value_style = ParagraphStyle("kpi", fontName=DISPLAY, fontSize=20, leading=24, textColor=INK)
    cells = []
    for label, value, note in items:
        cells.append([
            Paragraph(label.upper(), styles["label"]),
            Paragraph(value, value_style),
            Paragraph(note, styles["small"]),
        ])
    width = CONTENT_W / len(items)
    t = Table([cells], colWidths=[width] * len(items))
    t.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 1.6, ESPRESSO),
        ("LINEBEFORE", (1, 0), (-1, -1), 8, colors.white),   # gap between the rules above each tile
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("LEFTPADDING", (1, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _bar_chart(labels: list[str], values: list[float], title: str, color=BLUE, height: float = 62 * mm,
               label_every: int = 1) -> Drawing:
    d = Drawing(CONTENT_W, height)
    d.add(String(0, height - 10, title, fontName=DISPLAY, fontSize=12.5, fillColor=INK))
    chart = VerticalBarChart()
    chart.x, chart.y = 40, 22
    chart.width, chart.height = CONTENT_W - 50, height - 42
    chart.data = [values]
    chart.bars[0].fillColor = color
    chart.bars[0].strokeColor = None
    chart.barSpacing = 1
    chart.categoryAxis.categoryNames = [l if i % label_every == 0 else "" for i, l in enumerate(labels)]
    chart.categoryAxis.labels.fontSize = 6.5
    chart.categoryAxis.labels.angle = 45 if len(labels) > 12 else 0
    chart.categoryAxis.labels.boxAnchor = "ne" if len(labels) > 12 else "n"
    chart.categoryAxis.strokeColor = RULE
    chart.valueAxis.labels.fontSize = 6.5
    chart.valueAxis.strokeColor = RULE
    chart.valueAxis.gridStrokeColor = RULE
    chart.valueAxis.visibleGrid = True
    chart.valueAxis.valueMin = min(0, min(values) if values else 0)
    chart.valueAxis.labelTextFormat = lambda v: f"{v / 1000:,.0f}k" if abs(max(values or [0])) >= 10000 else f"{v:,.0f}"
    d.add(chart)
    return d


def _hbar_chart(labels: list[str], values: list[float], title: str, color=NAVY, suffix: str = "%") -> Drawing:
    height = 18 + 16 * max(len(labels), 1) + 20
    d = Drawing(CONTENT_W, height)
    d.add(String(0, height - 10, title, fontName=DISPLAY, fontSize=12.5, fillColor=INK))
    chart = HorizontalBarChart()
    chart.x, chart.y = 110, 14
    chart.width, chart.height = CONTENT_W - 150, height - 36
    chart.data = [list(reversed(values))]
    chart.bars[0].fillColor = color
    chart.bars[0].strokeColor = None
    chart.categoryAxis.categoryNames = list(reversed(labels))
    chart.categoryAxis.labels.fontSize = 7.5
    chart.categoryAxis.strokeColor = RULE
    chart.valueAxis.labels.fontSize = 6.5
    chart.valueAxis.valueMin = 0
    chart.valueAxis.strokeColor = RULE
    chart.valueAxis.labelTextFormat = lambda v: f"{v:.0f}{suffix}"
    chart.barLabelFormat = lambda v: f"{v:.1f}{suffix}"
    chart.barLabels.fontSize = 6.5
    chart.barLabels.boxAnchor = "w"
    chart.barLabels.dx = 3
    d.add(chart)
    return d


def _line_chart(xs: list[float], ys: list[float], title: str, height: float = 58 * mm) -> Drawing:
    d = Drawing(CONTENT_W, height)
    d.add(String(0, height - 10, title, fontName=DISPLAY, fontSize=12.5, fillColor=INK))
    lp = LinePlot()
    lp.x, lp.y = 40, 30
    lp.width, lp.height = CONTENT_W - 60, height - 50
    lp.data = [list(zip(xs, ys))]
    lp.lines[0].strokeColor = NAVY
    lp.lines[0].strokeWidth = 1.6
    lp.xValueAxis.valueMin = min(xs) if xs else 0
    lp.xValueAxis.valueMax = max(xs) if xs else 1
    lp.xValueAxis.valueStep = 1
    lp.xValueAxis.labels.fontSize = 6.5
    lp.xValueAxis.strokeColor = RULE
    lp.yValueAxis.valueMin = 0
    lp.yValueAxis.valueMax = 100
    lp.yValueAxis.valueStep = 20
    lp.yValueAxis.labels.fontSize = 6.5
    lp.yValueAxis.strokeColor = RULE
    lp.yValueAxis.visibleGrid = True
    lp.yValueAxis.gridStrokeColor = RULE
    lp.yValueAxis.labelTextFormat = "%d%%"
    d.add(lp)
    d.add(String(lp.x + lp.width / 2, 2, "Months since first purchase", fontName="Helvetica", fontSize=7,
                 fillColor=SLATE, textAnchor="middle"))
    return d


def _heat_color(value: float) -> colors.Color:
    """Sequential ivory -> burgundy scale for retention %, capped at 60% so later months stay legible."""
    t = max(0.0, min(value / 60.0, 1.0))
    lo, hi = (0.973, 0.945, 0.894), (0.392, 0.110, 0.212)
    return colors.Color(*(lo[i] + (hi[i] - lo[i]) * t for i in range(3)))


def _cohort_heatmap(matrix: pd.DataFrame, sizes: pd.Series) -> Table:
    styles = _styles()
    months = list(matrix.columns)
    header = ["Cohort", "Size"] + [f"M{m}" for m in months]
    rows = [[Paragraph(f"<font color='#F4EBD9'><b>{h}</b></font>", styles["cell"]) for h in header]]
    style = [("BACKGROUND", (0, 0), (-1, 0), ESPRESSO), ("FONTSIZE", (0, 0), (-1, -1), 7),
             ("ALIGN", (1, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
             ("GRID", (0, 0), (-1, -1), 0.6, colors.white),
             ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    for r, (cohort, row) in enumerate(matrix.iterrows(), start=1):
        cells = [cohort, f"{int(sizes.get(cohort, 0)):,}"]
        for c, m in enumerate(months):
            v = row[m]
            if pd.isna(v):
                cells.append("")
                continue
            cells.append(f"{v:.0f}%")
            style.append(("BACKGROUND", (c + 2, r), (c + 2, r), _heat_color(float(v))))
            style.append(("TEXTCOLOR", (c + 2, r), (c + 2, r), IVORY if v > 30 else INK))
        rows.append(cells)
    widths = [20 * mm, 14 * mm] + [(CONTENT_W - 34 * mm) / max(len(months), 1)] * len(months)
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle(style))
    return t


def _fmt_int(v) -> str:
    return f"{int(round(float(v))):,}"


def _fmt_pct(v) -> str:
    return "n/a" if v is None or pd.isna(v) else f"{float(v):.1f}%"


def _insight_block(ins: Insight, styles) -> KeepTogether:
    tag_color = {"risk": "#B84A2E", "opportunity": "#5C7A0E", "info": "#641C36"}[ins.kind]
    rows = [
        [Paragraph(f"<font color='{tag_color}'><b>{ins.kind.upper()}</b></font> &nbsp; "
                   f"<font color='#6B6158'>{ins.category}</font>", styles["small"])],
        [Paragraph(f"<b>{ins.title}</b>", styles["h2"])],
        [Paragraph(f"<b>Observed.</b> {ins.observation}", styles["body"])],
        [Paragraph(f"<b>Supporting metric.</b> {ins.metric}", styles["body"])],
        [Paragraph(f"<b>Why it matters.</b> {ins.why_it_matters}", styles["body"])],
        [Paragraph(f"<b>Action to consider.</b> {ins.action}", styles["body"])],
    ]
    t = Table(rows, colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, colors.HexColor(tag_color)),
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
    ]))
    return KeepTogether([t, Spacer(1, 6)])


def currency_note(currency: str) -> str:
    """How amounts in the report are labelled. Datasets do not declare a currency, so none is assumed."""
    names = {"£": "GBP (£)", "$": "USD ($)", "€": "EUR (€)"}
    if not currency:
        return "Not specified: amounts are in the dataset's own currency units"
    return f"{names.get(currency, currency)}, as selected in the app (display only, no conversion)"


def build_pdf_report(conn: sqlite3.Connection, ctx: AnalysisContext, currency: str = "") -> bytes:
    """Render the full report for the context's filters and return PDF bytes."""
    styles = _styles()
    buffer = io.BytesIO()
    meta = get_meta(conn)
    is_synthetic = bool(meta.get("is_synthetic"))
    f = ctx.filters
    footer = f"{APP_NAME} customer intelligence report  |  {f.start_date} to {f.end_date}"
    if is_synthetic:
        footer += "  |  SYNTHETIC DEMO DATA"

    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN,
                            bottomMargin=20 * mm, title=f"{APP_NAME} Customer Intelligence Report",
                            author=APP_NAME, subject=APP_TAGLINE)
    story: list = []

    # ---------------------------------------------------------------- cover block
    # Wordmark, title and tagline are drawn in the espresso cover band (_draw_cover); leave room for it.
    story += [Spacer(1, COVER_H - MARGIN + 8 * mm)]
    source = meta.get("source_name", "No dataset loaded")
    label = meta.get("data_label", "")
    info = pd.DataFrame([
        ["Reporting period", f"{f.start_date} to {f.end_date}"],
        ["Data source", f"{source}"],
        ["Data classification", label or "n/a"],
        ["Segment filter", ", ".join(f.segments) if f.segments else "All segments"],
        ["Currency", currency_note(currency)],
        ["Generated", datetime.now().strftime("%Y-%m-%d %H:%M")],
    ], columns=["Item", "Detail"])
    t = Table([[Paragraph(a.upper(), styles["label"]), Paragraph(str(b), styles["cell"])]
               for a, b in info.itertuples(index=False)], colWidths=[40 * mm, CONTENT_W - 40 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("LINEABOVE", (0, 0), (-1, 0), 1.6, ESPRESSO),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 4),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [t, Spacer(1, 10)]
    if is_synthetic:
        story.append(Paragraph(
            "<font color='#B84A2E'><b>Synthetic data notice.</b></font> This report was produced from a "
            "generated demonstration dataset. Customers, transactions and all findings below are artificial "
            "and do not describe a real business.", styles["body"]))

    kpi_row = run_query(conn, "kpi_summary", ctx.params()).iloc[0] if has_data(conn) else None
    if kpi_row is None or not kpi_row["orders"]:
        story.append(Paragraph("No transactions exist for the selected period, so no analysis could be produced. "
                               "Load a dataset or widen the date range and generate the report again.",
                               styles["body"]))
        doc.build(story, onFirstPage=_draw_cover, onLaterPages=_draw_header, canvasmaker=_canvas_factory(footer))
        return buffer.getvalue()

    comparison = revenue.kpi_comparison(conn, ctx)
    k = comparison.set_index("metric")["current"].to_dict()
    insights = generate_insights(conn, ctx, currency)

    # ---------------------------------------------------------------- 1. executive summary
    story.append(_h1(1, "Executive summary", styles))
    summary = (f"Between {f.start_date} and {f.end_date}, {_fmt_int(k['active_customers'])} customers placed "
               f"{_fmt_int(k['orders'])} orders, generating {money(k['net_revenue'], currency)} of net revenue "
               f"after {money(k['returns_value'], currency)} of returns. The average order value was "
               f"{money(k['avg_order_value'], currency)} and {_fmt_pct(k['repeat_rate_pct'])} of active "
               f"customers ordered more than once in the period.")
    story.append(Paragraph(summary, styles["body"]))
    if insights:
        bullets = "".join(f"<br/>&bull; {i.title}" for i in insights[:5])
        story.append(Paragraph(f"<b>Key findings</b>{bullets}", styles["body"]))
    story.append(Spacer(1, 4))

    # ---------------------------------------------------------------- 2. KPIs
    story.append(_h1(2, "Business KPIs", styles))
    story.append(_kpi_tiles([
        ("Net revenue", money(k["net_revenue"], currency), "after returns"),
        ("Orders", _fmt_int(k["orders"]), "distinct sales invoices"),
        ("Active customers", _fmt_int(k["active_customers"]), f"{_fmt_int(k['new_customers'])} new"),
        ("Avg order value", money(k["avg_order_value"], currency), "gross sales / orders"),
    ]))
    story.append(Spacer(1, 6))
    prev_start, prev_end = comparison.attrs["previous_period"]
    labels = {"net_revenue": "Net revenue", "gross_sales": "Gross sales", "returns_value": "Returns",
              "orders": "Orders", "active_customers": "Active customers", "new_customers": "New customers",
              "repeat_customers": "Repeat customers", "avg_order_value": "Average order value",
              "repeat_rate_pct": "Repeat customer rate", "revenue_per_customer": "Revenue per customer",
              "return_rate_pct": "Return rate (value)"}
    money_keys = {"net_revenue", "gross_sales", "returns_value", "avg_order_value", "revenue_per_customer"}
    pct_keys = {"repeat_rate_pct", "return_rate_pct"}

    def fmt(key, v):
        return money(v, currency) if key in money_keys else (_fmt_pct(v) if key in pct_keys else _fmt_int(v))

    rows = []
    for key, name in labels.items():
        r = comparison.set_index("metric").loc[key]
        change = "n/a" if r["change_pct"] is None or pd.isna(r["change_pct"]) else f"{r['change_pct']:+.1f}%"
        rows.append([name, fmt(key, r["current"]), fmt(key, r["previous"]), change])
    kpi_df = pd.DataFrame(rows, columns=["Metric", "Selected period", f"Prior period ({prev_start} to {prev_end})", "Change"])
    story.append(_table(kpi_df, [55 * mm, 35 * mm, 55 * mm, CONTENT_W - 145 * mm],
                        numeric_cols={"Selected period", kpi_df.columns[2], "Change"}))
    if not comparison.attrs["previous_has_data"]:
        story.append(Paragraph("The prior period contains no transactions, so changes are not available.",
                               styles["small"]))

    # ---------------------------------------------------------------- 3. revenue
    story.append(CondPageBreak(110 * mm))  # start revenue on the KPI overflow page when there is room
    story.append(_h1(3, "Revenue analysis", styles))
    monthly = revenue.monthly_revenue(conn, ctx)
    if not monthly.empty:
        every = 1 if len(monthly) <= 18 else 2
        story.append(_bar_chart(list(monthly["month"]), [float(v) for v in monthly["net_revenue"]],
                                f"Net revenue by month ({currency or 'currency units'})", label_every=every))
    conc = revenue.revenue_concentration(conn, ctx)
    if not conc.empty:
        story.append(Paragraph("Revenue concentration", styles["h2"]))
        c = conc.assign(**{"Customer tier": conc["top_pct"].map(lambda p: f"Top {p}%"),
                           "Customers": conc["customers_in_tier"].map(_fmt_int),
                           "Net revenue": conc["tier_revenue"].map(lambda v: money(v, currency)),
                           "Share of revenue": conc["revenue_share_pct"].map(_fmt_pct)})
        story.append(_table(c[["Customer tier", "Customers", "Net revenue", "Share of revenue"]],
                            [CONTENT_W / 4] * 4, numeric_cols={"Customers", "Net revenue", "Share of revenue"}))
    cats = revenue.category_performance(conn, ctx)
    if len(cats) > 1 or (len(cats) == 1 and cats.iloc[0]["category"] != "Uncategorised"):
        story.append(Paragraph("Revenue by category", styles["h2"]))
        cdf = pd.DataFrame({"Category": cats["category"], "Products": cats["products"].map(_fmt_int),
                            "Orders": cats["orders"].map(_fmt_int), "Customers": cats["customers"].map(_fmt_int),
                            "Net revenue": cats["net_revenue"].map(lambda v: money(v, currency)),
                            "Share": cats["revenue_share_pct"].map(_fmt_pct)})
        story.append(_table(cdf, [45 * mm] + [(CONTENT_W - 45 * mm) / 5] * 5,
                            numeric_cols={"Products", "Orders", "Customers", "Net revenue", "Share"}))
    prods = revenue.product_performance(conn, ctx).head(10)
    if not prods.empty:
        story.append(Paragraph("Top 10 products by net revenue", styles["h2"]))
        pdf_ = pd.DataFrame({"#": prods["revenue_rank"], "Product": prods["description"].fillna(prods["product_id"]),
                             "Units": prods["units_sold"].map(_fmt_int), "Customers": prods["customers"].map(_fmt_int),
                             "Net revenue": prods["net_revenue"].map(lambda v: money(v, currency)),
                             "Return rate": prods["return_rate_pct"].map(_fmt_pct)})
        story.append(_table(pdf_, [8 * mm, 62 * mm] + [(CONTENT_W - 70 * mm) / 4] * 4,
                            numeric_cols={"#", "Units", "Customers", "Net revenue", "Return rate"}))

    # ---------------------------------------------------------------- 4. segmentation
    story.append(PageBreak())
    story.append(_h1(4, "Customer segmentation (RFM)", styles))
    method = ("quantile scoring (PERCENT_RANK within the customer base)" if f.rfm.method == "quantile"
              else "fixed threshold scoring")
    story.append(Paragraph(
        f"Customers are scored 1-5 on Recency, Frequency and Monetary value as of {f.end_date} using {method}, "
        "then assigned to segments by ordered, transparent rules. Segments describe past behaviour; they are "
        "not statistical predictions.", styles["body"]))
    seg = segments.segment_summary(conn, ctx)
    if not seg.empty:
        story.append(_hbar_chart(list(seg["segment"]), [float(v) for v in seg["revenue_share_pct"]],
                                 "Share of net revenue by segment"))
        sdf = pd.DataFrame({"Segment": seg["segment"], "Customers": seg["customers"].map(_fmt_int),
                            "Customer share": seg["customer_share_pct"].map(_fmt_pct),
                            "Net revenue": seg["net_revenue"].map(lambda v: money(v, currency)),
                            "Revenue share": seg["revenue_share_pct"].map(_fmt_pct),
                            "Avg recency (days)": seg["avg_recency_days"].map(lambda v: f"{v:.0f}"),
                            "Avg orders": seg["avg_frequency"].map(lambda v: f"{v:.1f}"),
                            "AOV": seg["avg_order_value"].map(lambda v: money(v, currency))})
        story.append(_table(sdf, [32 * mm] + [(CONTENT_W - 32 * mm) / 7] * 7,
                            numeric_cols=set(sdf.columns) - {"Segment"}))
        story.append(Paragraph("RFM findings", styles["h2"]))
        top = seg.sort_values("revenue_share_pct", ascending=False).iloc[0]
        largest = seg.sort_values("customers", ascending=False).iloc[0]
        story.append(Paragraph(
            f"<b>{top['segment']}</b> is the most valuable segment, contributing {_fmt_pct(top['revenue_share_pct'])} "
            f"of revenue from {_fmt_pct(top['customer_share_pct'])} of customers. The largest segment by customer "
            f"count is <b>{largest['segment']}</b> ({_fmt_int(largest['customers'])} customers, "
            f"{_fmt_pct(largest['revenue_share_pct'])} of revenue).", styles["body"]))

    # ---------------------------------------------------------------- 5. cohorts
    story.append(PageBreak())
    story.append(_h1(5, "Cohort retention", styles))
    long = cohorts.cohort_long(conn, ctx)
    if long.empty:
        story.append(Paragraph("No acquisition cohorts fall within the selected period.", styles["body"]))
    else:
        story.append(Paragraph(
            "Each row is a monthly acquisition cohort (customers grouped by the month of their first purchase). "
            "Cells show the share of the cohort that purchased again N months later. Blank cells cannot be "
            "observed yet.", styles["body"]))
        matrix = cohorts.cohort_matrix(long, f.end_date, max_months=11).tail(14)
        story.append(_cohort_heatmap(matrix, cohorts.cohort_sizes(long)))
        curve = cohorts.average_retention_curve(long, f.end_date, max_months=12).dropna()
        if len(curve) > 1:
            story.append(Spacer(1, 8))
            story.append(_line_chart([float(x) for x in curve["month_index"]],
                                     [float(y) for y in curve["retention_pct"]],
                                     "Average retention curve (customer-weighted)"))

    # ---------------------------------------------------------------- 6. inactive customers
    story.append(PageBreak())
    story.append(_h1(6, "Inactive customer analysis", styles))
    r = f.risk
    story.append(Paragraph(
        f"Rule-based indicators as of {f.end_date}: <b>Active</b> purchased within {r.active_days} days, "
        f"<b>Cooling</b> {r.active_days + 1}-{r.cooling_days} days, <b>At Risk</b> {r.cooling_days + 1}-"
        f"{r.at_risk_days} days, <b>Lapsed</b> over {r.at_risk_days} days. A repeat customer is "
        f"<b>overdue</b> when inactive for more than {r.overdue_multiplier:g}x their own average gap between "
        "orders. These rules are not a churn prediction model.", styles["body"]))
    rs = risk.risk_summary(conn, ctx)
    if not rs.empty:
        rdf = pd.DataFrame({"Risk category": rs["risk_category"], "Customers": rs["customers"].map(_fmt_int),
                            "Share": rs["customer_share_pct"].map(_fmt_pct),
                            "Historical revenue": rs["historical_revenue"].map(lambda v: money(v, currency)),
                            "Revenue share": rs["revenue_share_pct"].map(_fmt_pct),
                            "Avg days inactive": rs["avg_days_inactive"].map(lambda v: f"{v:.0f}"),
                            "Overdue": rs["overdue_customers"].map(_fmt_int),
                            "High value": rs["high_value_customers"].map(_fmt_int)})
        story.append(_table(rdf, [28 * mm] + [(CONTENT_W - 28 * mm) / 7] * 7,
                            numeric_cols=set(rdf.columns) - {"Risk category"}))
    wb = risk.priority_win_back(conn, ctx, limit=12)
    if not wb.empty:
        story.append(Paragraph("Priority win-back list (high value, at risk, lapsed or overdue)", styles["h2"]))
        wdf = pd.DataFrame({"Customer": wb["customer_id"], "Segment": wb["segment"], "Last purchase": wb["last_purchase"],
                            "Days inactive": wb["days_inactive"].map(_fmt_int), "Orders": wb["orders"].map(_fmt_int),
                            "Revenue": wb["historical_revenue"].map(lambda v: money(v, currency)),
                            "Risk": wb["risk_category"]})
        story.append(_table(wdf, [22 * mm, 32 * mm, 24 * mm, 22 * mm, 16 * mm, 26 * mm, CONTENT_W - 142 * mm],
                            numeric_cols={"Days inactive", "Orders", "Revenue"}))

    # ---------------------------------------------------------------- 7. findings & recommendations
    story.append(PageBreak())
    story.append(_h1(7, "Key findings and recommendations", styles))
    story.append(Paragraph("Each finding is generated by a documented rule from the figures in this report. "
                           "Rules without enough supporting data are omitted rather than estimated.", styles["small"]))
    story.append(Spacer(1, 4))
    if insights:
        for ins in insights:
            story.append(_insight_block(ins, styles))
    else:
        story.append(Paragraph("No rule had enough data to produce a reliable finding for this period.", styles["body"]))

    # ---------------------------------------------------------------- 8. data source & method
    story.append(_h1(8, "Data source and methodology", styles))
    cs = meta.get("cleaning_summary", {}) or {}
    overview = run_query(conn, "data_overview").iloc[0]
    story.append(Paragraph(
        f"Source: {source}. The loaded dataset covers {overview['first_date']} to {overview['last_date']} with "
        f"{_fmt_int(overview['total_rows'])} valid transaction lines ({_fmt_int(overview['return_rows'])} return "
        f"lines), {_fmt_int(overview['customers'])} customers and {_fmt_int(overview['products'])} products. "
        f"During import {_fmt_int(cs.get('input_rows', 0))} rows were read and "
        f"{_fmt_int(cs.get('rejected_rows', 0))} were excluded by validation rules "
        f"(including {_fmt_int(cs.get('duplicate_rows', 0))} exact duplicates).", styles["body"]))
    story.append(Paragraph(
        "Definitions: an order is a distinct sales invoice; net revenue is sales minus returns; returns are lines "
        "with negative quantity or a cancellation invoice prefix. All metrics are calculated by SQL queries on a "
        "local SQLite database. Lines without a customer ID cannot be attributed and are excluded from "
        "customer analytics.", styles["body"]))

    doc.build(story, onFirstPage=_draw_cover, onLaterPages=_draw_header, canvasmaker=_canvas_factory(footer))
    return buffer.getvalue()

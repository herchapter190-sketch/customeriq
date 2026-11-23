"""8. Reports & Exports."""
from __future__ import annotations

from datetime import datetime

import streamlit as st

from src.analytics.context import prepare_context
from src.database.connection import session
from src.insights.engine import insights_frame
from src.reports.excel_export import build_excel_workbook
from src.reports.pdf_report import build_pdf_report
from src.ui import data, state
from src.ui.components import insight_card, note
from src.ui.pages._common import no_rows, require_filters

CSV_EXPORTS = {
    "Customer revenue league table": "revenue_by_customer",
    "RFM scores and segments": "rfm_customers",
    "Segment summary": "segment_summary",
    "Monthly revenue": "monthly_revenue",
    "Product performance": "product_performance",
    "Inactive customer indicators": "inactive_customers",
    "Cohort retention (long format)": "cohort_long",
    "Monthly acquisition": "monthly_acquisition",
}


def render() -> None:
    filters = require_filters("Reports & Exports", "Downloadable PDF report, Excel workbook, CSV extracts and findings")
    if filters is None:
        return
    cur = state.currency()
    note("Reports use the filters currently selected in the sidebar (period, segments, RFM and inactivity rules). "
         "When the synthetic demo dataset is loaded, every report is clearly labelled as synthetic.")
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    key = (data.dataset_version(), repr(filters), cur)

    left, mid, right = st.columns(3)
    with left:
        st.markdown("**PDF report**")
        st.caption("Executive summary, KPIs, revenue, RFM segmentation, cohort retention, inactive customers, "
                   "findings and recommendations, with charts and page numbering.")
        if st.button("Generate PDF report", type="primary", icon=":material/picture_as_pdf:", width="stretch"):
            with st.spinner("Building PDF..."):
                with session(data.DB_PATH) as conn:
                    pdf = build_pdf_report(conn, prepare_context(conn, filters), cur)
            st.session_state["_pdf"] = {"key": key, "bytes": pdf}
        pdf_state = st.session_state.get("_pdf")
        if pdf_state and pdf_state["key"] == key:
            st.download_button("Download PDF", pdf_state["bytes"], f"customeriq_report_{stamp}.pdf",
                               "application/pdf", icon=":material/download:", width="stretch")
    with mid:
        st.markdown("**Excel workbook**")
        st.caption("Formatted workbook with KPIs, segments, RFM customers, a colour-scaled cohort matrix, "
                   "products, inactive customers and insights.")
        if st.button("Build Excel workbook", icon=":material/table_view:", width="stretch"):
            with st.spinner("Building workbook..."):
                with session(data.DB_PATH) as conn:
                    xlsx = build_excel_workbook(conn, prepare_context(conn, filters), cur)
            st.session_state["_xlsx"] = {"key": key, "bytes": xlsx}
        x_state = st.session_state.get("_xlsx")
        if x_state and x_state["key"] == key:
            st.download_button("Download workbook", x_state["bytes"], f"customeriq_workbook_{stamp}.xlsx",
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                               icon=":material/download:", width="stretch")
    with right:
        st.markdown("**CSV extract**")
        st.caption("Any analytical table as a CSV file for further analysis.")
        choice = st.selectbox("Table", list(CSV_EXPORTS), key="csv_choice", label_visibility="collapsed")
        df = data.get(CSV_EXPORTS[choice], filters)
        st.download_button(f"Download CSV ({len(df):,} rows)", df.to_csv(index=False).encode("utf-8"),
                           f"customeriq_{CSV_EXPORTS[choice]}_{stamp}.csv", "text/csv",
                           icon=":material/download:", width="stretch")

    st.subheader("Business findings")
    st.caption("Each finding is produced by a documented rule (src/insights/engine.py) from the calculated metrics. "
               "Rules without enough supporting data are skipped rather than estimated.")
    insights = data.get("insights", filters, currency=cur)
    if not insights:
        no_rows("Not enough data to generate findings for this selection.")
        return
    kinds = st.segmented_control("Show", ["All", "Risks", "Opportunities", "Information"], default="All",
                                 key="insight_kind")
    wanted = {"Risks": "risk", "Opportunities": "opportunity", "Information": "info"}.get(kinds or "All")
    shown = [i for i in insights if wanted is None or i.kind == wanted]
    cols = st.columns(2)
    for i, ins in enumerate(shown):
        with cols[i % 2]:
            insight_card(ins, detailed=True)
    if not shown:
        st.caption("No findings of this type for the current selection.")
    frame = insights_frame(insights).drop(columns=["value"])
    st.download_button("Download findings (CSV)", frame.to_csv(index=False).encode("utf-8"),
                       f"customeriq_findings_{stamp}.csv", "text/csv", icon=":material/download:")

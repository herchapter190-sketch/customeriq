"""SQL Library: browse, read and run the documented analytical SQL behind every page.

Read-only: each query is executed exactly as the dashboards execute it (same
macro expansion and bound parameters for the current sidebar filters). No
user-written SQL is executed.
"""
from __future__ import annotations

import re

import streamlit as st

from src.analytics.context import prepare_context
from src.database.connection import session
from src.reports.safe_export import csv_bytes
from src.segments.rfm import build_rfm_sql
from src.sql.runner import QUERY_DIR, list_queries, run_sql
from src.ui import data
from src.ui.components import note
from src.ui.pages._common import require_filters

_HEADER_FIELD = re.compile(r"^--\s*(Purpose|Params|Returns|SQL|Notes|Method)\s*:\s*(.*)$")


def parse_header(text: str) -> dict[str, str]:
    """Extract the documented header fields (Purpose, Params, Returns, SQL, ...) of a query file."""
    fields: dict[str, str] = {}
    current = None
    for line in text.splitlines():
        if not line.startswith("--"):
            break
        m = _HEADER_FIELD.match(line)
        if m:
            current = m.group(1)
            fields[current] = m.group(2).strip()
        elif current and re.match(r"^--\s{3,}\S", line):
            fields[current] += " " + line.lstrip("-").strip()
        elif line.strip("-= ") == "":
            continue
    return fields


def _query_text(name: str, filters) -> str:
    if name == "rfm_scores":
        return build_rfm_sql(filters.rfm)  # scoring expressions follow the active RFM settings
    return (QUERY_DIR / f"{name}.sql").read_text(encoding="utf-8")


@st.cache_data(show_spinner=False)
def _catalogue(version: str) -> list[dict]:
    rows = []
    for name in list_queries():
        meta = parse_header((QUERY_DIR / f"{name}.sql").read_text(encoding="utf-8"))
        rows.append({"query": name, "purpose": meta.get("Purpose", ""), "techniques": meta.get("SQL", "")})
    return rows


def render() -> None:
    filters = require_filters("SQL Library", "The documented SQLite queries that power every analysis")
    if filters is None:
        return

    note("All analytics in CustomerIQ are computed by these SQL files in <code>src/sql/queries/</code>. "
         "Pick a query to read its documentation and SQL, then run it with the current sidebar filters. "
         "Filters are bound as parameters, never formatted into the SQL text.")

    catalogue = _catalogue(data.dataset_version())
    with st.expander(f"Query catalogue ({len(catalogue)} queries)", icon=":material/menu_book:"):
        st.dataframe(catalogue, hide_index=True, width="stretch",
                     column_config={"query": "Query", "purpose": "Purpose", "techniques": "SQL techniques"})

    names = [c["query"] for c in catalogue]
    default = names.index("repeat_purchase") if "repeat_purchase" in names else 0
    name = st.selectbox("Query", names, index=default, key="sql_query")
    sql = _query_text(name, filters)
    meta = parse_header(sql)

    left, right = st.columns([2, 3], gap="large")
    with left:
        for label in ("Purpose", "Params", "Returns", "SQL", "Method", "Notes"):
            if meta.get(label):
                st.markdown(f"**{'Techniques' if label == 'SQL' else label}:** {meta[label]}")
    with right:
        st.code(sql, language="sql", height=360)

    needs_customer = ":customer_id" in sql
    customer_id = None
    if needs_customer:
        customer_id = st.text_input("Customer ID (required by this query)", key="sql_customer").strip()

    if st.button("Run query with current filters", type="primary", icon=":material/play_arrow:", key="sql_run"):
        if needs_customer and not customer_id:
            st.warning("Enter a customer ID to run this query.")
            return
        with session(data.DB_PATH) as conn:
            ctx = prepare_context(conn, filters)
            params = ctx.params(**({"customer_id": customer_id} if needs_customer else {}))
            try:
                result = run_sql(conn, sql, params)
            except Exception as exc:  # surfaced to the user instead of crashing the page
                st.error(f"Query failed: {exc}")
                return
        st.caption(f"{len(result):,} rows returned | period {filters.start_date} to {filters.end_date}")
        if result.empty:
            st.info("The query ran successfully but returned no rows for the current filters.")
        else:
            st.dataframe(result, hide_index=True, width="stretch", height=min(420, 38 + 35 * len(result)))
            st.download_button("Download result (CSV)", csv_bytes(result),
                               file_name=f"{name}.csv", mime="text/csv", icon=":material/download:",
                               key="sql_download", on_click="ignore")

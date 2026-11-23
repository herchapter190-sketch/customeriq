"""7. Data Management: dataset status, demo data, file import with validation."""
from __future__ import annotations

import hashlib

import pandas as pd
import streamlit as st

from src.config import CleaningOptions
from src.database.connection import session
from src.etl.cleaner import REJECTION_REASONS, clean_transactions
from src.etl.loader import STANDARD_FIELDS, apply_mapping, read_table, suggest_mapping
from src.etl.pipeline import import_dataframe, load_demo_dataset
from src.etl.synthetic import DEFAULT_SEED, SYNTHETIC_LABEL, generate_demo_transactions
from src.reports.safe_export import csv_bytes
from src.sql.runner import run_sql
from src.ui import data
from src.ui.story import story_banner
from src.ui.components import empty_state, note, number, page_header, stat

NOT_MAPPED = "(not mapped)"

TEMPLATE = pd.DataFrame({
    "InvoiceNo": ["100001", "100001", "100002", "C100001"],
    "CustomerID": ["C-1001", "C-1001", "C-1002", "C-1001"],
    "InvoiceDate": ["2024-01-05 10:15", "2024-01-05 10:15", "2024-01-06 14:02", "2024-01-09 09:30"],
    "StockCode": ["SKU-1", "SKU-2", "SKU-1", "SKU-2"],
    "Description": ["Ceramic mug", "Tea towel", "Ceramic mug", "Tea towel"],
    "Category": ["Kitchen", "Kitchen", "Kitchen", "Kitchen"],
    "Quantity": [2, 1, 4, -1],
    "UnitPrice": [8.50, 6.00, 8.50, 6.00],
    "Country": ["United Kingdom", "United Kingdom", "France", "United Kingdom"],
})


def _summary_metrics(summary: dict) -> None:
    c = st.columns(5)
    c[0].metric("Rows read", number(summary["input_rows"]), border=True)
    c[1].metric("Valid sales lines", number(summary["sales_rows"]), border=True)
    c[2].metric("Return lines", number(summary["return_rows"]), border=True,
                help="Negative quantities or cancellation-prefixed invoices. Kept and analysed as returns.")
    c[3].metric("Rejected rows", number(summary["rejected_rows"]), border=True,
                help="Excluded by validation rules; see the breakdown.")
    c[4].metric("Customers", number(summary["customers"]), border=True)


def _rejections(summary: dict) -> pd.DataFrame:
    rows = [{"Rule": REJECTION_REASONS[k], "Rows": v} for k, v in summary.get("rejection_counts", {}).items() if v]
    return pd.DataFrame(rows, columns=["Rule", "Rows"])


def _current_tab(info: dict) -> None:
    if not info["has_data"]:
        empty_state("No dataset loaded", "Load the synthetic demo dataset or import a file using the tabs above.")
        return
    meta, ov = info["meta"], info["overview"]
    if meta.get("is_synthetic"):
        note(f"<b>{SYNTHETIC_LABEL}.</b> Generated deterministically for demonstration; it does not describe real "
             "customers or a real business.")
    st.markdown(f"**Source:** {meta.get('source_name', 'n/a')}  \n**Loaded:** {str(meta.get('loaded_at', ''))[:19]} UTC")
    c = st.columns(5)
    c[0].metric("Transaction lines", number(ov["total_rows"]), border=True)
    c[1].metric("Customers", number(ov["customers"]), border=True)
    c[2].metric("Sales invoices", number(ov["sales_invoices"]), border=True)
    c[3].metric("Products", number(ov["products"]), border=True)
    with c[4]:
        stat("Date range", f"{ov['first_date']}", f"to {ov['last_date']}")

    summary = meta.get("cleaning_summary") or {}
    if summary:
        st.subheader("Import validation summary")
        _summary_metrics(summary)
        rej = _rejections(summary)
        left, right = st.columns([1, 1])
        with left:
            st.markdown("**Rows excluded by rule**")
            if rej.empty:
                st.success("No rows were rejected.")
            else:
                st.dataframe(rej, hide_index=True, width="stretch")
        with right:
            st.markdown("**Warnings**")
            warnings = meta.get("warnings") or []
            if warnings:
                for w in warnings:
                    st.warning(w, icon=":material/warning:")
            else:
                st.success("No warnings.")
        with st.expander("Inspect rejected rows", icon=":material/search:"):
            with session(data.DB_PATH) as conn:
                rejected = run_sql(conn, "SELECT source_row, reason, raw FROM rejected_rows ORDER BY source_row "
                                         "LIMIT 500")
            if rejected.empty:
                st.caption("None.")
            else:
                st.dataframe(rejected, hide_index=True, width="stretch")
                st.caption("Showing up to 500 rows. source_row is the 1-based data row in the original file.")

    st.subheader("Clear dataset")
    confirm = st.checkbox("I understand this removes the loaded dataset from the local database.", key="confirm_clear")
    if st.button("Clear dataset", disabled=not confirm, icon=":material/delete:"):
        with session(data.DB_PATH) as conn:
            with conn:
                for table in ("transactions", "rejected_rows", "customer_segments", "dataset_meta"):
                    conn.execute(f"DELETE FROM {table}")
        data.clear_caches()
        st.rerun()


STEPS = (("1", "Upload your file", "A CSV or Excel export from your shop, till or accounting system, one row per "
                                    "item sold."),
         ("2", "Check the columns", "CustomerIQ guesses which column is which (date, customer, price...). "
                                    "Correct any guess that is wrong."),
         ("3", "Validate, then import", "See exactly which rows would be kept, fixed or left out, and why, before "
                                        "anything replaces your current data."))


def _steps() -> None:
    st.markdown("<div class='ciq-steps'>" + "".join(
        f"<div><div class='k'>{k}</div><div class='t'>{t}</div><div class='d'>{d}</div></div>" for k, t, d in STEPS)
        + "</div>", unsafe_allow_html=True)


def _import_tab() -> None:
    _steps()
    st.markdown("Upload a transaction-level export as **CSV** or **Excel (.xlsx)**. One row per invoice line. "
                "Required fields: invoice ID, customer ID, date, quantity and unit price. Compatible with the "
                "public *UCI Online Retail* and *Online Retail II* datasets.")
    st.download_button("Download a CSV template", csv_bytes(TEMPLATE),
                       "customeriq_template.csv", "text/csv", icon=":material/download:")
    upload = st.file_uploader("Transaction file", type=["csv", "txt", "xlsx", "xlsm"], key="uploader")
    if upload is None:
        return
    raw_bytes = upload.getvalue()
    file_id = hashlib.sha1(raw_bytes).hexdigest()[:12]
    cache = st.session_state.get("_upload")
    if not cache or cache["id"] != file_id:
        try:
            with st.spinner("Reading file..."):
                raw = read_table(raw_bytes, upload.name)
        except Exception as exc:  # surface parser errors clearly to the user
            st.error(f"Could not read the file: {exc}")
            return
        st.session_state["_upload"] = cache = {"id": file_id, "name": upload.name, "raw": raw}
        st.session_state.pop("_validation", None)
    raw: pd.DataFrame = cache["raw"]
    if raw.empty:
        st.error("The file contains no data rows.")
        return

    st.subheader("1. Preview")
    st.caption(f"{upload.name}: {len(raw):,} rows x {len(raw.columns)} columns. First 20 rows shown.")
    st.dataframe(raw.head(20), width="stretch", hide_index=True)

    st.subheader("2. Map columns")
    suggested = suggest_mapping(list(raw.columns))
    options = [NOT_MAPPED] + list(raw.columns)
    mapping: dict[str, str | None] = {}
    cols = st.columns(5)
    for i, (field, (required, label)) in enumerate(STANDARD_FIELDS.items()):
        default = suggested.get(field)
        choice = cols[i % 5].selectbox(f"{label}{' *' if required else ''}", options,
                                       index=options.index(default) if default in options else 0,
                                       key=f"map_{file_id}_{field}")
        mapping[field] = None if choice == NOT_MAPPED else choice
    st.caption("Fields marked with an asterisk are required. Suggestions are automatic; adjust any that are wrong.")

    with st.expander("Cleaning options", icon=":material/tune:"):
        c1, c2, c3 = st.columns(3)
        dayfirst = c1.checkbox("Dates are day-first (DD/MM/YYYY)", value=False, key=f"dayfirst_{file_id}")
        prefix = c2.text_input("Cancellation invoice prefix", value="C", max_chars=3, key=f"prefix_{file_id}",
                               help="Invoices starting with this prefix followed by a digit are treated as returns.")
        drop_zero = c3.checkbox("Exclude zero-price lines", value=True, key=f"zero_{file_id}")
    options_obj = CleaningOptions(return_invoice_prefix=prefix.strip(), dayfirst=dayfirst, drop_zero_price=drop_zero)

    st.subheader("3. Validate and import")
    signature = (file_id, tuple(sorted((k, v or "") for k, v in mapping.items())), options_obj)
    if st.button("Validate data", type="secondary", icon=":material/fact_check:"):
        try:
            with st.spinner("Validating..."):
                result = clean_transactions(apply_mapping(raw, mapping), options_obj)
            st.session_state["_validation"] = {"sig": signature, "result": result}
        except ValueError as exc:
            st.error(str(exc))
            st.session_state.pop("_validation", None)

    validation = st.session_state.get("_validation")
    if not validation or validation["sig"] != signature:
        st.caption("Validate the mapped data to see the cleaning summary before importing.")
        return
    result = validation["result"]
    _summary_metrics(result.summary)
    left, right = st.columns(2)
    with left:
        rej = _rejections(result.summary)
        st.markdown("**Rows excluded by rule**")
        if rej.empty:
            st.success("No rows rejected.")
        else:
            st.dataframe(rej, hide_index=True, width="stretch")
    with right:
        st.markdown("**Warnings**")
        for w in result.warnings or []:
            st.warning(w, icon=":material/warning:")
        if not result.warnings:
            st.success("No warnings.")
    if result.clean.empty:
        st.error("No valid transactions remain after validation, so nothing can be imported. Check the column "
                 "mapping and the rejected-row reasons above.")
        return
    s = result.summary
    st.markdown(f"Clean data covers **{s['date_min']} to {s['date_max']}**, {s['customers']:,} customers, "
                f"{s['sales_invoices']:,} sales invoices and {s['products']:,} products.")
    st.dataframe(result.clean.head(20), hide_index=True, width="stretch")
    if st.button("Import and replace current dataset", type="primary", icon=":material/upload:"):
        with st.spinner("Importing..."):
            with session(data.DB_PATH) as conn:
                import_dataframe(conn, raw, mapping, source_name=cache["name"], is_synthetic=False,
                                 options=options_obj)
        data.clear_caches()
        st.session_state.pop("_validation", None)
        st.session_state.pop("_upload", None)
        st.toast(f"Imported {s['clean_rows']:,} transaction lines from {cache['name']}.", icon=":material/check_circle:")
        st.rerun()


def _demo_tab() -> None:
    st.markdown(
        "The demo dataset is **synthetic**: a deterministic generator simulates an online homeware retailer with "
        "customer personas (high-value, regular, occasional, one-time and seasonal gift buyers), churn, seasonal "
        "peaks, partial returns and a small number of deliberate data-quality problems for the cleaning pipeline "
        "to catch. It is clearly labelled as synthetic throughout the application and reports.")
    c1, c2 = st.columns(2)
    seed = c1.number_input("Random seed", 1, 99_999_999, DEFAULT_SEED, help="Same seed = identical dataset.")
    n = c2.number_input("Customers to simulate", 200, 6000, 1600, step=100)
    a, b = st.columns(2)
    if a.button("Load synthetic demo dataset", type="primary", icon=":material/science:", width="stretch"):
        with st.spinner("Generating and loading..."):
            with session(data.DB_PATH) as conn:
                load_demo_dataset(conn, seed=int(seed), n_customers=int(n))
        data.clear_caches()
        st.toast("Synthetic demo dataset loaded.", icon=":material/check_circle:")
        st.rerun()
    if b.button("Prepare raw demo file for download", icon=":material/download:", width="stretch"):
        raw = generate_demo_transactions(n_customers=int(n), seed=int(seed))
        st.session_state["_demo_csv"] = csv_bytes(raw)
    if st.session_state.get("_demo_csv"):
        st.download_button("Download raw synthetic CSV (includes injected data-quality issues)",
                           st.session_state["_demo_csv"], "customeriq_synthetic_raw.csv", "text/csv",
                           icon=":material/download:")


def render() -> None:
    page_header("Data Management", "Bring in your sales data, check it, and see what is loaded now.",
                "Everything stays on this computer: files are read locally and stored in a local database.")
    story_banner("data")
    info = data.current_dataset()
    upload, current, demo = st.tabs(["Import your data", "What is loaded now", "Try the demo data"])
    with current:
        _current_tab(info)
    with upload:
        _import_tab()
    with demo:
        _demo_tab()

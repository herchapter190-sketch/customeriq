"""Session state, sidebar filters and dataset bootstrap."""
from __future__ import annotations

from datetime import date, timedelta

import streamlit as st

from src.analytics.context import AnalysisFilters
from src.config import APP_TAGLINE, SEGMENT_ORDER, RFMConfig, RiskConfig
from src.ui import data

PRESETS = ("All data", "Last 12 months", "Last 6 months", "Last 3 months", "Year to date", "Custom")
# No dataset (demo or imported) declares its currency, so the default is "Not specified": amounts are shown
# as plain numbers in the dataset's own units. Choosing a currency only adds a symbol; nothing is converted.
UNSPECIFIED = "Not specified"
CURRENCIES = {UNSPECIFIED: "", "£ GBP": "£", "$ USD": "$", "€ EUR": "€"}


def init_state() -> None:
    ss = st.session_state
    ss.setdefault("rfm_config", RFMConfig())
    ss.setdefault("risk_config", RiskConfig())
    ss.setdefault("currency_label", UNSPECIFIED)
    if ss["currency_label"] not in CURRENCIES:  # stale value from an older session
        ss["currency_label"] = UNSPECIFIED
    ss.setdefault("period_preset", "All data")
    ss.setdefault("segment_filter", [])
    ss.setdefault("show_motion", True)


def bootstrap_demo_if_new() -> None:
    """On a brand-new install (no database file yet) load the synthetic demo dataset."""
    if data.DB_PATH.exists():
        return
    from src.database.connection import session
    from src.etl.pipeline import load_demo_dataset
    with st.spinner("First run: generating the synthetic demo dataset..."):
        with session(data.DB_PATH) as conn:
            load_demo_dataset(conn)
    data.clear_caches()


def _preset_range(preset: str, lo: date, hi: date) -> tuple[date, date]:
    if preset == "Last 12 months":
        start = hi - timedelta(days=364)
    elif preset == "Last 6 months":
        start = hi - timedelta(days=182)
    elif preset == "Last 3 months":
        start = hi - timedelta(days=90)
    elif preset == "Year to date":
        start = date(hi.year, 1, 1)
    else:
        start = lo
    return max(start, lo), hi


def _on_preset_change() -> None:
    ss = st.session_state
    bounds = ss.get("_bounds")
    if bounds and ss["period_preset"] != "Custom":
        ss["date_range"] = _preset_range(ss["period_preset"], *bounds)


def _on_dates_change() -> None:
    st.session_state["period_preset"] = "Custom"


def _reset_filters() -> None:
    ss = st.session_state
    ss["period_preset"] = "All data"
    ss["segment_filter"] = []
    if ss.get("_bounds"):
        ss["date_range"] = ss["_bounds"]


def _reset_all() -> None:
    """Filters plus every analysis setting (RFM rules, inactivity rules, currency) back to defaults."""
    _reset_filters()
    ss = st.session_state
    ss["rfm_config"] = RFMConfig()
    ss["risk_config"] = RiskConfig()
    ss["currency_label"] = UNSPECIFIED
    ss["show_motion"] = True
    st.toast("Settings restored to defaults. Your data was not changed.", icon=":material/restart_alt:")


def _refresh_data() -> None:
    """Drop cached results so every page re-reads the database (e.g. after editing data outside the app)."""
    data.clear_caches()
    st.toast("Data refreshed from the database.", icon=":material/check:")


def currency() -> str:
    return CURRENCIES.get(st.session_state.get("currency_label", UNSPECIFIED), "")


def currency_caption() -> str:
    """Short label stating the currency the amounts are shown in, or that it is unknown."""
    label = st.session_state.get("currency_label", UNSPECIFIED)
    if label not in CURRENCIES or label == UNSPECIFIED:
        return "Currency not specified"
    return f"Amounts in {label.split()[-1]}"


def sidebar(info: dict) -> AnalysisFilters | None:
    ss = st.session_state
    with st.sidebar:
        st.markdown(f"<div class='ciq-tagline'>{APP_TAGLINE}</div>", unsafe_allow_html=True)
        meta = info.get("meta", {})
        if info.get("has_data"):
            synthetic = bool(meta.get("is_synthetic"))
            badge = "synthetic" if synthetic else "real"
            text = "Synthetic demo data" if synthetic else "User dataset"
            st.markdown(f"<span class='ciq-badge {badge}'>{text}</span>", unsafe_allow_html=True)
            st.caption(str(meta.get("source_name", "")))
        else:
            st.caption("No dataset loaded")
        st.divider()

        if not info.get("has_data"):
            return None

        lo, hi = (date.fromisoformat(d) for d in info["bounds"])
        if ss.get("_bounds") != (lo, hi):  # new dataset -> reset the window
            ss["_bounds"] = (lo, hi)
            ss["date_range"] = _preset_range(ss.get("period_preset", "All data"), lo, hi)

        st.selectbox("Period", PRESETS, key="period_preset", on_change=_on_preset_change,
                     help="Quick reporting windows ending on the last date in the dataset.")
        picked = st.date_input("Date range", key="date_range", min_value=lo, max_value=hi,
                               on_change=_on_dates_change, format="YYYY-MM-DD",
                               help="All analyses use transactions in this window. RFM and inactivity are "
                                    "evaluated as of the end date using all history up to it.")
        if isinstance(picked, (tuple, list)) and len(picked) == 2:
            start, end = picked
        else:  # user is mid-selection: keep the last complete range
            start, end = ss.get("_last_range", (lo, hi))
        ss["_last_range"] = (start, end)

        st.multiselect("Customer segments", list(SEGMENT_ORDER), key="segment_filter",
                       placeholder="All segments",
                       help="Restrict every analysis to customers in the selected RFM segments "
                            "(segments as of the end date).")
        st.selectbox("Currency", list(CURRENCIES), key="currency_label",
                     help="Your data file does not say which currency it uses, so amounts are shown as plain "
                          "numbers. Pick the currency your shop trades in to add its symbol. Display only: "
                          "nothing is converted.")
        st.button("Reset filters", on_click=_reset_filters, width="stretch", icon=":material/filter_alt_off:",
                  help="Show all dates and all customer groups again. Other settings are kept.")
        st.button("Refresh data", on_click=_refresh_data, width="stretch", icon=":material/refresh:",
                  help="Re-read the latest data from the local database.")
        st.button("Reset everything", on_click=_reset_all, width="stretch", icon=":material/restart_alt:",
                  help="Filters, scoring rules, inactivity rules, currency and animations back to their "
                       "defaults. Your data is not touched.")
        st.toggle("Show animations", key="show_motion",
                  help="Turn off to hide the section animations (less motion, faster on slow machines).")
        st.divider()
        st.caption(f"Data range: {lo} to {hi}")

    return AnalysisFilters(
        start_date=start.isoformat(),
        end_date=end.isoformat(),
        segments=tuple(ss.get("segment_filter", [])),
        rfm=ss["rfm_config"],
        risk=ss["risk_config"],
    )


def set_filters(filters: AnalysisFilters | None) -> None:
    st.session_state["_filters"] = filters


def current_filters() -> AnalysisFilters | None:
    return st.session_state.get("_filters")

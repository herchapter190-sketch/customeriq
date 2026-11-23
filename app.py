"""CustomerIQ - Streamlit entry point.

Run with:  streamlit run app.py
"""
from __future__ import annotations

import streamlit as st

from src.config import APP_NAME, PROJECT_ROOT

st.set_page_config(page_title=APP_NAME, page_icon=":material/insights:", layout="wide",
                   initial_sidebar_state="auto")  # open on desktop, collapsed on phones

from src.ui import data, state  # noqa: E402  (set_page_config must run first)
from src.ui.pages import (behaviour, cohorts, data_management, inactive, overview, reports,  # noqa: E402
                          revenue, segmentation, sql_library)
from src.ui.theme import apply_theme  # noqa: E402

apply_theme()
st.logo(str(PROJECT_ROOT / "assets" / "logo.svg"), size="large", icon_image=str(PROJECT_ROOT / "assets" / "icon.svg"))
state.init_state()
state.bootstrap_demo_if_new()

info = data.current_dataset()
state.set_filters(state.sidebar(info))

pages = {
    "Analytics": [
        st.Page(overview.render, title="Executive Overview", icon=":material/dashboard:", url_path="overview",
                default=True),
        st.Page(segmentation.render, title="Customer Segmentation", icon=":material/groups:", url_path="segments"),
        st.Page(revenue.render, title="Revenue Analytics", icon=":material/payments:", url_path="revenue"),
        st.Page(cohorts.render, title="Cohort Retention", icon=":material/grid_on:", url_path="cohorts"),
        st.Page(behaviour.render, title="Customer Behaviour", icon=":material/insights:", url_path="behaviour"),
        st.Page(inactive.render, title="Inactive Customers", icon=":material/person_off:", url_path="inactive"),
    ],
    "Data & Reports": [
        st.Page(data_management.render, title="Data Management", icon=":material/database:", url_path="data"),
        st.Page(sql_library.render, title="SQL Library", icon=":material/code:", url_path="sql"),
        st.Page(reports.render, title="Reports & Exports", icon=":material/description:", url_path="reports"),
    ],
}
st.navigation(pages, position="sidebar").run()

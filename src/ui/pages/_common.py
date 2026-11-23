"""Helpers shared by all dashboard pages."""
from __future__ import annotations

import plotly.graph_objects as go
import streamlit as st

from src.analytics.context import AnalysisFilters
from src.ui import data, state
from src.ui.components import empty_state, page_header

PLOTLY_CONFIG = {"displaylogo": False, "modeBarButtonsToRemove": ["lasso2d", "select2d", "autoScale2d"]}


def load_demo(key: str) -> None:
    if st.button("Load synthetic demo dataset", key=key, type="primary", icon=":material/science:"):
        from src.database.connection import session
        from src.etl.pipeline import load_demo_dataset
        with st.spinner("Generating and loading the synthetic demo dataset..."):
            with session(data.DB_PATH) as conn:
                load_demo_dataset(conn)
        data.clear_caches()
        st.rerun()


def require_filters(title: str, subtitle: str) -> AnalysisFilters | None:
    """Render the page header; return filters, or show an empty state when no data is loaded."""
    filters = state.current_filters()
    if filters is None:
        page_header(title, subtitle)
        empty_state("No dataset loaded",
                    "Load the synthetic demo dataset below, or import your own CSV / Excel file on the "
                    "Data Management page.")
        st.write("")
        load_demo(key=f"demo_{title}")
        return None
    seg = f"  ·  Segments: {', '.join(filters.segments)}" if filters.segments else ""
    meta = f"{filters.start_date} to {filters.end_date}{seg}  ·  {state.currency_caption()}"
    page_header(title, subtitle, meta)
    return filters


def show(fig: go.Figure, height: int = 360, key: str | None = None) -> None:
    fig.update_layout(height=height)
    st.plotly_chart(fig, width="stretch", config=PLOTLY_CONFIG, key=key, theme=None)


def no_rows(message: str = "No transactions match the current filters.") -> None:
    empty_state("Nothing to show", message + " Try widening the date range or clearing the segment filter.")

"""Cached access to the analytics layer for the Streamlit UI.

Every call opens a short-lived SQLite connection (cheap and thread-safe) and caches
the result keyed on the dataset version and the full filter state, so changing any
filter or loading a new dataset always produces fresh numbers.
"""
from __future__ import annotations

from typing import Any

import streamlit as st

from src.analytics.context import AnalysisFilters, prepare_context
from src.config import DEFAULT_DB_PATH
from src.database.connection import data_version, session
from src.services.registry import FUNCTIONS, dataset_summary  # noqa: F401  (FUNCTIONS re-exported)

DB_PATH = DEFAULT_DB_PATH


@st.cache_data(show_spinner=False, max_entries=512)
def _cached(name: str, version: str, filters_key: str, _filters: AnalysisFilters, kwargs: tuple) -> Any:
    with session(DB_PATH) as conn:
        ctx = prepare_context(conn, _filters)
        return FUNCTIONS[name](conn, ctx, **dict(kwargs))


def get(name: str, filters: AnalysisFilters, **kwargs) -> Any:
    """Run analytics function ``name`` for ``filters`` (cached)."""
    return _cached(name, dataset_version(), repr(filters), filters, tuple(sorted(kwargs.items())))


def dataset_version() -> str:
    with session(DB_PATH) as conn:
        return data_version(conn)


@st.cache_data(show_spinner=False)
def dataset_info(version: str) -> dict:
    with session(DB_PATH) as conn:
        return dataset_summary(conn)


def current_dataset() -> dict:
    return dataset_info(dataset_version())


def clear_caches() -> None:
    st.cache_data.clear()

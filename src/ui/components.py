"""Reusable UI building blocks."""
from __future__ import annotations

import html

import pandas as pd
import streamlit as st

from src.insights.engine import Insight
from src.reports.safe_export import csv_bytes


CHAPTERS = {"Executive Overview": "01", "Customer Segmentation": "02", "Revenue Analytics": "03",
            "Cohort Retention": "04", "Data Management": "05"}


def page_header(title: str, subtitle: str, meta: str = "") -> None:
    """Editorial page header: chapter number, display title, one-line purpose and a quiet meta line."""
    no = CHAPTERS.get(title, "")
    num = f"<div class='no'>{no}</div>" if no else ""
    meta_html = f"<div class='meta'>{html.escape(meta)}</div>" if meta else ""
    st.markdown(
        f"<div class='ciq-head'>{num}<div class='tx'><div class='ttl'>{html.escape(title)}</div>"
        f"<div class='sub'>{html.escape(subtitle)}</div>{meta_html}</div></div>",
        unsafe_allow_html=True)


def explain(read: str, means: str) -> None:
    """Two short lines under a chart: how to read it, and why it matters for the business."""
    st.markdown(
        f"<div class='ciq-explain'><div><b>How to read it</b>{html.escape(read)}</div>"
        f"<div><b>Why it matters</b>{html.escape(means)}</div></div>",
        unsafe_allow_html=True)


def note(text: str) -> None:
    """Short explanatory note (text may contain simple trusted HTML)."""
    st.markdown(f"<div class='ciq-note'>{text}</div>", unsafe_allow_html=True)


def empty_state(title: str, message: str) -> None:
    st.markdown(
        f"<div class='ciq-empty'><div class='t'>{html.escape(title)}</div>{html.escape(message)}</div>",
        unsafe_allow_html=True,
    )


def stat(label: str, value: str, sub: str = "") -> None:
    st.markdown(
        f"<div class='ciq-stat'><div class='l'>{html.escape(label)}</div><div class='v'>{html.escape(value)}</div>"
        f"<div class='s'>{html.escape(sub)}</div></div>",
        unsafe_allow_html=True,
    )


def insight_card(ins: Insight, detailed: bool = False) -> None:
    e = html.escape
    body = (f"<dl><dt>What was observed</dt><dd>{e(ins.observation)}</dd>"
            f"<dt>Supporting metric</dt><dd>{e(ins.metric)}</dd>"
            f"<dt>Why it matters</dt><dd>{e(ins.why_it_matters)}</dd>"
            f"<dt>Action to consider</dt><dd>{e(ins.action)}</dd></dl>") if detailed else (
        f"<div class='body'>{e(ins.observation)}</div><div class='metric'>{e(ins.metric)}</div>")
    st.markdown(
        f"<div class='ciq-insight'><span class='kind {ins.kind}'>{e(ins.kind)}</span>"
        f"<span class='cat'>{e(ins.category)}</span><div class='title'>{e(ins.title)}</div>{body}</div>",
        unsafe_allow_html=True,
    )


def money(value: float | None, currency: str = "", decimals: int = 0) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    sign = "-" if value < 0 else ""
    return f"{sign}{currency}{abs(value):,.{decimals}f}"


def number(value: float | None, decimals: int = 0) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value:,.{decimals}f}"


def pct(value: float | None, decimals: int = 1) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value:.{decimals}f}%"


def delta_text(change_pct: float | None) -> str | None:
    if change_pct is None or pd.isna(change_pct):
        return None
    return f"{change_pct:+.1f}% vs prior period"


def csv_download(df: pd.DataFrame, filename: str, label: str = "Download CSV", key: str | None = None) -> None:
    st.download_button(label, csv_bytes(df), file_name=filename, mime="text/csv",
                       key=key or f"dl_{filename}", icon=":material/download:")


def search_filter(df: pd.DataFrame, query: str, columns: list[str]) -> pd.DataFrame:
    """Case-insensitive substring search across ``columns``."""
    if not query:
        return df
    q = query.strip().lower()
    mask = pd.Series(False, index=df.index)
    for c in columns:
        mask |= df[c].astype(str).str.lower().str.contains(q, regex=False, na=False)
    return df[mask]

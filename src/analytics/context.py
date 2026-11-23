"""Analysis filters and the per-request context passed to every analytics function."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from src.config import RFMConfig, RiskConfig
from src.database.connection import data_version, date_bounds
from src.segments.rfm import materialize_segments


@dataclass(frozen=True)
class AnalysisFilters:
    """User-selected filters. Frozen/hashable so it can key Streamlit caches."""

    start_date: str
    end_date: str
    segments: tuple[str, ...] = ()
    rfm: RFMConfig = field(default_factory=RFMConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)

    def __post_init__(self) -> None:
        if self.start_date > self.end_date:
            raise ValueError("Start date must be on or before end date")


@dataclass(frozen=True)
class AnalysisContext:
    filters: AnalysisFilters
    run_key: str
    data_version: str

    def params(self, **overrides) -> dict:
        f = self.filters
        base = {
            "start_date": f.start_date,
            "end_date": f.end_date,
            "run_key": self.run_key,
            "seg_filter": 1 if f.segments else 0,
            "segments": json.dumps(list(f.segments)),
            "active_days": f.risk.active_days,
            "cooling_days": f.risk.cooling_days,
            "at_risk_days": f.risk.at_risk_days,
            "overdue_multiplier": f.risk.overdue_multiplier,
        }
        base.update(overrides)
        return base

    def with_dates(self, start_date: str, end_date: str) -> "AnalysisContext":
        """Same segments/run, different reporting window (segments stay as of the original snapshot)."""
        return replace(self, filters=replace(self.filters, start_date=start_date, end_date=end_date))

    @property
    def period_days(self) -> int:
        return (date.fromisoformat(self.filters.end_date) - date.fromisoformat(self.filters.start_date)).days + 1

    def previous_period(self) -> tuple[str, str]:
        """The equally long window immediately before the selected period."""
        start = date.fromisoformat(self.filters.start_date)
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=self.period_days - 1)
        return prev_start.isoformat(), prev_end.isoformat()


def default_filters(conn: sqlite3.Connection, **kwargs) -> AnalysisFilters:
    lo, hi = date_bounds(conn)
    today = date.today().isoformat()
    return AnalysisFilters(start_date=lo or today, end_date=hi or today, **kwargs)


def prepare_context(conn: sqlite3.Connection, filters: AnalysisFilters) -> AnalysisContext:
    """Validate configuration, materialise RFM segments for the snapshot date and
    return the context used by all analytics functions."""
    filters.rfm.validate()
    filters.risk.validate()
    version = data_version(conn)
    run_key = materialize_segments(conn, version, filters.end_date, filters.rfm)
    return AnalysisContext(filters=filters, run_key=run_key, data_version=version)

"""Central configuration for CustomerIQ.

All analytical thresholds live here so they are documented in one place and can be
overridden from the dashboard. Configuration objects are frozen dataclasses so they
are hashable (required for Streamlit caching) and cannot be mutated accidentally.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
SAMPLE_DIR = DATA_DIR / "sample"
DEFAULT_DB_PATH = Path(os.environ.get("CUSTOMERIQ_DB", DATA_DIR / "customeriq.db"))

APP_NAME = "CustomerIQ"
APP_TAGLINE = "Customer Revenue, Retention & Behaviour Intelligence"

# Number of score bins used by RFM. Segment rules below assume a 1-5 scale.
RFM_BINS = 5


@dataclass(frozen=True)
class SegmentRule:
    """A transparent RFM segment rule.

    Each bound is an inclusive (min, max) range on a 1-5 score, or ``None`` when the
    dimension is not used by the rule. Rules are evaluated in order; the first match wins.
    ``fm`` is the combined Frequency/Monetary score: ``(F + M + 1) // 2``.
    """

    name: str
    description: str
    action: str
    r: tuple[int, int] | None = None
    f: tuple[int, int] | None = None
    m: tuple[int, int] | None = None
    fm: tuple[int, int] | None = None


DEFAULT_SEGMENT_RULES: tuple[SegmentRule, ...] = (
    SegmentRule(
        "Champions",
        "Bought recently, buy often and spend the most.",
        "Reward and retain: early access, loyalty benefits, referral asks.",
        r=(4, 5), fm=(4, 5),
    ),
    SegmentRule(
        "New Customers",
        "Bought recently but only one order so far.",
        "Onboard well: welcome journey, second-purchase incentive.",
        r=(4, 5), f=(1, 1),
    ),
    SegmentRule(
        "Loyal Customers",
        "Buy regularly with above-average value; recency is good.",
        "Upsell and cross-sell; invite to loyalty programme.",
        r=(3, 5), fm=(3, 5),
    ),
    SegmentRule(
        "Potential Loyalists",
        "Recent customers with modest frequency or spend.",
        "Nurture with relevant recommendations to build frequency.",
        r=(3, 5), fm=(1, 2),
    ),
    SegmentRule(
        "Cannot Lose Them",
        "Historically high value but have not purchased for a long time.",
        "Personal win-back outreach; understand why they stopped.",
        r=(1, 1), fm=(4, 5),
    ),
    SegmentRule(
        "At Risk",
        "Above-average value in the past, recency is now poor.",
        "Targeted reactivation offer before they lapse completely.",
        r=(1, 2), fm=(3, 5),
    ),
    SegmentRule(
        "Hibernating",
        "Low recency, low frequency and low spend.",
        "Low-cost reactivation only; avoid heavy discounting.",
        r=(1, 2), fm=(1, 2),
    ),
)

SEGMENT_ORDER: tuple[str, ...] = tuple(r.name for r in DEFAULT_SEGMENT_RULES) + ("Other",)


@dataclass(frozen=True)
class RFMConfig:
    """RFM scoring configuration.

    ``method``:
      * ``"quantile"`` - scores from ``PERCENT_RANK()`` within the customer base
        (ties always share a score).
      * ``"fixed"`` - scores from the absolute thresholds below.

    Fixed thresholds are four ascending cut points producing five scores.
      * recency: days since last purchase; ``<= t[0]`` scores 5, ``> t[3]`` scores 1.
      * frequency / monetary: ``<= t[0]`` scores 1, ``> t[3]`` scores 5.
    """

    method: str = "quantile"
    recency_thresholds: tuple[int, int, int, int] = (30, 90, 180, 365)
    frequency_thresholds: tuple[int, int, int, int] = (1, 2, 4, 7)
    monetary_thresholds: tuple[float, float, float, float] = (100.0, 300.0, 750.0, 2000.0)
    segment_rules: tuple[SegmentRule, ...] = DEFAULT_SEGMENT_RULES

    def validate(self) -> None:
        if self.method not in ("quantile", "fixed"):
            raise ValueError(f"Unknown RFM method: {self.method!r}")
        for label, values in (
            ("recency", self.recency_thresholds),
            ("frequency", self.frequency_thresholds),
            ("monetary", self.monetary_thresholds),
        ):
            if len(values) != RFM_BINS - 1:
                raise ValueError(f"{label} thresholds must contain {RFM_BINS - 1} values")
            if any(float(b) <= float(a) for a, b in zip(values, values[1:])):
                raise ValueError(f"{label} thresholds must be strictly ascending")
            if any(float(v) < 0 for v in values):
                raise ValueError(f"{label} thresholds must be non-negative")
        if not self.segment_rules:
            raise ValueError("At least one segment rule is required")
        for rule in self.segment_rules:
            for bound in (rule.r, rule.f, rule.m, rule.fm):
                if bound is None:
                    continue
                lo, hi = bound
                if not (1 <= int(lo) <= int(hi) <= RFM_BINS):
                    raise ValueError(f"Invalid score range {bound} in rule {rule.name!r}")


@dataclass(frozen=True)
class RiskConfig:
    """Rule-based inactivity thresholds (days since last purchase).

    * ``<= active_days``                  -> Active
    * ``<= cooling_days``                 -> Cooling
    * ``<= at_risk_days``                 -> At Risk
    * ``>  at_risk_days``                 -> Lapsed
    ``overdue_multiplier``: a repeat customer is flagged *overdue* when days inactive
    exceed this multiple of their own average gap between orders.
    """

    active_days: int = 60
    cooling_days: int = 120
    at_risk_days: int = 240
    overdue_multiplier: float = 2.0

    def validate(self) -> None:
        if not (0 < self.active_days < self.cooling_days < self.at_risk_days):
            raise ValueError("Risk thresholds must satisfy 0 < active < cooling < at risk")
        if self.overdue_multiplier <= 0:
            raise ValueError("Overdue multiplier must be positive")


RISK_ORDER: tuple[str, ...] = ("Active", "Cooling", "At Risk", "Lapsed")


@dataclass(frozen=True)
class CleaningOptions:
    """Options for the transaction cleaning pipeline."""

    return_invoice_prefix: str = "C"   # e.g. UCI Online Retail cancellation invoices
    dayfirst: bool = False             # parse ambiguous dates such as 03/04/2024 as 3 April
    drop_zero_price: bool = True


@dataclass(frozen=True)
class AppDefaults:
    rfm: RFMConfig = field(default_factory=RFMConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)

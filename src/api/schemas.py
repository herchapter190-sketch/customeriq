"""Request models. Every model forbids unknown fields so typos fail loudly."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from src.config import SEGMENT_ORDER, RFMConfig, RiskConfig
from src.etl.cleaner import SUPPORTED_CURRENCIES
from src.etl.synthetic import DEFAULT_SEED

SegmentName = Literal[SEGMENT_ORDER]  # type: ignore[valid-type]
CustomerId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64,
                                              pattern=r"^[^\x00-\x1f\x7f]+$")]
Currency = Annotated[str, StringConstraints(max_length=8, pattern=r"^[^\x00-\x1f\x7f<>]*$")]
Days = Annotated[int, Field(ge=1, le=36_500)]
Threshold = Annotated[int, Field(ge=0, le=1_000_000)]
Money = Annotated[float, Field(ge=0, le=1e12, allow_inf_nan=False)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RFMIn(Strict):
    method: Literal["quantile", "fixed"] = "quantile"
    recency_thresholds: tuple[Threshold, Threshold, Threshold, Threshold] = RFMConfig.recency_thresholds
    frequency_thresholds: tuple[Threshold, Threshold, Threshold, Threshold] = RFMConfig.frequency_thresholds
    monetary_thresholds: tuple[Money, Money, Money, Money] = RFMConfig.monetary_thresholds


class RiskIn(Strict):
    active_days: Days = RiskConfig.active_days
    cooling_days: Days = RiskConfig.cooling_days
    at_risk_days: Days = RiskConfig.at_risk_days
    overdue_multiplier: Annotated[float, Field(gt=0, le=100, allow_inf_nan=False)] = RiskConfig.overdue_multiplier


class FiltersIn(Strict):
    """Omitted dates default to the dataset's first / last transaction day."""
    start_date: date | None = None
    end_date: date | None = None
    segments: Annotated[list[SegmentName], Field(max_length=len(SEGMENT_ORDER))] = []
    rfm: RFMIn = RFMIn()
    risk: RiskIn = RiskIn()


class AnalyticsRequest(Strict):
    filters: FiltersIn = FiltersIn()
    customer_id: CustomerId | None = None
    limit: Annotated[int, Field(ge=1, le=500)] | None = None
    currency: Currency | None = None


class BatchRequest(Strict):
    filters: FiltersIn = FiltersIn()
    names: Annotated[list[str], Field(min_length=1, max_length=30)]
    currency: Currency | None = None


class SqlRequest(Strict):
    filters: FiltersIn = FiltersIn()
    customer_id: CustomerId | None = None


class ReportRequest(Strict):
    filters: FiltersIn = FiltersIn()
    currency: Currency = ""


class CleaningIn(Strict):
    return_invoice_prefix: Annotated[str, StringConstraints(max_length=5, pattern=r"^[A-Za-z0-9-]*$")] = "C"
    dayfirst: bool = False
    drop_zero_price: bool = True


ColumnName = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class ImportCommit(Strict):
    upload_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{16,64}$")]
    mapping: dict[Literal["invoice_id", "customer_id", "invoice_date", "quantity", "unit_price", "product_id",
                          "description", "category", "country", "revenue", "currency"], ColumnName | None]
    options: CleaningIn = CleaningIn()
    currency: Literal[SUPPORTED_CURRENCIES] | None = None  # type: ignore[valid-type]  # chosen when '$' is ambiguous
    confirm: Literal[True]


class DemoRequest(Strict):
    seed: Annotated[int, Field(ge=1, le=99_999_999)] = DEFAULT_SEED
    n_customers: Annotated[int, Field(ge=200, le=6000)] = 1600
    confirm: Literal[True]


class DemoRawRequest(Strict):
    """Same bounds as DemoRequest; no confirmation because nothing is written."""
    seed: Annotated[int, Field(ge=1, le=99_999_999)] = DEFAULT_SEED
    n_customers: Annotated[int, Field(ge=200, le=6000)] = 1600


class ConfirmRequest(Strict):
    confirm: Literal[True]

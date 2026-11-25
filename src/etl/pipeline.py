"""End-to-end import: raw table -> mapping -> cleaning -> SQLite."""
from __future__ import annotations

import sqlite3

import pandas as pd

from src.config import CleaningOptions
from src.database.connection import replace_dataset
from src.etl.cleaner import CleaningResult, clean_transactions
from src.etl.loader import apply_mapping
from src.etl.synthetic import DEFAULT_SEED, DEMO_MAPPING, SYNTHETIC_LABEL, generate_demo_transactions


def import_dataframe(
    conn: sqlite3.Connection,
    raw: pd.DataFrame,
    mapping: dict[str, str | None],
    source_name: str,
    is_synthetic: bool = False,
    options: CleaningOptions | None = None,
    currency: str | None = None,
) -> CleaningResult:
    """Validate, clean and load ``raw`` as the active dataset.

    Nothing is written when no valid rows remain, so a bad upload never wipes the
    current dataset.
    """
    standard = apply_mapping(raw, mapping)
    result = clean_transactions(standard, options, currency)
    if result.clean.empty:
        return result
    meta = {
        "source_name": source_name,
        "is_synthetic": is_synthetic,
        "data_label": SYNTHETIC_LABEL if is_synthetic else "User-supplied dataset",
        "mapping": mapping,
        "cleaning_summary": result.summary,
        "warnings": result.warnings,
        "currency": result.summary.get("currency"),
    }
    replace_dataset(conn, result.clean, result.rejected, meta)
    return result


def load_demo_dataset(conn: sqlite3.Connection, seed: int = DEFAULT_SEED, n_customers: int = 1600) -> CleaningResult:
    raw = generate_demo_transactions(n_customers=n_customers, seed=seed)
    return import_dataframe(conn, raw, DEMO_MAPPING, source_name=f"CustomerIQ synthetic generator (seed {seed})",
                            is_synthetic=True)

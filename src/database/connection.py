"""SQLite connection management and dataset persistence."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import pandas as pd

from src.config import DEFAULT_DB_PATH

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

TRANSACTION_COLUMNS = [
    "invoice_id", "customer_id", "invoice_ts", "invoice_day", "invoice_month", "month_num",
    "product_id", "description", "category", "quantity", "unit_price", "revenue",
    "country", "is_return",
]


def connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    """Open a connection with the schema initialised.

    ``":memory:"`` is accepted for tests.
    """
    path = str(db_path or DEFAULT_DB_PATH)
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    if path != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
    init_schema(conn)
    return conn


@contextmanager
def session(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()


def replace_dataset(
    conn: sqlite3.Connection,
    clean: pd.DataFrame,
    rejected: pd.DataFrame | None,
    meta: dict[str, object],
) -> None:
    """Atomically replace the active dataset with ``clean`` transactions."""
    missing = [c for c in TRANSACTION_COLUMNS if c not in clean.columns]
    if missing:
        raise ValueError(f"Clean dataset is missing columns: {missing}")
    rows = clean[TRANSACTION_COLUMNS].astype(object).where(clean[TRANSACTION_COLUMNS].notna(), None)
    placeholders = ",".join("?" * len(TRANSACTION_COLUMNS))
    with conn:  # single transaction
        conn.execute("DELETE FROM transactions")
        conn.execute("DELETE FROM rejected_rows")
        conn.execute("DELETE FROM customer_segments")
        conn.execute("DELETE FROM dataset_meta")
        conn.executemany(
            f"INSERT INTO transactions ({','.join(TRANSACTION_COLUMNS)}) VALUES ({placeholders})",
            rows.itertuples(index=False, name=None),
        )
        if rejected is not None and not rejected.empty:
            conn.executemany(
                "INSERT INTO rejected_rows (source_row, reason, raw) VALUES (?, ?, ?)",
                rejected[["source_row", "reason", "raw"]].itertuples(index=False, name=None),
            )
        stamp = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        full_meta = {**meta, "loaded_at": stamp}
        conn.executemany(
            "INSERT INTO dataset_meta (key, value) VALUES (?, ?)",
            [(k, json.dumps(v, default=str)) for k, v in full_meta.items()],
        )


def get_meta(conn: sqlite3.Connection) -> dict[str, object]:
    rows = conn.execute("SELECT key, value FROM dataset_meta").fetchall()
    return {k: json.loads(v) for k, v in rows}


def data_version(conn: sqlite3.Connection) -> str:
    """Identifier that changes whenever a new dataset is loaded (used for caching)."""
    row = conn.execute("SELECT value FROM dataset_meta WHERE key = 'loaded_at'").fetchone()
    return json.loads(row[0]) if row else "empty"


def has_data(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT EXISTS (SELECT 1 FROM transactions)").fetchone()[0] == 1


def date_bounds(conn: sqlite3.Connection) -> tuple[str | None, str | None]:
    return tuple(conn.execute("SELECT MIN(invoice_day), MAX(invoice_day) FROM transactions").fetchone())

"""Build the packaged public-demo database (deploy time; synthetic data only).

Usage:  python scripts/build_demo_db.py <output.db> [--seed N] [--customers N]

The synthetic generator writes into an isolated scratch database in a new temp dir. The output is
then exported as one compact file with VACUUM INTO, switched to rollback-journal mode and verified
(integrity, synthetic rows, no -wal/-shm sidecars). It never opens data/customeriq.db or backups/,
and refuses any output path inside data/ or backups/ or one that already exists.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.api.demo import verify_demo_db  # noqa: E402
from src.config import DATA_DIR, DEFAULT_DB_PATH  # noqa: E402
from src.database.backup import BACKUP_DIR  # noqa: E402
from src.database.connection import session  # noqa: E402
from src.etl.pipeline import load_demo_dataset  # noqa: E402
from src.etl.synthetic import DEFAULT_SEED  # noqa: E402

SIDECARS = ("-wal", "-shm", "-journal")


def build(out: str | Path, seed: int = DEFAULT_SEED, n_customers: int = 1600) -> int:
    """Write the demo database to ``out``; returns its transaction count."""
    out = Path(out).resolve()
    guarded = (Path(DATA_DIR).resolve(), Path(BACKUP_DIR).resolve())
    if out == Path(DEFAULT_DB_PATH).resolve() or any(g == out or g in out.parents for g in guarded):
        raise ValueError("Refusing to write the demo database inside data/ or backups/")
    if out.exists() or any(Path(f"{out}{s}").exists() for s in SIDECARS):
        raise ValueError(f"{out} already exists; remove it first")
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="customeriq-demo-build-") as tmp:
        with session(Path(tmp) / "scratch.db") as conn:
            load_demo_dataset(conn, seed=seed, n_customers=n_customers)
            conn.execute("VACUUM INTO ?", (str(out),))
    conn = sqlite3.connect(out)
    try:
        conn.execute("PRAGMA journal_mode = DELETE")  # one self-contained file, never WAL
    finally:
        conn.close()
    left = [s for s in SIDECARS if Path(f"{out}{s}").exists()]
    if left:
        raise ValueError(f"Unexpected sidecar files next to {out.name}: {left}")
    return verify_demo_db(out)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("output")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED)
    p.add_argument("--customers", type=int, default=1600)
    args = p.parse_args()
    try:
        rows = build(args.output, args.seed, args.customers)
    except ValueError as exc:
        sys.exit(f"build_demo_db: {exc}")
    print(f"Wrote {rows:,} synthetic transaction lines to {Path(args.output).resolve()}")


if __name__ == "__main__":
    main()

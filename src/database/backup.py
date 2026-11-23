"""Verified SQLite backups taken before any destructive write.

The online backup API copies a consistent snapshot even while other connections
(e.g. the Streamlit app) are reading or writing in WAL mode. A backup only counts
when the copy passes ``PRAGMA integrity_check`` and every table's row count matches.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from src.config import PROJECT_ROOT

BACKUP_DIR = PROJECT_ROOT / "backups"
KEEP_BACKUPS = 10


class BackupError(RuntimeError):
    """Raised when a backup cannot be created or fails verification."""


def _table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}


def backup_database(db_path: str | Path, dest_dir: str | Path | None = None,
                    keep: int = KEEP_BACKUPS) -> Path | None:
    """Copy ``db_path`` to a timestamped file in ``dest_dir`` and verify it.

    Returns the backup path, or ``None`` when there is no database file yet (nothing
    to protect). Raises :class:`BackupError` if the copy is not a verified match.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return None
    dest_dir = Path(dest_dir or BACKUP_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    dest = dest_dir / f"auto-{db_path.stem}-{stamp}.db"
    src = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=30, isolation_level=None)
    dst = sqlite3.connect(dest)
    try:
        src.execute("BEGIN")  # one read snapshot for both the counts and the copy
        expected = _table_counts(src)
        src.backup(dst)
        src.execute("ROLLBACK")
        ok = dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        actual = _table_counts(dst)
    except sqlite3.Error as exc:
        dst.close()
        dest.unlink(missing_ok=True)
        raise BackupError(f"Backup failed: {exc}") from exc
    finally:
        src.close()
    dst.close()
    if not ok or actual != expected:
        dest.unlink(missing_ok=True)
        raise BackupError("Backup verification failed; the database was not modified.")
    _prune(dest_dir, db_path.stem, keep)
    return dest


def _prune(dest_dir: Path, stem: str, keep: int) -> None:
    backups = sorted(dest_dir.glob(f"auto-{stem}-*.db"))  # manual backups are never pruned
    for old in backups[: max(0, len(backups) - keep)]:
        old.unlink(missing_ok=True)

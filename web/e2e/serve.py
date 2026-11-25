"""Test-only launcher for the Playwright suite: the real app on an isolated, throwaway database.

    python e2e/serve.py --root <temp dir> --port 8551 [--short-ttl]

Creates <root>/<port>/customeriq.db with the synthetic demo dataset and points backups at
<root>/<port>/backups. It refuses to run against the project database or backup folder.
The API token comes from CUSTOMERIQ_API_TOKEN, set per run by playwright.config.ts.

--short-ttl shortens login-code and session lifetimes (2 s / 4 s) on this server only, so the
expiry tests finish quickly. Production code and its defaults are not changed.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402

from src.api import app as api_app, security  # noqa: E402
from src.config import DEFAULT_DB_PATH  # noqa: E402
from src.database.backup import BACKUP_DIR  # noqa: E402
from src.database.connection import session  # noqa: E402
from src.etl.pipeline import load_demo_dataset  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True)
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--short-ttl", action="store_true")
    args = p.parse_args()
    if len(os.environ.get("CUSTOMERIQ_API_TOKEN", "")) < 32:
        sys.exit("CUSTOMERIQ_API_TOKEN must be set (playwright.config.ts does this); never reuse .customeriq_token")

    work = Path(args.root).resolve() / str(args.port)
    db, backups = work / "customeriq.db", work / "backups"
    real = {Path(DEFAULT_DB_PATH).resolve(), Path(BACKUP_DIR).resolve()}
    if db.resolve() in real or backups.resolve() in real or ROOT in work.parents:
        sys.exit("refusing to run: the e2e database must live outside the project")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    with session(db) as conn:
        load_demo_dataset(conn)

    if args.short_ttl:
        security.LOGIN_CODE_TTL_S = 2
        security.SESSION_TTL_S = 4

    app = api_app.create_app(db_path=db, backup_dir=backups, port=args.port,
                             dev_origins=api_app.dev_origins_for(args.port + 1), web_dist=api_app.WEB_DIST)
    print(f"e2e server on http://127.0.0.1:{args.port} (db {db})", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()

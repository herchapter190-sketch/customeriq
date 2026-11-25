"""Public read-only demo server: CUSTOMERIQ_MODE=demo python -m src.api.demo

Separate from the local launcher (python -m src.api), which is unchanged and loopback only.
Binds 0.0.0.0:$PORT as hosting platforms such as Render expect. Configuration is environment only:

  CUSTOMERIQ_MODE             must be "demo" (explicit opt-in)
  CUSTOMERIQ_DEMO_DB          packaged demo database built by scripts/build_demo_db.py (never the local
                              data/customeriq.db); it is verified, then copied to a temp dir and the copy is served
  CUSTOMERIQ_ALLOWED_HOSTS    comma-separated public host names, e.g. customeriq-demo.onrender.com
                              (RENDER_EXTERNAL_HOSTNAME, set by Render, is added automatically)
  CUSTOMERIQ_ALLOWED_ORIGINS  optional comma-separated origins; default https://<each allowed host>
  PORT                        listen port (default 10000)
  CUSTOMERIQ_RATE_LIMIT       optional requests per minute per client IP (default 600: behind a CDN, one
                              bucket can be shared by every visitor on the same edge)
  CUSTOMERIQ_MAX_CONCURRENT   optional concurrent expensive requests (default 2)
  CUSTOMERIQ_FORWARDED_ALLOW_IPS  optional comma-separated proxy IPs/CIDRs (Render: 10.0.0.0/8) whose
                              X-Forwarded-For is trusted for the client IP; "*" and /0 are refused. Unset means
                              no proxy is trusted (every request then shares the proxy's IP)
"""
from __future__ import annotations

import ipaddress
import logging
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

import uvicorn

from .app import WEB_DIST, _demo_db, create_app

log = logging.getLogger("customeriq.demo")


def _list(name: str) -> tuple[str, ...]:
    return tuple(v.strip() for v in os.environ.get(name, "").split(",") if v.strip())


def _int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name, "").strip()
    value = int(raw) if raw else default
    if not lo <= value <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi}")
    return value


def verify_demo_db(path: str | Path) -> int:
    """Check a packaged demo database without changing it: integrity, synthetic data, rows, no WAL.
    Returns the transaction count; raises ValueError otherwise."""
    path = Path(path)
    # immutable=1: no locks, no journal or -wal/-shm files, nothing written to the file.
    with sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro&immutable=1", uri=True) as conn:
        try:
            ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            rows = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            synthetic = conn.execute("SELECT value FROM dataset_meta WHERE key = 'is_synthetic'").fetchone()
        except sqlite3.DatabaseError as exc:
            raise ValueError(f"Demo database is not a CustomerIQ database: {exc}") from None
    conn.close()
    with path.open("rb") as f:
        wal = f.read(20)[18:20] != b"\x01\x01"  # header write/read versions: 1 = rollback journal, 2 = WAL
    if not ok:
        raise ValueError("Demo database failed its integrity check")
    if wal:
        raise ValueError("Demo database must not be in WAL mode (rebuild it with scripts/build_demo_db.py)")
    if synthetic is None or synthetic[0] != "true" or rows <= 0:
        raise ValueError("Demo database must hold the synthetic demo dataset")
    return rows


def working_copy(packaged: str | Path) -> Path:
    """Verify the packaged database, then copy it into a fresh writable temp dir. The server opens
    the copy (SQLite writes WAL/schema there), so the packaged file is never modified."""
    src = _demo_db(packaged)  # refuses the local database and backups before anything is read
    verify_demo_db(src)
    # shortcut: the temp dir is left behind on exit; fine on an ephemeral host, add cleanup if run long-lived locally.
    dst = Path(tempfile.mkdtemp(prefix="customeriq-demo-")) / "customeriq-demo.db"
    shutil.copyfile(src, dst)
    log.info("Serving a working copy of %s at %s", src.name, dst)
    return dst


def proxy_trust() -> str:
    """Validated CUSTOMERIQ_FORWARDED_ALLOW_IPS for uvicorn. A wildcard would let any client forge
    X-Forwarded-For and pick its own rate-limit bucket, so only explicit IPs/CIDRs are accepted."""
    entries = _list("CUSTOMERIQ_FORWARDED_ALLOW_IPS")
    for entry in entries:
        try:
            net = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            raise ValueError(f"CUSTOMERIQ_FORWARDED_ALLOW_IPS: {entry!r} is not an IP address or CIDR") from None
        if net.prefixlen == 0:
            raise ValueError("CUSTOMERIQ_FORWARDED_ALLOW_IPS must not trust every address")
    return ",".join(entries)


def build_app():
    """Build the demo app from the environment; raises ValueError on any missing or unsafe setting."""
    if os.environ.get("CUSTOMERIQ_MODE", "").strip().lower() != "demo":
        raise ValueError("Set CUSTOMERIQ_MODE=demo to run the public demo server")
    db = os.environ.get("CUSTOMERIQ_DEMO_DB", "").strip()
    # Render sets RENDER_EXTERNAL_HOSTNAME to the service's own assigned host (it may carry a random suffix).
    hosts = tuple(dict.fromkeys(_list("CUSTOMERIQ_ALLOWED_HOSTS") + _list("RENDER_EXTERNAL_HOSTNAME")))
    if not db or not hosts:
        raise ValueError("CUSTOMERIQ_DEMO_DB and CUSTOMERIQ_ALLOWED_HOSTS are required in demo mode")
    origins = _list("CUSTOMERIQ_ALLOWED_ORIGINS") or tuple(f"https://{h}" for h in hosts)
    return create_app(working_copy(db), mode="demo", allowed_hosts=hosts, allowed_origins=origins,
                      web_dist=WEB_DIST, rate_per_minute=_int("CUSTOMERIQ_RATE_LIMIT", 600, 1, 10_000),
                      max_expensive=_int("CUSTOMERIQ_MAX_CONCURRENT", 2, 1, 32))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        port = _int("PORT", 10000, 1, 65535)
        proxies = proxy_trust()
        app = build_app()
    except ValueError as exc:
        sys.exit(f"CustomerIQ demo: {exc}")
    uvicorn.run(app, host="0.0.0.0", port=port, server_header=False, proxy_headers=bool(proxies),
                forwarded_allow_ips=proxies or "", log_level="info", access_log=False)


if __name__ == "__main__":
    main()

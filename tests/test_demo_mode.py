"""Public demo mode: reads without login, no write routes, limits, and local mode unchanged.

Every test uses a temporary database; the real database and backups are never opened.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from src.api import demo as demo_launcher
from src.api.app import create_app
from src.api.security import DemoLimitMiddleware
from src.config import DATA_DIR, DEFAULT_DB_PATH
from src.database.backup import BACKUP_DIR
from src.database.connection import session
from src.etl.pipeline import import_dataframe
from src.sql.runner import list_queries
from tests.conftest import KNOWN_MAPPING, known_frame

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_demo_db  # noqa: E402

HOST = "demo.example.com"
ORIGIN = f"https://{HOST}"
BROWSER = {"Origin": ORIGIN, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors"}
PERIOD = {"start_date": "2024-01-01", "end_date": "2024-03-31"}
WRITES = [("post", "/api/import/preview"), ("post", "/api/import/commit"), ("post", "/api/dataset/demo"),
          ("post", "/api/dataset/clear"), ("get", "/api/session/start?code=x"), ("post", "/api/session/logout"),
          ("post", "/api/session/login-code")]


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "demo_test.db"
    assert path.resolve() != DEFAULT_DB_PATH.resolve()
    with session(path) as conn:
        import_dataframe(conn, known_frame(), KNOWN_MAPPING, source_name="known test data")
    return path


@pytest.fixture(scope="module")
def packaged(tmp_path_factory):
    """A packaged demo database built exactly as at deploy time (small, for speed)."""
    out = tmp_path_factory.mktemp("pkg") / "customeriq-demo.db"
    build_demo_db.build(out, n_customers=200)
    return out


def _sha(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _demo_env(monkeypatch, db) -> None:
    monkeypatch.setenv("CUSTOMERIQ_MODE", "demo")
    monkeypatch.setenv("CUSTOMERIQ_DEMO_DB", str(db))
    monkeypatch.setenv("CUSTOMERIQ_ALLOWED_HOSTS", HOST)
    monkeypatch.delenv("CUSTOMERIQ_ALLOWED_ORIGINS", raising=False)


def _demo(db_path, **kw) -> TestClient:
    app = create_app(db_path, mode="demo", allowed_hosts=(HOST,), allowed_origins=(ORIGIN,), **kw)
    return TestClient(app, base_url=ORIGIN)


def _counts(path) -> dict:
    with sqlite3.connect(path) as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("transactions", "rejected_rows", "dataset_meta")}


def test_demo_reads_work_without_login(db_path):
    with _demo(db_path) as c:
        assert c.get("/api/session").json() == {"authenticated": True, "mode": "demo"}
        for path in ("/api/meta", "/api/dataset", "/api/sql", "/api/dataset/rejected"):
            assert c.get(path, headers=BROWSER).status_code == 200, path
        kpis = c.post("/api/analytics/kpis", json={"filters": PERIOD}, headers=BROWSER)
        assert kpis.status_code == 200 and kpis.json()
        batch = c.post("/api/analytics/batch", json={"names": ["kpis", "segment_summary"]}, headers=BROWSER)
        assert set(batch.json()) == {"kpis", "segment_summary"}
        query = next(n for n in list_queries() if n != "rfm_scores")
        assert c.post(f"/api/sql/{query}", json={"filters": PERIOD, "customer_id": "C001"},
                      headers=BROWSER).status_code == 200
        assert c.post("/api/reports/csv/segment_summary", json={}, headers=BROWSER).status_code == 200
        # Scripts without browser headers work too (no token needed, nothing to protect).
        assert c.post("/api/analytics/kpis", json={}).status_code == 200


def test_demo_write_routes_are_not_registered(db_path):
    before = _counts(db_path)
    with _demo(db_path) as c:
        for method, path in WRITES:
            r = getattr(c, method)(path, headers=BROWSER, **({"json": {"confirm": True}} if method == "post" else {}))
            assert r.status_code == 404, path
    assert _counts(db_path) == before


def test_demo_keeps_security_headers_hosts_origins_and_limits(db_path):
    with _demo(db_path) as c:
        r = c.get("/api/meta")
        assert r.headers["x-frame-options"] == "DENY" and "server" not in r.headers
        assert c.get("/api/meta", headers={"Host": "evil.example"}).status_code == 400
        assert c.post("/api/analytics/kpis", json={}, headers=BROWSER | {"Origin": "https://evil.example"}
                      ).status_code == 403
        assert c.post("/api/analytics/kpis", json={}, headers=BROWSER | {"Sec-Fetch-Site": "cross-site"}
                      ).status_code == 403
        big = {"names": ["kpis"], "filters": {"segments": ["x" * 1000] * 2000}}
        assert c.post("/api/analytics/batch", json=big).status_code == 413
        assert c.post("/api/sql/drop_everything", json={}).status_code == 404  # fixed query files only


def test_demo_rate_limit_per_ip(db_path):
    with _demo(db_path, rate_per_minute=3) as c:
        assert [c.get("/api/meta").status_code for _ in range(3)] == [200] * 3
        r = c.get("/api/meta")
        assert r.status_code == 429 and r.headers["retry-after"] == "60"
        assert r.headers["x-content-type-options"] == "nosniff"  # limiter replies keep the security headers
        assert c.get("/api/health").status_code == 200  # health checks are never limited


def test_demo_caps_concurrent_expensive_requests():
    release = asyncio.Event()

    async def slow_app(scope, receive, send):
        await release.wait()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    async def call(mw, ip):
        sent = []

        async def send(m):
            sent.append(m)
        scope = {"type": "http", "method": "POST", "path": "/api/analytics/kpis", "client": (ip, 1)}
        await mw(scope, None, send)
        return sent[0]["status"]

    async def scenario():
        mw = DemoLimitMiddleware(slow_app, max_expensive=1, per_ip_expensive=2, queue_wait_s=0.05)
        first = asyncio.create_task(call(mw, "1.1.1.1"))
        await asyncio.sleep(0)
        queued_out = await call(mw, "2.2.2.2")      # global slot busy, wait times out
        second = asyncio.create_task(call(mw, "1.1.1.1"))
        await asyncio.sleep(0)
        per_ip = await call(mw, "1.1.1.1")          # third in flight from one IP
        release.set()
        return queued_out, per_ip, await first, await second, mw.inflight

    queued_out, per_ip, first, second, inflight = asyncio.run(scenario())
    assert (queued_out, per_ip, first, second, inflight) == (503, 429, 200, 200, {})


@pytest.mark.parametrize("bad", [None, DATA_DIR / "customeriq.db", DEFAULT_DB_PATH, BACKUP_DIR / "x.db"])
def test_demo_refuses_local_database_and_backups(bad):
    with pytest.raises(ValueError):
        create_app(bad, mode="demo", allowed_hosts=(HOST,))


def test_demo_refuses_missing_db_and_wildcard_hosts(tmp_path, db_path):
    with pytest.raises(ValueError, match="not found"):
        create_app(tmp_path / "missing.db", mode="demo", allowed_hosts=(HOST,))
    assert not (tmp_path / "missing.db").exists()
    with pytest.raises(ValueError):
        create_app(db_path, mode="demo", allowed_hosts=("*",))
    with pytest.raises(ValueError):
        create_app(db_path, mode="public")


def test_demo_launcher_requires_explicit_env(monkeypatch, packaged):
    for name in ("CUSTOMERIQ_MODE", "CUSTOMERIQ_DEMO_DB", "CUSTOMERIQ_ALLOWED_HOSTS", "CUSTOMERIQ_ALLOWED_ORIGINS"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError, match="CUSTOMERIQ_MODE"):
        demo_launcher.build_app()
    monkeypatch.setenv("CUSTOMERIQ_MODE", "demo")
    with pytest.raises(ValueError, match="required"):
        demo_launcher.build_app()
    monkeypatch.setenv("CUSTOMERIQ_DEMO_DB", str(packaged))
    monkeypatch.setenv("CUSTOMERIQ_ALLOWED_HOSTS", f"{HOST}, other.example.com")
    app = demo_launcher.build_app()
    assert app.state.mode == "demo"
    assert app.state.allowed_origins == {ORIGIN, "https://other.example.com"}


def test_local_mode_unchanged(db_path, tmp_path, monkeypatch):
    app = create_app(db_path, "t" * 48, backup_dir=tmp_path / "b")
    assert app.state.mode == "local"
    with TestClient(app, base_url="http://127.0.0.1") as c:
        assert c.get("/api/dataset").status_code == 401
        assert c.get("/api/session").status_code == 401
        assert c.post("/api/dataset/clear", json={"confirm": True}).status_code == 401  # registered, protected
        assert c.get("/api/meta", headers={"Host": "demo.example.com"}).status_code == 400
        ok = c.post("/api/dataset/clear", json={"confirm": True}, headers={"Authorization": f"Bearer {'t' * 48}"})
        assert json.loads(ok.text)["cleared"] is True
    # The local launcher refuses to start in demo mode rather than silently mixing the two.
    from src.api import __main__ as local_launcher
    monkeypatch.setenv("CUSTOMERIQ_MODE", "demo")
    monkeypatch.setattr("sys.argv", ["src.api"])
    with pytest.raises(SystemExit):
        local_launcher.main()


# --------------------------------------------------------------------------- Phase 2: packaged demo database
def test_build_demo_db_output(packaged):
    with sqlite3.connect(f"file:{packaged.as_posix()}?mode=ro&immutable=1", uri=True) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        rows = conn.execute("SELECT COUNT(*), COUNT(DISTINCT customer_id) FROM transactions").fetchone()
        meta = dict(conn.execute("SELECT key, value FROM dataset_meta").fetchall())
    conn.close()
    assert rows[0] > 1000 and rows[1] > 100
    assert json.loads(meta["is_synthetic"]) is True and "synthetic" in json.loads(meta["source_name"]).lower()
    assert packaged.read_bytes()[18:20] == b"\x01\x01"  # rollback journal, not WAL
    assert sorted(p.name for p in packaged.parent.iterdir()) == [packaged.name]  # no -wal/-shm/-journal
    assert demo_launcher.verify_demo_db(packaged) == rows[0]


@pytest.mark.parametrize("bad", [DATA_DIR / "customeriq.db", DATA_DIR / "demo.db", DEFAULT_DB_PATH,
                                 BACKUP_DIR / "demo.db", BACKUP_DIR])
def test_build_demo_db_refuses_local_paths(bad):
    with pytest.raises(ValueError, match="data/ or backups/"):
        build_demo_db.build(bad)


def test_build_demo_db_refuses_existing_output(packaged):
    before = _sha(packaged)
    with pytest.raises(ValueError, match="already exists"):
        build_demo_db.build(packaged)
    assert _sha(packaged) == before


def test_verify_refuses_wal_and_non_synthetic(db_path, tmp_path):
    with pytest.raises(ValueError, match="WAL"):
        demo_launcher.verify_demo_db(db_path)  # the test fixture is WAL and user-supplied data
    plain = tmp_path / "plain.db"
    src, dst = sqlite3.connect(db_path), sqlite3.connect(plain)
    src.backup(dst)
    dst.execute("PRAGMA journal_mode = DELETE")
    src.close()
    dst.close()
    with pytest.raises(ValueError, match="synthetic"):
        demo_launcher.verify_demo_db(plain)


def test_startup_serves_a_temp_copy_and_never_changes_the_package(monkeypatch, packaged):
    before = _sha(packaged)
    _demo_env(monkeypatch, packaged)
    app = demo_launcher.build_app()
    served = Path(app.state.db_path)
    assert served != packaged.resolve() and served.parent != packaged.parent and served.is_file()
    with TestClient(app, base_url=ORIGIN) as c:
        assert c.get("/api/session").json() == {"authenticated": True, "mode": "demo"}
        assert c.get("/api/dataset").json()["meta"]["is_synthetic"] is True
        for name in ("kpis", "segment_summary", "monthly_revenue"):
            assert c.post(f"/api/analytics/{name}", json={}).status_code == 200, name
        assert c.post("/api/reports/csv/rfm_customers", json={}).status_code == 200
    assert _sha(packaged) == before
    assert sorted(p.name for p in packaged.parent.iterdir()) == [packaged.name]


def test_startup_refuses_local_db_before_copying(monkeypatch):
    monkeypatch.setattr("tempfile.mkdtemp", lambda **kw: pytest.fail("copied before refusing"))
    for bad in (DEFAULT_DB_PATH, BACKUP_DIR / "x.db"):
        _demo_env(monkeypatch, bad)
        with pytest.raises(ValueError, match="refuses"):
            demo_launcher.build_app()


# --------------------------------------------------------------------------- Phase 2: proxy trust
@pytest.mark.parametrize("bad", ["*", "10.0.0.0/8,*", "0.0.0.0/0", "::/0", "render", "10.0.0.0/33"])
def test_proxy_trust_refuses_wildcards_and_junk(monkeypatch, bad):
    monkeypatch.setenv("CUSTOMERIQ_FORWARDED_ALLOW_IPS", bad)
    with pytest.raises(ValueError, match="CUSTOMERIQ_FORWARDED_ALLOW_IPS"):
        demo_launcher.proxy_trust()


def test_launcher_passes_validated_proxy_trust_to_uvicorn(monkeypatch, packaged):
    _demo_env(monkeypatch, packaged)
    seen = {}
    monkeypatch.setattr(demo_launcher.uvicorn, "run", lambda app, **kw: seen.update(kw))
    monkeypatch.setenv("CUSTOMERIQ_FORWARDED_ALLOW_IPS", "*")
    with pytest.raises(SystemExit):
        demo_launcher.main()
    assert not seen
    monkeypatch.setenv("CUSTOMERIQ_FORWARDED_ALLOW_IPS", " 10.0.0.0/8 ")
    demo_launcher.main()
    assert (seen["proxy_headers"], seen["forwarded_allow_ips"]) == (True, "10.0.0.0/8")
    monkeypatch.delenv("CUSTOMERIQ_FORWARDED_ALLOW_IPS")
    demo_launcher.main()
    assert seen["proxy_headers"] is False


def test_forged_forwarded_for_cannot_pick_a_rate_limit_bucket(monkeypatch):
    """uvicorn with the Render trust list: the client IP is the right-most untrusted XFF entry,
    so anything a visitor prepends is ignored, and an untrusted peer's XFF is ignored entirely."""
    monkeypatch.setenv("CUSTOMERIQ_FORWARDED_ALLOW_IPS", "10.0.0.0/8")
    seen = []

    async def ok(scope, receive, send):
        seen.append(scope["client"][0])
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    stack = ProxyHeadersMiddleware(DemoLimitMiddleware(ok, per_minute=1), trusted_hosts=demo_launcher.proxy_trust())

    async def call(peer, xff):
        sent = []

        async def send(m):
            sent.append(m)
        scope = {"type": "http", "method": "GET", "path": "/api/meta", "scheme": "http",
                 "client": (peer, 1), "headers": [(b"x-forwarded-for", xff.encode())]}
        await stack(scope, None, send)
        return sent[0]["status"]

    async def scenario():
        return [await call("10.20.30.40", "203.0.113.7"),               # real visitor via Render's proxy
                await call("10.20.30.40", "6.6.6.6, 203.0.113.7"),      # same visitor, forged prefix
                await call("10.20.30.40", "1.2.3.4, 9.9.9.9, 203.0.113.7"),
                await call("10.20.30.40", "198.51.100.9"),              # a different visitor
                await call("198.51.100.1", "203.0.113.99"),             # untrusted peer: XFF ignored
                await call("198.51.100.1", "203.0.113.100")]

    assert asyncio.run(scenario()) == [200, 429, 429, 200, 200, 429]
    assert seen == ["203.0.113.7", "198.51.100.9", "198.51.100.1"]

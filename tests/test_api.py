"""Local API: security, validation, analytics parity and safe imports.

Every test runs against a temporary database file; the real database is never opened.
"""
from __future__ import annotations

import io
import json
import sqlite3

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from src.analytics.context import AnalysisFilters, prepare_context
from src.api.app import create_app, to_jsonable
from src.config import DEFAULT_DB_PATH
from src.database.connection import session
from src.etl.pipeline import import_dataframe
from src.services import registry
from src.sql.runner import list_queries
from tests.conftest import KNOWN_MAPPING, KNOWN_ROWS, known_frame

TOKEN = "t" * 48
AUTH = {"Authorization": f"Bearer {TOKEN}"}
BASE = "http://127.0.0.1"
PERIOD = {"start_date": "2024-01-01", "end_date": "2024-03-31"}


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "api_test.db"
    assert path.resolve() != DEFAULT_DB_PATH.resolve()
    with session(path) as conn:
        import_dataframe(conn, known_frame(), KNOWN_MAPPING, source_name="known test data")
    return path


@pytest.fixture
def client(db_path, tmp_path):
    app = create_app(db_path, TOKEN, backup_dir=tmp_path / "backups", max_upload_bytes=200_000)
    with TestClient(app, base_url=BASE) as c:
        yield c


def _counts(path) -> dict:
    with sqlite3.connect(path) as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("transactions", "rejected_rows", "dataset_meta")}


def _csv(rows=KNOWN_ROWS) -> bytes:
    buf = io.StringIO()
    buf.write("Invoice,Customer,Date,SKU,Name,Category,Qty,Price,Country\n")
    for r in rows:
        buf.write(",".join(str(v) for v in r) + "\n")
    return buf.getvalue().encode()


# --------------------------------------------------------------------------- security
def test_health_is_public_and_reveals_nothing(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "api_version": "1"}


@pytest.mark.parametrize("method,path", [("get", "/api/dataset"), ("get", "/api/meta"), ("get", "/api/sql"),
                                         ("get", "/api/dataset/rejected"), ("post", "/api/analytics/kpis"),
                                         ("post", "/api/dataset/clear"), ("post", "/api/import/commit")])
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN},
                                     {"Authorization": f"Basic {TOKEN}"}])
def test_protected_routes_require_token(client, method, path, headers):
    r = getattr(client, method)(path, headers=headers)
    assert r.status_code == 401
    assert "customer" not in r.text.lower()


def test_untrusted_host_rejected(client):
    r = client.get("/api/health", headers={"Host": "evil.example"})
    assert r.status_code == 400


@pytest.mark.parametrize("origin", ["http://127.0.0.1:5173", "https://evil.example", "null"])
def test_no_cors_for_any_origin(client, origin):
    pre = client.options("/api/dataset", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                                                  "Access-Control-Request-Headers": "authorization"})
    assert "access-control-allow-origin" not in pre.headers
    get = client.get("/api/health", headers={"Origin": origin})
    assert "access-control-allow-origin" not in get.headers


# --------------------------------------------------------------------------- browser sessions & CSRF
APP_ORIGIN = "http://127.0.0.1:8520"
BROWSER = {"Origin": APP_ORIGIN, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors"}


def _login(client) -> str:
    code = client.app.state.sessions.mint_login_code()
    r = client.get(f"/api/session/start?code={code}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    info = client.get("/api/session", headers=BROWSER).json()
    assert info["authenticated"] is True
    return info["csrf_token"]


def test_login_code_is_single_use_and_invalid_codes_fail(client):
    code = client.app.state.sessions.mint_login_code()
    assert client.get(f"/api/session/start?code={code}", follow_redirects=False).status_code == 303
    client.cookies.clear()
    assert client.get(f"/api/session/start?code={code}", follow_redirects=False).status_code == 401
    assert client.get("/api/session/start?code=guess", follow_redirects=False).status_code == 401
    assert client.get("/api/session").status_code == 401


def test_session_cookie_reads_and_csrf_protected_writes(client, db_path):
    csrf = _login(client)
    assert client.get("/api/dataset", headers=BROWSER).status_code == 200
    body = {"filters": PERIOD}
    ok = client.post("/api/analytics/kpis", json=body, headers=BROWSER | {"X-CSRF-Token": csrf})
    assert ok.status_code == 200
    # each missing / wrong protection is refused
    assert client.post("/api/analytics/kpis", json=body, headers=BROWSER).status_code == 403
    assert client.post("/api/analytics/kpis", json=body,
                       headers=BROWSER | {"X-CSRF-Token": "x" * 43}).status_code == 403
    assert client.post("/api/analytics/kpis", json=body, headers=BROWSER | {
        "X-CSRF-Token": csrf, "Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/analytics/kpis", json=body, headers=BROWSER | {
        "X-CSRF-Token": csrf, "Sec-Fetch-Site": "cross-site"}).status_code == 403
    no_origin = {"X-CSRF-Token": csrf, "Sec-Fetch-Site": "same-origin"}
    assert client.post("/api/analytics/kpis", json=body, headers=no_origin).status_code == 403
    # a forged destructive request changes nothing
    r = client.post("/api/dataset/clear", json={"confirm": True}, headers=BROWSER | {"Origin": "http://127.0.0.1:9999",
                                                                                     "X-CSRF-Token": csrf})
    assert r.status_code == 403 and _counts(db_path)["transactions"] == 9


def test_dev_proxy_origin_allowed(client):
    csrf = _login(client)
    r = client.post("/api/analytics/kpis", json={}, headers=BROWSER | {
        "Origin": "http://127.0.0.1:5173", "X-CSRF-Token": csrf})
    assert r.status_code == 200


def test_logout_revokes_session(client):
    csrf = _login(client)
    assert client.post("/api/session/logout", headers=BROWSER | {"X-CSRF-Token": csrf}).status_code == 200
    assert client.get("/api/dataset", headers=BROWSER).status_code == 401


def test_bearer_token_refused_from_browsers(client):
    r = client.get("/api/dataset", headers=AUTH | {"Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 401
    assert client.post("/api/session/login-code", headers=AUTH | {"Sec-Fetch-Mode": "cors"}).status_code == 401
    assert client.post("/api/session/login-code").status_code == 401
    assert "code" in client.post("/api/session/login-code", headers=AUTH).json()


def test_no_secrets_paths_or_internals_in_responses(client, db_path, tmp_path):
    csrf = _login(client)
    hdr = BROWSER | {"X-CSRF-Token": csrf}
    texts = [client.get(p, headers=BROWSER).text for p in ("/api/dataset", "/api/meta", "/api/sql",
                                                            "/api/dataset/rejected", "/api/session")]
    texts.append(client.post("/api/dataset/demo", json={"n_customers": 200, "confirm": True}, headers=hdr).text)
    texts.append(client.post("/api/import/preview", files={"file": ("x.xlsx", b"PK broken", "application/zip")},
                             headers=hdr).text)
    blob = "\n".join(texts)
    for secret in (TOKEN, str(db_path), str(tmp_path), "customeriq.db", ".py", "Traceback", "SELECT ", "zipfile"):
        assert secret not in blob, secret
    assert "csrf_token" in texts[4]  # the CSRF token is the only per-session value returned


def test_json_bodies_capped_at_1mb(client):
    big = {"names": ["kpis"], "currency": "", "filters": {}, "pad": "x" * 1_100_000}
    assert client.post("/api/analytics/batch", json=big, headers=AUTH).status_code == 413


def test_security_headers_and_no_docs(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-frame-options"] == "DENY"
    assert "server" not in r.headers
    for path in ("/docs", "/api/docs", "/openapi.json", "/api/openapi.json", "/redoc"):
        assert client.get(path, headers=AUTH).status_code == 404


def test_built_frontend_served_same_origin(db_path, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    app = create_app(db_path, TOKEN, backup_dir=tmp_path / "backups", web_dist=dist)
    with TestClient(app, base_url=BASE) as c:
        for path in ("/", "/segments", "/reports/x"):  # client-side routes get the page
            r = c.get(path)
            assert r.status_code == 200 and "id=root" in r.text, path
            assert "script-src 'self'" in r.headers["content-security-policy"]
            assert r.headers["x-frame-options"] == "DENY"
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert "default-src 'none'" in c.get("/api/health").headers["content-security-policy"]
        # API stays protected and API misses stay JSON 404s, never the page
        assert c.get("/api/dataset").status_code == 401
        for path in ("/api/nope", "/api", "/openapi.json", "/assets/missing.js", "/assets/../../secret.txt",
                     "/assets/%2e%2e/%2e%2e/secret.txt", "/favicon.ico"):
            r = c.get(path)
            assert r.status_code == 404 and "nope" not in r.text and "id=root" not in r.text, path
        assert c.get("/", headers={"Host": "evil.example"}).status_code == 400
    # without a build the API runs alone
    bare = create_app(db_path, TOKEN, backup_dir=tmp_path / "backups", web_dist=tmp_path / "missing")
    with TestClient(bare, base_url=BASE) as c:
        assert c.get("/").status_code == 404 and c.get("/api/health").status_code == 200


def test_unexpected_errors_are_generic(client, monkeypatch):
    def boom(conn, ctx):
        raise RuntimeError(r"secret detail C:\Users\someone\data.db")
    monkeypatch.setitem(registry.FUNCTIONS, "kpis", boom)
    with TestClient(client.app, base_url=BASE, raise_server_exceptions=False) as c:
        r = c.post("/api/analytics/kpis", json={"filters": PERIOD}, headers=AUTH)
    assert r.status_code == 500 and r.json() == {"detail": "Internal server error"}
    assert "secret" not in r.text


def test_validation_errors_do_not_echo_input(client):
    r = client.post("/api/analytics/kpis", json={"filters": {"start_date": "<script>x</script>"}}, headers=AUTH)
    assert r.status_code == 422 and "<script>" not in r.text


# --------------------------------------------------------------------------- validation
@pytest.mark.parametrize("body", [
    {"filters": {"start_date": "2024-13-01"}},
    {"filters": {"start_date": "2024-03-01", "end_date": "2024-01-01"}},
    {"filters": {"segments": ["Nope"]}},
    {"filters": {"risk": {"active_days": 200, "cooling_days": 100, "at_risk_days": 300}}},
    {"filters": {"rfm": {"recency_thresholds": [90, 30, 180, 365]}}},
    {"filters": {"rfm": {"method": "magic"}}},
    {"unexpected": 1},
    {"limit": 5},              # kpis takes no limit
    {"currency": "x" * 20},
])
def test_invalid_requests_rejected(client, body):
    assert client.post("/api/analytics/kpis", json=body, headers=AUTH).status_code == 422


def test_unknown_analysis_and_required_kwargs(client):
    assert client.post("/api/analytics/nope", json={}, headers=AUTH).status_code == 404
    assert client.post("/api/analytics/customer_orders", json={}, headers=AUTH).status_code == 422
    r = client.post("/api/analytics/customer_orders", json={"filters": PERIOD, "customer_id": "A"}, headers=AUTH)
    assert r.status_code == 200 and len(r.json()["data"]) >= 3


# --------------------------------------------------------------------------- analytics parity
def test_kpis_match_hand_calculated_values(client):
    k = client.post("/api/analytics/kpis", json={"filters": PERIOD}, headers=AUTH).json()
    assert k["net_revenue"] == pytest.approx(465.0)
    assert k["active_customers"] == 4 and k["repeat_customers"] == 2


@pytest.mark.parametrize("name", sorted(n for n in registry.FUNCTIONS if n not in registry.REQUIRED_KWARGS))
def test_every_analysis_matches_direct_registry_call(client, db_path, name):
    api = client.post(f"/api/analytics/{name}", json={"filters": PERIOD}, headers=AUTH)
    assert api.status_code == 200, api.text
    with session(db_path) as conn:
        direct = registry.FUNCTIONS[name](conn, prepare_context(conn, AnalysisFilters(**PERIOD)))
    assert api.json() == json.loads(json.dumps(to_jsonable(direct)))


def test_defaults_to_full_dataset_period_and_batch(client):
    single = client.post("/api/analytics/kpis", json={}, headers=AUTH).json()
    batch = client.post("/api/analytics/batch", json={"names": ["kpis", "segment_summary", "insights"]},
                        headers=AUTH)
    assert batch.status_code == 200
    assert batch.json()["kpis"] == single
    assert client.post("/api/analytics/batch", json={"names": ["kpis", "nope"]}, headers=AUTH).status_code == 404


def test_dataset_meta_and_rejected(client):
    d = client.get("/api/dataset", headers=AUTH).json()
    assert d["has_data"] is True and d["bounds"] == ["2024-01-05", "2024-03-28"]
    assert client.get("/api/meta", headers=AUTH).json()["segments"][0] == "Champions"
    assert client.get("/api/dataset/rejected", headers=AUTH).status_code == 200


# --------------------------------------------------------------------------- sql library
def test_sql_library_named_queries_only(client):
    queries = client.get("/api/sql", headers=AUTH).json()["queries"]
    assert "kpi_summary" in [q["name"] for q in queries]
    assert all(set(q) == {"name"} for q in queries)  # SQL text stays server-side by default
    r = client.post("/api/sql/kpi_summary", json={"filters": PERIOD}, headers=AUTH)
    assert r.status_code == 200 and r.json()["rows"] == 1
    for bad in ("nope", "..%2F..%2Fschema", "kpi_summary.sql"):
        assert client.post(f"/api/sql/{bad}", json={}, headers=AUTH).status_code == 404
    assert client.post("/api/sql/customer_orders", json={}, headers=AUTH).status_code == 422
    assert client.post("/api/sql/kpi_summary", json={"sql": "DELETE FROM transactions"},
                       headers=AUTH).status_code == 422


@pytest.mark.parametrize("name", list_queries())
def test_every_library_query_runs_through_the_api(client, name):
    # Same parameters as the SQL Library page; rfm_scores is a template and must be built, not run raw.
    body = {"filters": {**PERIOD, "segments": ["Champions"]}, "customer_id": "A"}
    r = client.post(f"/api/sql/{name}", json=body, headers=AUTH)
    assert r.status_code == 200, r.text
    if name == "rfm_scores":
        assert r.json()["rows"] == 4  # every known customer, whatever the segment filter


# --------------------------------------------------------------------------- reports
def test_reports(client):
    pdf = client.post("/api/reports/pdf", json={"filters": PERIOD}, headers=AUTH)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert "attachment" in pdf.headers["content-disposition"]
    xlsx = client.post("/api/reports/xlsx", json={"filters": PERIOD}, headers=AUTH)
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"
    csv = client.post("/api/reports/csv/segment_summary", json={"filters": PERIOD}, headers=AUTH)
    assert csv.status_code == 200 and csv.text.startswith("segment")
    assert client.post("/api/reports/csv/customer_orders", json={}, headers=AUTH).status_code == 404


# --------------------------------------------------------------------------- imports & writes
def _preview(client, data: bytes, name="sales.csv"):
    return client.post("/api/import/preview", files={"file": (name, data, "text/csv")}, headers=AUTH)


def test_import_preview_then_commit_with_verified_backup(client, db_path, tmp_path):
    rows = KNOWN_ROWS + [("1008", "E", "2024-03-30 10:00", "P1", "Mug", "Kitchen", 1, 10.0, "UK"),
                         ("1009", "", "2024-03-30 10:00", "P1", "Mug", "Kitchen", 1, 10.0, "UK")]
    p = _preview(client, _csv(rows))
    assert p.status_code == 200, p.text
    prev = p.json()
    assert prev["rows"] == 11 and prev["suggested_mapping"]["customer_id"] == "Customer"
    assert prev["sample"]["columns"] == prev["columns"] and len(prev["sample"]["data"]) == 5
    assert prev["validation"]["summary"]["clean_rows"] == 10
    assert _counts(db_path)["transactions"] == 9  # preview never writes

    body = {"upload_id": prev["upload_id"], "mapping": KNOWN_MAPPING}
    assert client.post("/api/import/commit", json=body, headers=AUTH).status_code == 422  # confirm required
    r = client.post("/api/import/commit", json=body | {"confirm": True}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert _counts(db_path)["transactions"] == 10
    assert r.json()["backup_created"] is True and "backup" not in r.json()
    (backup,) = (tmp_path / "backups").glob("auto-*.db")
    assert _counts(backup)["transactions"] == 9  # backup holds the previous dataset
    with sqlite3.connect(backup) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    # upload ids are single use
    assert client.post("/api/import/commit", json=body | {"confirm": True}, headers=AUTH).status_code == 404


def test_failed_import_keeps_current_dataset(client, db_path):
    bad = [(r[0], r[1], "not a date", *r[3:]) for r in KNOWN_ROWS]
    prev = _preview(client, _csv(bad)).json()
    before = _counts(db_path)
    r = client.post("/api/import/commit", json={"upload_id": prev["upload_id"], "mapping": KNOWN_MAPPING,
                                                "confirm": True}, headers=AUTH)
    assert r.status_code == 422 and r.json()["imported"] is False
    assert _counts(db_path) == before


def test_bad_mapping_rejected_before_any_write(client, db_path, tmp_path):
    prev = _preview(client, _csv()).json()
    mapping = KNOWN_MAPPING | {"customer_id": "Missing column"}
    r = client.post("/api/import/commit", json={"upload_id": prev["upload_id"], "mapping": mapping,
                                                "confirm": True}, headers=AUTH)
    assert r.status_code == 422
    assert not (tmp_path / "backups").exists()


@pytest.mark.parametrize("name,data", [("x.exe", b"MZ..."), ("x.csv", b""), ("x.xlsx", b"not a zip")])
def test_bad_uploads_rejected(client, name, data):
    assert _preview(client, data, name).status_code == 400


def test_oversized_upload_rejected(client, db_path):
    r = _preview(client, b"a,b\n" + b"1,2\n" * 100_000)
    assert r.status_code == 413
    assert _counts(db_path)["transactions"] == 9


def test_oversized_streamed_upload_rejected(client):
    """No Content-Length header: the limit is enforced while the body streams in."""
    head = b'--B\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\n'

    def body():
        yield head
        for _ in range(100):
            yield b"1,2\n" * 1000
        yield b"\r\n--B--\r\n"
    r = client.post("/api/import/preview", content=body(),
                    headers=AUTH | {"Content-Type": "multipart/form-data; boundary=B"})
    assert r.status_code == 413
    assert client.app.state.uploads == {}


def test_clear_and_demo_require_confirm_and_back_up(client, db_path, tmp_path):
    assert client.post("/api/dataset/clear", json={}, headers=AUTH).status_code == 422
    assert client.post("/api/dataset/clear", json={"confirm": False}, headers=AUTH).status_code == 422
    assert _counts(db_path)["transactions"] == 9
    r = client.post("/api/dataset/clear", json={"confirm": True}, headers=AUTH)
    assert r.status_code == 200 and _counts(db_path)["transactions"] == 0
    assert r.json()["backup_created"] is True
    (backup,) = (tmp_path / "backups").glob("auto-*.db")
    assert _counts(backup)["transactions"] == 9
    assert client.post("/api/analytics/kpis", json={}, headers=AUTH).status_code == 409
    d = client.post("/api/dataset/demo", json={"n_customers": 200, "confirm": True}, headers=AUTH)
    assert d.status_code == 200 and _counts(db_path)["transactions"] > 0
    assert client.get("/api/dataset", headers=AUTH).json()["meta"]["is_synthetic"] is True


def test_streamlit_registry_is_the_shared_one():
    from src.ui import data
    assert data.FUNCTIONS is registry.FUNCTIONS


def test_import_excel_sheet_choice_and_mixed_currency_blocked(client, db_path, tmp_path):
    buf = io.BytesIO()
    frame = pd.read_csv(io.BytesIO(_csv()), dtype=str)
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        frame.head(2).to_excel(xw, sheet_name="Old", index=False)
        frame.to_excel(xw, sheet_name="Sales", index=False)
    xlsx = buf.getvalue()
    ctype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    first = client.post("/api/import/preview", files={"file": ("b.xlsx", xlsx, ctype)}, headers=AUTH).json()
    assert first["sheets"] == ["Old", "Sales"] and first["sheet"] == "Old" and first["rows"] == 2
    chosen = client.post("/api/import/preview", files={"file": ("b.xlsx", xlsx, ctype)}, data={"sheet": "Sales"},
                         headers=AUTH).json()
    assert chosen["sheet"] == "Sales" and chosen["rows"] == len(frame)
    bad = client.post("/api/import/preview", files={"file": ("b.xlsx", xlsx, ctype)}, data={"sheet": "Nope"},
                      headers=AUTH)
    assert bad.status_code == 400 and "Sheet not found" in bad.json()["detail"]

    mixed = _csv().replace(b",10.0,", b",$10.0,", 1).replace(b",10.0,", ",\u20ac10.0,".encode(), 1)
    prev = _preview(client, mixed).json()
    assert prev["validation"]["error"].startswith("Mixed currencies")
    before = _counts(db_path)
    r = client.post("/api/import/commit", json={"upload_id": prev["upload_id"], "mapping": KNOWN_MAPPING,
                                                "confirm": True}, headers=AUTH)
    assert r.status_code == 422 and "Mixed currencies" in r.json()["detail"]
    assert _counts(db_path) == before and not (tmp_path / "backups").exists()


def test_import_bare_dollar_needs_a_chosen_currency(client, db_path):
    dollars = _csv([r[:7] + (f"${r[7]}",) + r[8:] for r in KNOWN_ROWS])
    prev = _preview(client, dollars).json()
    assert prev["currency_options"] == ["USD", "CAD", "AUD"] and "USD, CAD or AUD" in prev["validation"]["error"]
    body = {"upload_id": prev["upload_id"], "mapping": KNOWN_MAPPING, "confirm": True}
    before = _counts(db_path)
    r = client.post("/api/import/commit", json=body, headers=AUTH)
    assert r.status_code == 422 and "Prices use '$'" in r.json()["detail"] and _counts(db_path) == before
    assert client.post("/api/import/commit", json=body | {"currency": "XYZ"}, headers=AUTH).status_code == 422
    # Choosing re-validates the preview and keeps the options so the choice can be changed.
    chosen = client.post("/api/import/preview", files={"file": ("s.csv", dollars, "text/csv")},
                         data={"currency": "CAD"}, headers=AUTH).json()
    assert chosen["currency"] == "CAD" and chosen["currency_options"] and chosen["validation"]["summary"]
    ok = client.post("/api/import/commit", json=body | {"upload_id": chosen["upload_id"], "currency": "CAD"},
                     headers=AUTH)
    assert ok.status_code == 200 and ok.json()["summary"]["currency"] == "CAD"
    assert client.get("/api/dataset", headers=AUTH).json()["meta"]["currency"] == "CAD"

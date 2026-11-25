"""CustomerIQ local API (FastAPI).

Serves the same analytics as the Streamlit app from the same SQLite database, for a
separate frontend. Local-only by design: bound to 127.0.0.1 by the launcher, token
protected, and never contacts external services.
"""
from __future__ import annotations

import json
import logging
import secrets
import sqlite3
import threading
import time
from collections import OrderedDict
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from src.analytics.context import AnalysisFilters
from src.config import (DATA_DIR, DEFAULT_DB_PATH, PROJECT_ROOT, RISK_ORDER, SEGMENT_ORDER, CleaningOptions,
                        RFMConfig, RiskConfig)
from src.database.backup import BACKUP_DIR, BackupError, backup_database
from src.database.connection import data_version, date_bounds, session
from src.etl.loader import MAX_UPLOAD_MB, STANDARD_FIELDS, apply_mapping, read_table, suggest_mapping
from src.etl.cleaner import DOLLAR_CURRENCIES, AmbiguousCurrency, clean_transactions, detect_currency
from src.etl.pipeline import import_dataframe, load_demo_dataset
from src.etl.synthetic import generate_demo_transactions
from src.insights.engine import Insight
from src.reports.excel_export import build_excel_workbook
from src.reports.pdf_report import build_pdf_report
from src.reports.safe_export import csv_bytes
from src.segments.rfm import build_rfm_sql
from src.services import registry
from src.sql.runner import list_queries, load_sql, run_sql

from . import schemas as s
from .security import (SESSION_COOKIE, SESSION_TTL_S, BodyLimitMiddleware, DemoLimitMiddleware,
                        SecurityHeadersMiddleware, SessionStore, require_auth, require_bearer, require_demo_request,
                        resolve_token)

log = logging.getLogger("customeriq.api")

API_VERSION = "1"
DEFAULT_PORT = 8520
DEFAULT_WEB_PORT = 5173


def dev_origins_for(web_port: int) -> tuple[str, ...]:
    """Browser origins of the local Vite dev server (which proxies /api). Loopback hosts only."""
    return (f"http://127.0.0.1:{int(web_port)}", f"http://localhost:{int(web_port)}")


DEV_ORIGINS = dev_origins_for(DEFAULT_WEB_PORT)
ALLOWED_HOSTS = ("127.0.0.1", "localhost")
MODES = ("local", "demo")  # demo: public, read-only, no login (see src/api/demo.py)
CSV_EXPORTS = ("revenue_by_customer", "rfm_customers", "segment_summary", "monthly_revenue",
               "product_performance", "inactive_customers", "cohort_long", "monthly_acquisition")
SQL_ROW_CAP = 5000
UPLOAD_TTL_S = 1800
MAX_PENDING_UPLOADS = 3
WEB_DIST = PROJECT_ROOT / "web" / "dist"  # output of  npm run build  in web/
# The built page loads only its own files. 'unsafe-inline' styles cover React/three.js style attributes,
# blob: workers cover three.js text rendering, data: is the inline favicon. API responses keep default-src 'none'.
PAGE_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; "
            "form-action 'self'; frame-ancestors 'none'")


# --------------------------------------------------------------------------- serialisation
PREVIEW_ROWS = 5


def to_jsonable(obj: Any) -> Any:
    """Convert analytics results (DataFrames, numpy scalars, Insights ...) to plain JSON."""
    if isinstance(obj, pd.DataFrame):
        return json.loads(obj.to_json(orient="split", index=False, date_format="iso"))
    if isinstance(obj, pd.Series):
        return to_jsonable(obj.to_frame())
    if isinstance(obj, Insight):
        return to_jsonable(obj.to_dict())
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, (pd.Timestamp, date)):
        return obj.isoformat()
    if hasattr(obj, "item") and callable(obj.item):  # numpy scalar
        obj = obj.item()
    if isinstance(obj, float) and obj != obj or obj in (float("inf"), float("-inf")):
        return None
    return obj


def _json(payload: Any, status: int = 200) -> Response:
    return Response(json.dumps(payload, allow_nan=False, separators=(",", ":")), status_code=status,
                    media_type="application/json")


# --------------------------------------------------------------------------- app factory
def create_app(db_path: str | Path | None = None, token: str | None = None, *,
               backup_dir: str | Path | None = None, port: int = DEFAULT_PORT,
               dev_origins: tuple[str, ...] = DEV_ORIGINS, max_upload_bytes: int = MAX_UPLOAD_MB * 1024 * 1024,
               expose_sql_text: bool = False, web_dist: str | Path | None = None, mode: str = "local",
               allowed_hosts: tuple[str, ...] = ALLOWED_HOSTS, allowed_origins: tuple[str, ...] = (),
               rate_per_minute: int = 120, max_expensive: int = 2) -> FastAPI:
    """``mode="local"`` (default) is the token/session protected local app. ``mode="demo"`` is the
    public read-only demo: no login, no write routes, rate limited, and it only opens an explicit
    demo database (never the local one). ``allowed_origins`` and the limits apply to demo only."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    demo = mode == "demo"
    if demo and (not allowed_hosts or "*" in allowed_hosts):
        raise ValueError("Demo mode needs an explicit trusted host list")
    # No interactive docs, schema or debug routes in any build.
    app = FastAPI(title="CustomerIQ local API", version=API_VERSION, docs_url=None, redoc_url=None,
                  openapi_url=None, debug=False)
    app.state.mode = mode
    app.state.db_path = _demo_db(db_path) if demo else Path(db_path or DEFAULT_DB_PATH)
    app.state.backup_dir = backup_dir
    app.state.token = None if demo else token or resolve_token()  # demo has no bearer/session routes
    app.state.sessions = SessionStore()
    app.state.allowed_origins = (frozenset(allowed_origins) if demo else
                                 frozenset((f"http://127.0.0.1:{port}", f"http://localhost:{port}", *dev_origins)))
    app.state.expose_sql_text = expose_sql_text
    app.state.write_lock = threading.Lock()
    app.state.uploads = OrderedDict()   # upload_id -> (created, filename, raw DataFrame)
    app.state.cache = OrderedDict()     # key -> serialised JSON bytes
    app.state.cache_lock = threading.Lock()

    # Order matters: the last added runs first. No CORS middleware on purpose: the
    # frontend is same-origin (or proxied in dev), so browsers block all cross-origin reads.
    app.add_middleware(BodyLimitMiddleware, upload_bytes=max_upload_bytes + 64 * 1024,
                       upload_paths=() if demo else ("/api/import/preview",))
    if demo:
        app.add_middleware(DemoLimitMiddleware, per_minute=rate_per_minute, max_expensive=max_expensive)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))
    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        # Report where and what, never echo the submitted values back.
        errors = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "")} for e in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        log.exception("Unhandled API error")  # details stay in the local server log only
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "api_version": API_VERSION}

    if demo:
        _demo_session_routes(app)
        app.include_router(_router(writes=False), dependencies=[Depends(require_demo_request)])
    else:
        _session_routes(app)
        app.include_router(_router(), dependencies=[Depends(require_auth)])
    if web_dist is not None and (Path(web_dist) / "index.html").is_file():
        _frontend_routes(app, Path(web_dist))  # last, so every /api route above wins
    return app


def _demo_db(db_path: str | Path | None) -> Path:
    """The public demo opens only an explicit, existing demo database: never the local one or a backup."""
    if db_path is None:
        raise ValueError("Demo mode needs an explicit demo database path")
    path = Path(db_path).resolve()
    if path in {(DATA_DIR / "customeriq.db").resolve(), DEFAULT_DB_PATH.resolve()} or \
            Path(BACKUP_DIR).resolve() in path.parents:
        raise ValueError("Demo mode refuses the local database and its backups")
    if not path.is_file():  # connect() would otherwise create an empty database
        raise ValueError("Demo database not found")
    return path


def _demo_session_routes(app: FastAPI) -> None:
    @app.get("/api/session")
    def session_info() -> dict:
        # No accounts in the public demo: every visitor reads the same dataset, and nothing can be written.
        return {"authenticated": True, "mode": "demo"}


def _frontend_routes(app: FastAPI, dist: Path) -> None:
    """Serve the built React app same-origin with the API (one local entry point, no CORS)."""
    for sub in ("assets", "fonts"):
        if (dist / sub).is_dir():
            app.mount(f"/{sub}", StaticFiles(directory=dist / sub), name=sub)  # StaticFiles refuses ../ paths
    index = dist / "index.html"

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(path: str) -> Response:
        # API misses and missing files stay JSON 404s; any other path is a client-side route.
        if path == "api" or path.startswith("api/") or "." in path.rsplit("/", 1)[-1]:
            return _json({"detail": "Not Found"}, status=404)
        return FileResponse(index, media_type="text/html; charset=utf-8",
                            headers={"content-security-policy": PAGE_CSP})


def _session_routes(app: FastAPI) -> None:
    @app.get("/api/session/start")
    def session_start(request: Request, code: str = "") -> Response:
        """Redeem a single-use login code from the terminal; sets the HttpOnly session cookie."""
        sid = request.app.state.sessions.redeem(code) if 0 < len(code) <= 128 else None
        if sid is None:
            return _json({"detail": "Login link is invalid, expired or already used"}, status=401)
        response = RedirectResponse("/", status_code=303)  # fixed target: no open redirect
        response.set_cookie(SESSION_COOKIE, sid, max_age=SESSION_TTL_S, path="/api", httponly=True,
                            samesite="strict", secure=False)  # plain http on loopback only
        return response

    @app.get("/api/session")
    def session_info(request: Request) -> Response:
        """Session check for the frontend; returns the CSRF token to keep in page memory."""
        session = request.app.state.sessions.get(request.cookies.get(SESSION_COOKIE))
        if session is None:
            return _json({"authenticated": False}, status=401)
        return _json({"authenticated": True, "csrf_token": session.csrf})

    @app.post("/api/session/logout", dependencies=[Depends(require_auth)])
    def session_logout(request: Request) -> Response:
        request.app.state.sessions.revoke(request.cookies.get(SESSION_COOKIE))
        response = _json({"logged_out": True})
        response.delete_cookie(SESSION_COOKIE, path="/api", httponly=True, samesite="strict")
        return response

    @app.post("/api/session/login-code", dependencies=[Depends(require_bearer)])
    def session_login_code(request: Request) -> dict:
        """CLI only (bearer token): mint a new single-use login code."""
        return {"code": request.app.state.sessions.mint_login_code()}


# --------------------------------------------------------------------------- helpers
def _db(request: Request) -> Path:
    return request.app.state.db_path


def _filters(conn: sqlite3.Connection, f: s.FiltersIn) -> AnalysisFilters:
    lo, hi = date_bounds(conn)
    if lo is None and (f.start_date is None or f.end_date is None):
        raise HTTPException(409, "No dataset is loaded")
    try:
        return AnalysisFilters(
            start_date=(f.start_date.isoformat() if f.start_date else lo),
            end_date=(f.end_date.isoformat() if f.end_date else hi),
            segments=tuple(f.segments),
            rfm=RFMConfig(method=f.rfm.method, recency_thresholds=tuple(f.rfm.recency_thresholds),
                          frequency_thresholds=tuple(f.rfm.frequency_thresholds),
                          monetary_thresholds=tuple(float(v) for v in f.rfm.monetary_thresholds)),
            risk=RiskConfig(**f.risk.model_dump()),
        )
    except ValueError as exc:  # messages come from our own validation rules
        raise HTTPException(422, str(exc)) from None


def _validated(filters: AnalysisFilters) -> AnalysisFilters:
    try:
        filters.rfm.validate()
        filters.risk.validate()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return filters


def _kwargs(name: str, req: s.AnalyticsRequest | s.BatchRequest) -> dict:
    if name not in registry.FUNCTIONS:
        raise HTTPException(404, "Unknown analysis")
    allowed = registry.FUNCTION_KWARGS.get(name, frozenset())
    supplied = {k: v for k, v in req.model_dump(exclude={"filters", "names"}).items() if v is not None}
    extra = set(supplied) - allowed
    if extra:
        raise HTTPException(422, f"This analysis does not accept: {', '.join(sorted(extra))}")
    missing = registry.REQUIRED_KWARGS.get(name, frozenset()) - set(supplied)
    if missing:
        raise HTTPException(422, f"This analysis requires: {', '.join(sorted(missing))}")
    return supplied


def _run_cached(request: Request, conn: sqlite3.Connection, name: str, filters: AnalysisFilters,
                kwargs: dict) -> bytes:
    state = request.app.state
    key = (data_version(conn), name, repr(filters), tuple(sorted(kwargs.items())))
    with state.cache_lock:
        if key in state.cache:
            state.cache.move_to_end(key)
            return state.cache[key]
    result = registry.run(conn, name, filters, **kwargs)
    body = json.dumps(to_jsonable(result), allow_nan=False, separators=(",", ":")).encode()
    with state.cache_lock:
        state.cache[key] = body
        while len(state.cache) > 256:
            state.cache.popitem(last=False)
    return body


def _backup(request: Request) -> bool:
    """Verified backup before a destructive write. Only a boolean leaves the server."""
    try:
        path = backup_database(_db(request), request.app.state.backup_dir)
    except BackupError as exc:
        log.error("Backup failed: %s", exc)
        raise HTTPException(503, "Could not create a verified backup; the dataset was not changed") from None
    if path:
        log.info("Verified backup written: %s", path.name)
    return path is not None


def _write_done(request: Request) -> None:
    with request.app.state.cache_lock:
        request.app.state.cache.clear()


def _prune_uploads(uploads: OrderedDict) -> None:
    now = time.monotonic()
    for key in [k for k, (created, *_) in uploads.items() if now - created > UPLOAD_TTL_S]:
        uploads.pop(key, None)
    while len(uploads) > MAX_PENDING_UPLOADS:
        uploads.popitem(last=False)


def _summary_payload(result) -> dict:
    return {"summary": to_jsonable(result.summary), "warnings": list(result.warnings),
            "rejected_by_reason": to_jsonable(result.rejected["reason"].value_counts().to_dict())
            if not result.rejected.empty else {}}


# --------------------------------------------------------------------------- routes
def _router(writes: bool = True) -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/meta")
    def meta() -> dict:
        return {"analyses": sorted(registry.FUNCTIONS),
                "analysis_kwargs": {k: sorted(v) for k, v in registry.FUNCTION_KWARGS.items()},
                "segments": list(SEGMENT_ORDER), "risk_categories": list(RISK_ORDER),
                "defaults": {"rfm": s.RFMIn().model_dump(), "risk": s.RiskIn().model_dump()},
                "csv_exports": list(CSV_EXPORTS), "standard_fields": {
                    k: {"required": req, "label": label} for k, (req, label) in STANDARD_FIELDS.items()},
                "max_upload_mb": MAX_UPLOAD_MB}

    @r.get("/dataset")
    def dataset(request: Request) -> Response:
        with session(_db(request)) as conn:
            info = registry.dataset_summary(conn)
            info["version"] = data_version(conn)
        return _json(to_jsonable(info))

    @r.get("/dataset/rejected")
    def rejected(request: Request, limit: int = 100) -> Response:
        limit = max(1, min(limit, 500))  # raw source rows: return only what a review screen needs
        with session(_db(request)) as conn:
            df = run_sql(conn, "SELECT source_row, reason, raw FROM rejected_rows ORDER BY source_row LIMIT :lim",
                         {"lim": limit})
        return _json(to_jsonable(df))

    @r.post("/analytics/batch")
    def analytics_batch(request: Request, req: s.BatchRequest) -> Response:
        names = list(dict.fromkeys(req.names))
        kwargs = {n: _kwargs(n, req) for n in names}
        with session(_db(request)) as conn:
            filters = _validated(_filters(conn, req.filters))
            parts = [f"{json.dumps(n)}:{_run_cached(request, conn, n, filters, kwargs[n]).decode()}" for n in names]
        return Response("{" + ",".join(parts) + "}", media_type="application/json")

    @r.post("/analytics/{name}")
    def analytics(request: Request, name: str, req: s.AnalyticsRequest) -> Response:
        kwargs = _kwargs(name, req)
        with session(_db(request)) as conn:
            filters = _validated(_filters(conn, req.filters))
            body = _run_cached(request, conn, name, filters, kwargs)
        return Response(body, media_type="application/json")

    @r.get("/sql")
    def sql_list(request: Request) -> dict:
        # Query text is backend implementation: names only unless explicitly enabled.
        if request.app.state.expose_sql_text:
            return {"queries": [{"name": n, "sql": load_sql(n)} for n in list_queries()]}
        return {"queries": [{"name": n} for n in list_queries()]}

    @r.post("/sql/{name}")
    def sql_run(request: Request, name: str, req: s.SqlRequest) -> Response:
        if name not in list_queries():  # only the documented query files, never free text
            raise HTTPException(404, "Unknown query")
        sql = load_sql(name)
        needs_customer = ":customer_id" in sql
        if needs_customer and not req.customer_id:
            raise HTTPException(422, "This query requires customer_id")
        with session(_db(request)) as conn:
            filters = _validated(_filters(conn, req.filters))
            if name == "rfm_scores":  # a template: scoring follows the active RFM settings, as in Streamlit
                sql = build_rfm_sql(filters.rfm)
            ctx = registry.prepare_context(conn, filters)
            params = ctx.params(**({"customer_id": req.customer_id} if needs_customer else {}))
            conn.execute("PRAGMA query_only = ON")  # defence in depth: library queries are read-only
            try:
                df = run_sql(conn, sql, params)
            finally:
                conn.execute("PRAGMA query_only = OFF")
        return _json({"rows": len(df), "truncated": len(df) > SQL_ROW_CAP,
                      "result": to_jsonable(df.head(SQL_ROW_CAP))})

    @r.post("/reports/pdf")
    def report_pdf(request: Request, req: s.ReportRequest) -> Response:
        with session(_db(request)) as conn:
            filters = _validated(_filters(conn, req.filters))
            pdf = build_pdf_report(conn, registry.prepare_context(conn, filters), req.currency)
        return _download(pdf, "application/pdf", "pdf")

    @r.post("/reports/xlsx")
    def report_xlsx(request: Request, req: s.ReportRequest) -> Response:
        with session(_db(request)) as conn:
            filters = _validated(_filters(conn, req.filters))
            xlsx = build_excel_workbook(conn, registry.prepare_context(conn, filters), req.currency)
        return _download(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx")

    @r.post("/reports/csv/{name}")
    def report_csv(request: Request, name: str, req: s.ReportRequest) -> Response:
        if name not in CSV_EXPORTS:
            raise HTTPException(404, "Unknown export")
        with session(_db(request)) as conn:
            filters = _validated(_filters(conn, req.filters))
            df = registry.run(conn, name, filters)
        return _download(csv_bytes(df), "text/csv; charset=utf-8", "csv", name)

    @r.post("/dataset/demo/raw")
    def dataset_demo_raw(req: s.DemoRawRequest) -> Response:
        """Raw synthetic demo export, as the Streamlit download: generated in memory from the
        validated seed and size (no file is read and no path is accepted); read-only."""
        raw = generate_demo_transactions(n_customers=req.n_customers, seed=req.seed)
        return Response(csv_bytes(raw), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="customeriq_synthetic_raw.csv"'})

    if not writes:  # public demo: write routes are never registered, so they are plain 404s
        return r

    @r.post("/import/preview")
    def import_preview(request: Request, file: UploadFile = File(...),
                       sheet: str | None = Form(None, max_length=31),  # Excel caps names at 31
                       currency: str | None = Form(None, max_length=3)) -> Response:
        try:
            raw = read_table(file.file.read(), filename=Path(file.filename or "").name, sheet=sheet or None)
        except Exception as exc:
            log.info("Upload rejected: %s", type(exc).__name__)
            raise HTTPException(400, f"Could not read file: {_safe_msg(exc)}") from None
        if raw.empty:
            raise HTTPException(400, "The file contains no data rows")
        mapping = suggest_mapping(list(raw.columns))
        uploads = request.app.state.uploads
        upload_id = secrets.token_urlsafe(18)
        uploads[upload_id] = (time.monotonic(), Path(file.filename or "upload").name, raw)
        _prune_uploads(uploads)
        payload = {"upload_id": upload_id, "filename": Path(file.filename or "").name, "rows": len(raw),
                   "columns": [str(c) for c in raw.columns], "suggested_mapping": mapping,
                   "sample": raw.head(PREVIEW_ROWS),  # first rows as read, so the reader can check the mapping
                   "sheets": raw.attrs.get("sheets", []), "sheet": raw.attrs.get("sheet"), "currency": currency or None}
        try:
            mapped = apply_mapping(raw, mapping)
            try:
                detect_currency(mapped)
            except AmbiguousCurrency:  # bare "$": the page asks which dollar, also after one was chosen
                payload["currency_options"] = list(DOLLAR_CURRENCIES)
            except ValueError:
                pass  # mixed or unsupported currencies are reported by clean_transactions below
            result = clean_transactions(mapped, currency=currency or None)
            payload["validation"] = _summary_payload(result)
        except ValueError as exc:
            payload["validation"] = {"error": _safe_msg(exc)}
        return _json(to_jsonable(payload))

    @r.post("/import/commit")
    def import_commit(request: Request, req: s.ImportCommit) -> Response:
        uploads = request.app.state.uploads
        _prune_uploads(uploads)
        entry = uploads.get(req.upload_id)
        if entry is None:
            raise HTTPException(404, "Upload not found or expired; upload the file again")
        _, filename, raw = entry
        options = CleaningOptions(**req.options.model_dump())
        with request.app.state.write_lock:
            try:  # validate first so a bad mapping or mixed currencies never trigger a backup or a write
                detect_currency(apply_mapping(raw, req.mapping), req.currency)
            except ValueError as exc:
                raise HTTPException(422, _safe_msg(exc)) from None
            backup = _backup(request)
            with session(_db(request)) as conn:
                result = import_dataframe(conn, raw, req.mapping, source_name=filename, is_synthetic=False,
                                          options=options, currency=req.currency)
            _write_done(request)
        payload = _summary_payload(result) | {"backup_created": backup, "imported": not result.clean.empty}
        if result.clean.empty:
            return _json(payload | {"detail": "No valid rows; the current dataset was kept"}, status=422)
        uploads.pop(req.upload_id, None)
        return _json(payload)

    @r.post("/dataset/demo")
    def dataset_demo(request: Request, req: s.DemoRequest) -> Response:
        with request.app.state.write_lock:
            backup = _backup(request)
            with session(_db(request)) as conn:
                result = load_demo_dataset(conn, seed=req.seed, n_customers=req.n_customers)
            _write_done(request)
        return _json(_summary_payload(result) | {"backup_created": backup})

    @r.post("/dataset/clear")
    def dataset_clear(request: Request, _: s.ConfirmRequest) -> Response:
        with request.app.state.write_lock:
            backup = _backup(request)
            with session(_db(request)) as conn:
                with conn:  # one transaction, same tables as the Streamlit "Clear dataset" button
                    for table in ("transactions", "rejected_rows", "customer_segments", "dataset_meta"):
                        conn.execute(f"DELETE FROM {table}")
            _write_done(request)
        return _json({"cleared": True, "backup_created": backup})

    return r


def _download(data: bytes, media_type: str, ext: str, name: str = "report") -> Response:
    stamp = time.strftime("%Y%m%d_%H%M")
    return Response(data, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="customeriq_{name}_{stamp}.{ext}"'})


# Messages raised by our own loader / mapping code. Anything else (pandas, openpyxl,
# zipfile ...) could describe library internals, so it is replaced by a fixed text.
_OWN_MESSAGES = ("Unsupported file type", "The file is empty", "File exceeds", "A filename is required",
                 "Required fields are not mapped", "Each source column", "Mapped columns not found",
                 "Excel workbook expands", "The file is not a valid Excel workbook", "Sheet not found",
                 "Mixed currencies", "Unsupported currency", "Currency conflict", "Prices use '$'")


def _safe_msg(exc: Exception) -> str:
    msg = str(exc).splitlines()[0] if str(exc) else ""
    if isinstance(exc, ValueError) and msg.startswith(_OWN_MESSAGES):
        return msg[:300]
    if isinstance(exc, ValueError) and msg.startswith("Could not decode file"):
        return "Could not decode file; save it as UTF-8 CSV"
    return "The file is not a readable CSV or Excel workbook"

"""Authentication, CSRF protection and hardening for the local API.

Two ways to authenticate, and no credential ever lives in browser code or storage:

* **Browsers** get an ``HttpOnly; SameSite=Strict; Path=/api`` session cookie, opened
  from a single-use login link that the launcher prints to the terminal. Page
  JavaScript cannot read the cookie. Every state-changing request (any non-GET)
  must also carry the session's CSRF token in ``X-CSRF-Token`` *and* come from an
  allowed Origin with ``Sec-Fetch-Site: same-origin``. The CSRF token is not a
  credential: it is useless without the cookie and is held only in page memory.
* **Local scripts / CLI** may send ``Authorization: Bearer <token>``. The token stays
  server-side (``CUSTOMERIQ_API_TOKEN`` or the git-ignored ``.customeriq_token``) and
  is refused if a browser sends it (``Sec-Fetch-*`` headers present), so it cannot be
  embedded in a frontend.

Plus: Host-header allowlist (DNS rebinding), no CORS at all (the frontend is served
same-origin or through the dev proxy), restrictive headers and streamed body limits.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.config import PROJECT_ROOT

TOKEN_FILE = PROJECT_ROOT / ".customeriq_token"
MIN_TOKEN_LENGTH = 32
SESSION_COOKIE = "customeriq_session"
SESSION_TTL_S = 12 * 3600
LOGIN_CODE_TTL_S = 600
MAX_LOGIN_CODES = 5
MAX_SESSIONS = 20
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cache-control", b"no-store"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cross-origin-resource-policy", b"same-origin"),
    (b"cross-origin-opener-policy", b"same-origin"),
]


def resolve_token(token_file: Path = TOKEN_FILE) -> str:
    """Return the script API token from the environment, else from (or into) ``token_file``."""
    env = os.environ.get("CUSTOMERIQ_API_TOKEN", "").strip()
    if env:
        if len(env) < MIN_TOKEN_LENGTH:
            raise ValueError(f"CUSTOMERIQ_API_TOKEN must be at least {MIN_TOKEN_LENGTH} characters")
        return env
    if token_file.exists():
        token = token_file.read_text(encoding="utf-8").strip()
        if len(token) >= MIN_TOKEN_LENGTH:
            return token
    token = secrets.token_urlsafe(32)
    token_file.write_text(token, encoding="utf-8")
    try:
        token_file.chmod(0o600)
    except OSError:  # best effort on Windows
        pass
    return token


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass
class _Session:
    csrf: str
    expires: float


@dataclass
class SessionStore:
    """In-memory sessions and single-use login codes (only hashes of secrets are stored)."""

    codes: dict[str, float] = field(default_factory=dict)        # sha256(code) -> expiry
    sessions: dict[str, _Session] = field(default_factory=dict)  # sha256(session id) -> session
    lock: threading.Lock = field(default_factory=threading.Lock)

    def _prune(self, now: float) -> None:
        self.codes = {k: v for k, v in self.codes.items() if v > now}
        self.sessions = {k: v for k, v in self.sessions.items() if v.expires > now}

    def mint_login_code(self) -> str:
        code = secrets.token_urlsafe(24)
        now = time.time()
        with self.lock:
            self._prune(now)
            while len(self.codes) >= MAX_LOGIN_CODES:
                self.codes.pop(next(iter(self.codes)))
            self.codes[_digest(code)] = now + LOGIN_CODE_TTL_S
        return code

    def redeem(self, code: str) -> str | None:
        """Consume a login code; return a brand-new session id (no fixation), or None."""
        now = time.time()
        with self.lock:
            self._prune(now)
            if self.codes.pop(_digest(code), None) is None:
                return None
            while len(self.sessions) >= MAX_SESSIONS:
                self.sessions.pop(next(iter(self.sessions)))
            sid = secrets.token_urlsafe(32)
            self.sessions[_digest(sid)] = _Session(csrf=secrets.token_urlsafe(32), expires=now + SESSION_TTL_S)
            return sid

    def get(self, sid: str | None) -> _Session | None:
        if not sid or len(sid) > 128:
            return None
        with self.lock:
            s = self.sessions.get(_digest(sid))
            return s if s and s.expires > time.time() else None

    def revoke(self, sid: str | None) -> None:
        if sid:
            with self.lock:
                self.sessions.pop(_digest(sid), None)


def _bearer(request: Request) -> str | None:
    scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
    return supplied.strip() if scheme.lower() == "bearer" and supplied.strip() else None


def _from_browser(request: Request) -> bool:
    return any(h in request.headers for h in ("sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest"))


def check_csrf(request: Request, session: _Session) -> None:
    """Cookie-authenticated unsafe requests: same-origin, allowed Origin, matching CSRF token."""
    origin = request.headers.get("origin")
    if origin is None or origin not in request.app.state.allowed_origins:
        raise HTTPException(403, "Cross-origin request refused")
    site = request.headers.get("sec-fetch-site")
    if site is not None and site != "same-origin":
        raise HTTPException(403, "Cross-origin request refused")
    supplied = request.headers.get("x-csrf-token", "")
    if not secrets.compare_digest(supplied.encode(), session.csrf.encode()):
        raise HTTPException(403, "Missing or invalid CSRF token")


def require_auth(request: Request) -> None:
    """FastAPI dependency applied to every protected route."""
    token = _bearer(request)
    if token is not None:
        if _from_browser(request):
            raise HTTPException(401, "API tokens are not accepted from browsers; use a session")
        if secrets.compare_digest(token.encode(), request.app.state.token.encode()):
            return
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    session = request.app.state.sessions.get(request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise HTTPException(401, "Not authenticated")
    if request.method not in SAFE_METHODS:
        check_csrf(request, session)


def require_bearer(request: Request) -> None:
    """For CLI-only routes (minting login links): bearer token, never from a browser."""
    token = _bearer(request)
    if token is None or _from_browser(request) or not secrets.compare_digest(
            token.encode(), request.app.state.token.encode()):
        raise HTTPException(401, "Not authenticated")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [h for h in message.get("headers", []) if h[0].lower() != b"server"]
                present = {h[0].lower() for h in headers}
                headers += [h for h in SECURITY_HEADERS if h[0] not in present]
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class _TooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=413, detail="Request body too large")


class BodyLimitMiddleware:
    """Reject request bodies over the limit with HTTP 413: ``upload_bytes`` for the
    upload route, ``json_bytes`` for everything else."""

    def __init__(self, app: ASGIApp, upload_bytes: int, json_bytes: int = 1024 * 1024,
                 upload_paths: tuple[str, ...] = ("/api/import/preview",)) -> None:
        self.app = app
        self.upload_bytes = upload_bytes
        self.json_bytes = json_bytes
        self.upload_paths = upload_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.upload_bytes if scope.get("path") in self.upload_paths else self.json_bytes
        length = dict(scope.get("headers", [])).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > limit):
            await _send_413(send)
            return
        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _TooLarge()
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _TooLarge:
            if not started:
                await _send_413(send)


async def _send_413(send: Send) -> None:
    body = b'{"detail":"Request body too large"}'
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})

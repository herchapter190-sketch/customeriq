"""Authentication and hardening for the local API.

* Bearer token on every ``/api`` route except ``/api/health``. The token comes from
  ``CUSTOMERIQ_API_TOKEN`` or is generated once into ``.customeriq_token`` (git-ignored)
  and compared in constant time.
* Host-header allowlist (``TrustedHostMiddleware``) blocks DNS-rebinding attacks.
* Restrictive response headers: no caching, no sniffing, no framing, no referrer.
* Request bodies are capped while they stream, so oversized uploads never reach memory.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.config import PROJECT_ROOT

TOKEN_FILE = PROJECT_ROOT / ".customeriq_token"
MIN_TOKEN_LENGTH = 32

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cache-control", b"no-store"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cross-origin-resource-policy", b"same-origin"),
]


def resolve_token(token_file: Path = TOKEN_FILE) -> str:
    """Return the API token from the environment, else from (or into) ``token_file``."""
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


def require_token(request: Request) -> None:
    """FastAPI dependency: reject requests without the correct bearer token."""
    expected: str = request.app.state.token
    scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(supplied.strip().encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Missing or invalid API token",
                            headers={"WWW-Authenticate": "Bearer"})


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
    """Reject request bodies larger than ``max_bytes`` with HTTP 413."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = dict(scope.get("headers", [])).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_bytes):
            await _send_413(send)
            return
        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
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

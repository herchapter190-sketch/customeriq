"""Run the local API:            python -m src.api [--port 8520]
Print a fresh browser login link: python -m src.api login-link [--port 8520]

Always binds to 127.0.0.1; there is deliberately no option to listen on other interfaces.
The API token is never printed: browsers sign in with a single-use link instead.
"""
from __future__ import annotations

import argparse
import json
import logging
import urllib.request

import uvicorn

from .app import DEFAULT_PORT, create_app
from .security import resolve_token


def _login_url(port: int, code: str) -> str:
    return f"http://127.0.0.1:{port}/api/session/start?code={code}"


def _login_link(port: int) -> None:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/session/login-code", method="POST",
                                 headers={"Authorization": f"Bearer {resolve_token()}"})
    with urllib.request.urlopen(req, timeout=10) as resp:  # loopback only
        print(f"Single-use login link (valid 10 minutes):\n  {_login_url(port, json.load(resp)['code'])}")


def main() -> None:
    parser = argparse.ArgumentParser(description="CustomerIQ local API (127.0.0.1 only)")
    parser.add_argument("command", nargs="?", choices=["serve", "login-link"], default="serve")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    if args.port == 8517:
        parser.error("port 8517 is reserved for the Streamlit app")
    if args.command == "login-link":
        _login_link(args.port)
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = create_app(token=resolve_token(), port=args.port)
    code = app.state.sessions.mint_login_code()
    print(f"CustomerIQ API on http://127.0.0.1:{args.port}\n"
          f"Single-use browser login link (valid 10 minutes):\n  {_login_url(args.port, code)}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, server_header=False, proxy_headers=False,
                forwarded_allow_ips="", log_level="info", access_log=False)  # no URLs/codes in logs


if __name__ == "__main__":
    main()

"""Run the local API:  python -m src.api [--port 8520]

Always binds to 127.0.0.1; there is deliberately no option to listen on other interfaces.
"""
from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from .app import create_app
from .security import TOKEN_FILE, resolve_token


def main() -> None:
    parser = argparse.ArgumentParser(description="CustomerIQ local API (127.0.0.1 only)")
    parser.add_argument("--port", type=int, default=8520)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    if args.port == 8517:
        parser.error("port 8517 is reserved for the Streamlit app")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    token = resolve_token()
    source = "CUSTOMERIQ_API_TOKEN" if os.environ.get("CUSTOMERIQ_API_TOKEN") else str(TOKEN_FILE)
    print(f"CustomerIQ API on http://127.0.0.1:{args.port}  (token from {source})")
    app = create_app(token=token, enable_docs=os.environ.get("CUSTOMERIQ_API_DOCS") == "1")
    uvicorn.run(app, host="127.0.0.1", port=args.port, server_header=False, proxy_headers=False,
                forwarded_allow_ips="", log_level="info")


if __name__ == "__main__":
    main()

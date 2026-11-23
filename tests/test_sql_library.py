"""The SQL Library page runs every documented query with the dashboard parameters."""
from __future__ import annotations

from src.segments.rfm import build_rfm_sql
from src.sql.runner import QUERY_DIR, list_queries, run_sql
from src.ui.pages.sql_library import _query_text, parse_header


def test_parse_header_extracts_fields():
    meta = parse_header((QUERY_DIR / "repeat_purchase.sql").read_text(encoding="utf-8"))
    assert meta["Purpose"].startswith("Compare one-time and repeat customers")
    assert "CTEs" in meta["SQL"]
    assert "2+ distinct sales orders" in meta["Notes"]  # continuation lines are joined


def test_rfm_scores_uses_configured_scoring(known_ctx):
    assert _query_text("rfm_scores", known_ctx.filters) == build_rfm_sql(known_ctx.filters.rfm)


def test_every_library_query_runs(known_conn, known_ctx):
    for name in list_queries():
        sql = _query_text(name, known_ctx.filters)
        params = known_ctx.params(**({"customer_id": "A"} if ":customer_id" in sql else {}))
        df = run_sql(known_conn, sql, params)
        assert df is not None, name
    # spot-check a result against the hand-calculated fixture: 2 repeat customers (A, B)
    rp = run_sql(known_conn, _query_text("repeat_purchase", known_ctx.filters), known_ctx.params())
    assert len(rp) == 2

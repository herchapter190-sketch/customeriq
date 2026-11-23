"""Stage 3D: Gini, average retention, gap statistics and raw demo CSV through the API.

Each value is compared with the exact helper call the Streamlit pages make.
"""
from __future__ import annotations

import io

import pandas as pd
import pytest

from src.analytics import behaviour, cohorts, revenue
from src.analytics.context import AnalysisFilters, prepare_context
from src.etl.synthetic import DEFAULT_SEED
from src.database.connection import session
from src.etl.synthetic import generate_demo_transactions
from src.reports.safe_export import csv_bytes
from tests.test_api import AUTH, PERIOD, _counts, client, db_path  # noqa: F401  (fixtures)


def _ctx(db_path):
    conn_cm = session(db_path)
    conn = conn_cm.__enter__()
    return conn_cm, conn, prepare_context(conn, AnalysisFilters(**PERIOD))


def _post(client, name):
    r = client.post(f"/api/analytics/{name}", json={"filters": PERIOD}, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def test_gini_matches_streamlit_revenue_page(client, db_path):
    cm, conn, ctx = _ctx(db_path)
    try:  # src/ui/pages/revenue.py: gini_coefficient(revenue_by_customer["net_revenue"])
        expected = revenue.gini_coefficient(revenue.revenue_by_customer(conn, ctx)["net_revenue"])
    finally:
        cm.__exit__(None, None, None)
    assert expected is not None
    assert _post(client, "gini_coefficient") == {"gini": expected}


def test_gini_none_when_too_few_customers():
    assert revenue.gini_coefficient(pd.Series([], dtype=float)) is None  # API serialises this as null


def test_retention_summary_matches_streamlit_cohorts_page(client, db_path):
    cm, conn, ctx = _ctx(db_path)
    try:  # src/ui/pages/cohorts.py: average_retention_curve(cohort_long, end_date), rows k=1 and k=3
        curve = cohorts.average_retention_curve(cohorts.cohort_long(conn, ctx), PERIOD["end_date"])
    finally:
        cm.__exit__(None, None, None)
    body = _post(client, "retention_summary")
    got = pd.DataFrame(body["curve"]["data"], columns=body["curve"]["columns"])
    assert got["month_index"].tolist() == curve["month_index"].tolist()
    assert got["retention_pct"].tolist() == pytest.approx(curve["retention_pct"].tolist(), nan_ok=True)
    m1 = curve.loc[curve["month_index"] == 1, "retention_pct"]
    m3 = curve.loc[curve["month_index"] == 3, "retention_pct"]
    assert body["month_1_pct"] == (float(m1.iloc[0]) if len(m1) and pd.notna(m1.iloc[0]) else None)
    assert body["month_3_pct"] == (float(m3.iloc[0]) if len(m3) and pd.notna(m3.iloc[0]) else None)
    assert body["month_1_pct"] is not None


def test_interpurchase_summary_matches_streamlit_behaviour_page(client, db_path):
    cm, conn, ctx = _ctx(db_path)
    try:  # src/ui/pages/behaviour.py: interpurchase_summary(interpurchase_gaps)
        expected = behaviour.interpurchase_summary(behaviour.interpurchase_gaps(conn, ctx))
    finally:
        cm.__exit__(None, None, None)
    body = _post(client, "interpurchase_summary")
    assert body == pytest.approx(expected)
    assert {"median_days", "p25_days", "p75_days", "second_order_median_days"} <= set(body)


def test_new_analyses_in_batch_and_meta(client):
    names = ["gini_coefficient", "retention_summary", "interpurchase_summary"]
    r = client.post("/api/analytics/batch", json={"filters": PERIOD, "names": names}, headers=AUTH)
    assert r.status_code == 200 and set(r.json()) == set(names)
    assert set(names) <= set(client.get("/api/meta", headers=AUTH).json()["analyses"])
    r = client.post("/api/analytics/gini_coefficient", json={"filters": PERIOD, "limit": 5}, headers=AUTH)
    assert r.status_code == 422  # no extra arguments accepted


# --------------------------------------------------------------------------- raw demo CSV
def test_demo_raw_csv_matches_streamlit_download_and_writes_nothing(client, db_path):
    before = _counts(db_path)
    r = client.post("/api/dataset/demo/raw", json={"seed": 11, "n_customers": 200}, headers=AUTH)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"] == 'attachment; filename="customeriq_synthetic_raw.csv"'
    # src/ui/pages/data_management.py: csv_bytes(generate_demo_transactions(n_customers=n, seed=seed))
    assert r.content == csv_bytes(generate_demo_transactions(n_customers=200, seed=11))
    assert _counts(db_path) == before


def test_demo_raw_csv_defaults(client):
    r = client.post("/api/dataset/demo/raw", json={}, headers=AUTH)
    assert r.status_code == 200
    expected = pd.read_csv(io.BytesIO(csv_bytes(generate_demo_transactions(n_customers=1600, seed=DEFAULT_SEED))))
    assert len(pd.read_csv(io.BytesIO(r.content))) == len(expected)


@pytest.mark.parametrize("body", [{"seed": 0}, {"n_customers": 199}, {"n_customers": 6001}, {"seed": "x"},
                                  {"path": "../../.env"}, {"file": "data/customeriq.db"}, {"confirm": True}])
def test_demo_raw_csv_rejects_bad_or_path_input(client, body):
    r = client.post("/api/dataset/demo/raw", json=body, headers=AUTH)
    assert r.status_code == 422
    assert "env" not in r.text and "customeriq.db" not in r.text


@pytest.mark.parametrize("path", ["/api/dataset/demo/raw/../../.env", "/api/dataset/demo/raw/x",
                                  "/api/dataset/demo/raw?path=.env"])
def test_demo_raw_csv_has_no_file_path_route(client, path):
    r = client.post(path, json={}, headers=AUTH)
    assert r.status_code in (404, 405) or r.content.startswith(b"InvoiceNo")  # query string is ignored
    assert b"SECRET" not in r.content


def test_demo_raw_csv_requires_auth(client):
    assert client.post("/api/dataset/demo/raw", json={}).status_code == 401

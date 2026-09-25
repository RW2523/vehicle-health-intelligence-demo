"""Test setup: a fresh database in a temp folder, seeded from data/curated, with the real trained models."""
import os
import shutil
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="vhi-test-")
os.environ["VHI_VAR_DIR"] = _tmp
os.environ.setdefault("VHI_OLLAMA_URL", "")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from vhi.main import app

    if os.environ.get("VHI_DATABASE_URL"):  # a shared Postgres database: start from a clean runtime state
        from vhi.seed import reset_runtime
        reset_runtime()
    with TestClient(app) as c:
        yield c
    shutil.rmtree(_tmp, ignore_errors=True)


@pytest.fixture(scope="session")
def s1(client):
    r = client.post("/api/sessions/S1/start", json={"fast": True})
    assert r.status_code == 200, r.text
    return client.get("/api/inspections/latest", params={"session_id": "S1"}).json()


@pytest.fixture(scope="session")
def s2(client):
    assert client.post("/api/sessions/S2/start", json={"fast": True}).status_code == 200
    return client.get("/api/inspections/latest", params={"session_id": "S2"}).json()


@pytest.fixture(scope="session")
def s3(client):
    assert client.post("/api/sessions/S3/start", json={"fast": True}).status_code == 200
    return client.get("/api/inspections/latest", params={"session_id": "S3"}).json()

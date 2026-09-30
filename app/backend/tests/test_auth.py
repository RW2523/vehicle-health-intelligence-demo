"""Login and roles: every app needs a login, and each role reaches only its own apps and data."""
import os

import pytest
from fastapi.testclient import TestClient

from vhi import auth
from vhi.db import session_scope
from vhi.main import app
from vhi.tables import LiveInspection

PASSWORD = os.environ["VHI_DEMO_PASSWORD"]  # set by conftest


def login(username):
    c = TestClient(app)  # its own cookie jar; the app and runtime are the session client's
    r = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(autouse=True)
def fresh_gate():
    auth.gate._fails.clear()
    yield
    auth.gate._fails.clear()


def test_only_the_login_and_qr_pages_are_open(client):
    anon = TestClient(app)
    assert anon.get("/api/health").status_code == 200
    assert {a["username"] for a in anon.get("/api/auth/accounts").json()} >= {"presenter", "examiner", "owner", "viewer"}
    assert anon.get("/api/verify/no-such-token").status_code == 404  # reachable, just unknown
    for path in ("/api/sessions", "/api/system/status", "/api/hq/ops", "/media/assets/captures/captures.json"):
        r = anon.get(path)
        assert r.status_code == 401 and r.json()["code"] == "login", path
    assert anon.get("/api/auth/me").status_code == 401
    with pytest.raises(Exception):
        with anon.websocket_connect("/ws"):
            pass


def test_wrong_passwords_are_refused_and_rate_limited(client):
    anon = TestClient(app)
    assert anon.post("/api/auth/login", json={"username": "presenter", "password": "nope"}).status_code == 401
    for _ in range(auth.Gate.MAX_FAILS - 1):
        anon.post("/api/auth/login", json={"username": "presenter", "password": "nope"})
    assert anon.post("/api/auth/login", json={"username": "presenter", "password": PASSWORD}).status_code == 429


def test_examiner_reaches_the_lanes_of_their_branch_only(s1):
    ex = login("examiner")
    me = ex.get("/api/auth/me").json()
    assert me["role"] == "examiner" and me["branch_id"] == "BR00" and me["examiner_id"] == "VE011"
    insp = ex.get("/api/inspections/latest", params={"session_id": "S1"}).json()
    assert insp["inspection_id"] == s1["inspection_id"]
    for path in ("/api/hq/ops", "/api/owner/passport/DMO%209006", "/api/fleet/overview"):
        assert ex.get(path).status_code == 403, path
    assert ex.post("/api/evidence/tamper-test").status_code == 403
    with session_scope() as s:  # an inspection at another branch
        s.add(LiveInspection(inspection_id="LIotherbr", session_id="X", lane_id="BR05-L1", branch_id="BR05", plate="DMO 1",
                             inspection_type="B5", status="review", results={}, measurements={}, fusion={}))
    assert ex.get("/api/inspections/LIotherbr").status_code == 403
    assert "LIotherbr" not in {i["inspection_id"] for i in ex.get("/api/inspections").json()}
    # a decision is recorded under the logged-in examiner, whatever the request says
    a = next(x for x in insp["alerts"] if x["status"] == "open")
    out = ex.post(f"/api/inspections/alerts/{a['alert_id']}/decision",
                  json={"action": "defer", "reason": "checking in the workshop", "examiner_id": "VE999"}).json()
    assert out["decided_by"] == "VE011"


def test_owner_reaches_only_their_own_vehicle(client):
    own = login("owner")
    assert own.get("/api/owner/passport/DMO%209006").status_code == 200
    assert own.get("/api/owner/passport/DMO%209001").status_code == 403
    assert own.get("/api/owner/bookings", params={"plate": "DMO 9001"}).status_code == 403
    assert own.get("/api/sessions").status_code == 403 and own.get("/api/hq/ops").status_code == 403


def test_viewer_reads_everything_and_changes_nothing(client):
    v = login("viewer")
    for path in ("/api/sessions", "/api/hq/ops", "/api/fleet/overview", "/api/regulator", "/api/owner/passport/DMO%209006"):
        assert v.get(path).status_code == 200, path
    r = v.post("/api/sessions/S3/pause")
    assert r.status_code == 403 and r.json()["code"] == "forbidden"
    assert v.post("/api/evidence/tamper-test").status_code == 403
    assert v.post("/api/owner/assistant", json={"conversation": "t-viewer", "text": "What does an EV inspection check?"}).status_code == 200


def test_hq_and_regulator(client):
    hq = login("hq")
    assert hq.get("/api/hq/ops").status_code == 200 and hq.get("/api/regulator").status_code == 200
    assert hq.post("/api/evidence/tamper-test").status_code == 200
    assert hq.get("/api/owner/passport/DMO%209006").status_code == 403
    reg = login("regulator")
    assert reg.get("/api/regulator").status_code == 200 and reg.get("/api/hq/ops").status_code == 403


def test_logout(client):
    c = login("hq")
    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/hq/ops").status_code == 401

"""The guided demo: nine use cases whose progress is read from the live system, HQ exceptions with recorded actions,
and the synthetic demo report a buyer can verify on a fresh system."""
from vhi.services import usecases


def step(p, sid):
    return next(s for s in p["steps"] if s["id"] == sid)


def test_catalogue_lists_nine_use_cases(client):
    c = client.get("/api/usecases").json()
    assert [u["id"] for u in c["items"]] == [f"UC-0{i}" for i in range(1, 10)]
    for u in c["items"]:
        assert u["title"] and u["scenario"] and u["outcome"] and u["minutes"] > 0 and u["provenance"]
        assert u["steps"] and all(s["href"].startswith("/") for s in u["steps"])


def test_clean_inspection_journey(client):
    """UC-04: start -> the lane runs -> nothing to decide -> PASS report -> the passport."""
    p = client.post("/api/usecases/UC-04/start").json()
    assert p["done"] == 0 and p["next"]["id"] == "checkin" and p["next"]["href"] == "/lane?lane=BR00-L4"
    assert client.post("/api/sessions/S7/start", json={"fast": True}).status_code == 200
    p = client.get("/api/usecases/active").json()["active"]
    assert [s["done"] for s in p["steps"]] == [True, True, True, True, False, False]
    assert p["next"]["id"] == "report" and p["inspection"]["alerts"] == 0
    rep = client.post(f"/api/inspections/{p['inspection']['inspection_id']}/report", json={"examiner_id": "VE011"}).json()
    assert rep["verdict"] == "PASS"
    p = client.post("/api/usecases/visit", json={"path": "/fleet"}).json()["active"]  # not the next step: ignored
    assert not p["complete"] and p["next"]["id"] == "downstream"
    p = client.post("/api/usecases/visit", json={"path": "/owner?plate=DMO%209006&tab=passport"}).json()["active"]
    assert p["complete"] and p["done"] == len(p["steps"])
    # restarting counts only what happens after it
    p = client.post("/api/usecases/UC-04/start").json()
    assert p["done"] == 0


def test_owner_journey_self_check_booking_checkin(client):
    """UC-05: the self-check says ready, the owner books and pays (mock), the lane checks the booking in."""
    client.post("/api/usecases/UC-05/start")
    script = client.get("/api/owner/self-check/script").json()
    first = client.post("/api/owner/self-check", json={"plate": "DMO 9006", **script["first_attempt"]}).json()
    assert first["verdict"] == "Fix these first"
    assert client.get("/api/usecases/active").json()["active"]["next"]["id"] == "selfcheck"
    ok = client.post("/api/owner/self-check", json={"plate": "DMO 9006", **script["second_attempt"]}).json()
    assert ok["verdict"] == "Ready for inspection"
    day = client.get("/api/owner/gear", params={"branch_id": "BR00"}).json()["date"]
    slot = next(s for s in client.get("/api/owner/slots", params={"branch_id": "BR00", "date": day}).json()["slots"]
                if s["available"] and not s["gear"])
    b = client.post("/api/owner/bookings", json={"plate": "DMO 9006", "branch_id": "BR00", "date": day, "slot": slot["time"],
                                                 "inspection_type": "VOLUNTARY"}).json()
    client.post(f"/api/owner/bookings/{b['booking_id']}/pay", json={"method": "FPX"})
    p = client.get("/api/usecases/active").json()["active"]
    assert step(p, "selfcheck")["done"] and step(p, "book")["done"] and p["next"]["id"] == "checkin"
    client.post("/api/sessions/S7/start", json={"fast": True})
    p = client.get("/api/usecases/active").json()["active"]
    assert step(p, "checkin")["done"] and p["next"]["id"] == "report"
    insp = client.get("/api/inspections/latest", params={"session_id": "S7"}).json()
    assert insp["inspection_type"] == "Voluntary Inspection" and insp["results"]["anpr"]["booking"]["booking_id"] == b["booking_id"]
    assert insp["branch_name"] == "Central Inspection Hub" and insp["examiner"]["id"]


def test_hq_exception_journey(client):
    """UC-07: open exceptions with reasons and evidence -> drill in -> a recorded, hash-chained action -> handled."""
    client.post("/api/usecases/UC-07/start")
    ex = client.get("/api/hq/exceptions").json()
    kinds = {i["kind"] for i in ex["items"]}
    assert {"integrity", "equipment"} <= kinds and ex["open"] == len(ex["items"])
    it = next(i for i in ex["items"] if i["key"] == "integrity:VE017")
    assert it["reason"] and it["evidence"] and it["href"].startswith("/hq?") and it["state"]["status"] == "open"
    client.post("/api/usecases/visit", json={"path": "/hq"})
    client.post("/api/usecases/visit", json={"path": "/hq?examiner=VE017"})
    bad = client.post("/api/hq/exceptions/action", json={"key": "integrity:VE017", "action": "work_order"})
    assert bad.status_code == 400
    done = client.post("/api/hq/exceptions/action", json={"key": "integrity:VE017", "action": "open_review",
                                                           "note": "Pull the last 20 heavy-vehicle passes"}).json()
    assert done["state"]["status"] == "actioned" and done["state"]["chain_seq"] > 0
    assert client.get("/api/evidence/verify").json()["intact"]
    p = client.post("/api/usecases/visit", json={"path": "/hq"}).json()["active"]
    assert p["complete"]
    after = {i["key"]: i for i in client.get("/api/hq/exceptions").json()["items"]}
    assert after["integrity:VE017"]["state"]["label"] == "Integrity review opened"
    client.post("/api/usecases/UC-07/start")  # a restart reopens them
    assert all(i["state"]["status"] == "open" for i in client.get("/api/hq/exceptions").json()["items"])


def test_buyer_verifies_the_latest_report_without_login(client):
    """UC-09: listings -> the Civic's record -> its latest report -> public verification (no login)."""
    p = client.post("/api/usecases/UC-09/start").json()
    rec = step(p, "record")["href"]
    assert rec.startswith("/sales?id=LS")
    for path in ("/sales", rec, rec + "#report"):
        p = client.post("/api/usecases/visit", json={"path": path}).json()["active"]
    verify = p["next"]["href"]
    assert verify.startswith("/verify/") and len(verify) > len("/verify/")
    from fastapi.testclient import TestClient

    from vhi.main import app
    anon = TestClient(app).get(f"/api{verify}").json()  # a buyer's phone: no session cookie
    assert anon["valid"] is True and anon["plate"] == "DMO 9003" and anon["odometer_km"]
    p = client.post("/api/usecases/visit", json={"path": verify}).json()["active"]
    assert p["complete"]


def test_synthetic_report_is_labelled_and_chained(client):
    reps = client.get("/api/reports", params={"limit": 100}).json()
    syn = next(r for r in reps if r["inspection_id"] == "SYN90031")
    v = client.get(f"/api/verify/{syn['verify_token']}").json()
    assert v["valid"] and v["synthetic"] and v["odometer_km"] == 182900 and v["verdict"] == "PASS"


def test_viewer_cannot_drive_the_demo(client):
    from fastapi.testclient import TestClient

    from tests.conftest import PASSWORD
    from vhi.main import app
    viewer = TestClient(app)
    assert viewer.post("/api/auth/login", json={"username": "viewer", "password": PASSWORD}).status_code == 200
    assert viewer.get("/api/usecases").status_code == 200
    assert viewer.post("/api/usecases/UC-01/start").status_code == 403
    assert viewer.post("/api/hq/exceptions/action", json={"key": "chain", "action": "acknowledge"}).status_code == 403


def test_every_step_kind_is_known():
    kinds = {"visit", "checkin", "lane_done", "reviewed", "decided", "referred", "report", "selfcheck", "booked",
             "booking_checked_in", "fleet_booked", "invited", "exception_action"}
    for uc in usecases.USECASES:
        for s in uc["steps"]:
            assert s["kind"] in kinds, (uc["id"], s["id"])


def test_inspection_assistant_answers_from_facts(client, s1):
    r = client.post(f"/api/inspections/{s1['inspection_id']}/ask", json={"question": "Why was this vehicle flagged?"}).json()
    assert r["intent"] == "why" and r["facts"] and r["answer"] and r["source"] == "template"  # no LLM in the tests
    assert all(f["n"] == i + 1 for i, f in enumerate(r["facts"]))
    assert any(f["ref"] for f in r["facts"])  # facts link back to the findings
    t = client.post(f"/api/inspections/{s1['inspection_id']}/ask", json={"question": "Show the previous inspection trend"}).json()
    assert t["intent"] == "trend" and any("Commercial Periodic Inspection" in f["text"] for f in t["facts"])
    alert = s1["alerts"][0]["alert_id"]
    e = client.post(f"/api/inspections/{s1['inspection_id']}/ask", json={"question": "What evidence supports this finding?",
                                                                          "alert_id": alert}).json()
    assert e["facts"][0]["ref"] == alert


def test_flood_watch_invitation_journey(client):
    """UC-08: the December 2025 flood view ranks the EV for a flood-damage inspection -> mock invitation -> the lane
    inspection -> its result shows in flood watch."""
    p = client.post("/api/usecases/UC-08/start").json()
    assert p["next"]["href"].startswith("/flood?scope=event%3A2025-12-10")
    d = client.get("/api/floodwatch/vehicles/DMO%209002", params={"scope": "event:2025-12-10"}).json()
    assert d["risk"] >= 70 and d["recommendation"] == "Flood-damage inspection"
    client.post("/api/usecases/visit", json={"path": "/flood?scope=event%3A2025-12-10"})
    client.post("/api/usecases/visit", json={"path": "/flood?scope=event%3A2025-12-10&vehicle=DMO+9002"})
    inv = client.post("/api/floodwatch/invitations", json={"plates": ["DMO 9002"], "scope": "event:2025-12-10"}).json()
    assert inv["invited"] and inv["channel"] == "mock"
    p = client.get("/api/usecases/active").json()["active"]
    assert [s["done"] for s in p["steps"][:3]] == [True, True, True] and p["next"]["id"] == "checkin"
    client.post("/api/sessions/S2/start", json={"fast": True})
    insp = client.get("/api/inspections/latest", params={"session_id": "S2"}).json()
    for a in insp["alerts"]:
        client.post(f"/api/inspections/alerts/{a['alert_id']}/decision", json={"action": "confirm", "examiner_id": "VE011"})
    rep = client.post(f"/api/inspections/{insp['inspection_id']}/report", json={"examiner_id": "VE011"}).json()
    assert rep["verdict"] == "CONDITIONAL"
    d = client.get("/api/floodwatch/vehicles/DMO%209002", params={"scope": "event:2025-12-10"}).json()
    assert d["lane_reports"][0]["verify_token"] == rep["verify_token"] and d["invited_at"]
    p = client.post("/api/usecases/visit", json={"path": "/flood?scope=event%3A2025-12-10&vehicle=DMO+9002"}).json()["active"]
    assert p["complete"]


def test_runtime_reset_clears_the_demo_state():
    from sqlalchemy import select

    from vhi.db import session_scope
    from vhi.seed import reset_runtime
    from vhi.tables import Setting
    with session_scope() as s:
        s.merge(Setting(key="usecase:active", value={"id": "UC-01", "started_at": "2026-01-01T00:00:00", "visits": {}}))
        s.merge(Setting(key="hq_exceptions", value={"chain": {"status": "acknowledged"}}))
    assert reset_runtime()["demo_state"] == 2
    with session_scope() as s:
        assert s.execute(select(Setting).where(Setting.key.in_(("usecase:active", "hq_exceptions")))).first() is None
        assert s.get(Setting, "seed_version") is not None  # the seeded world stays

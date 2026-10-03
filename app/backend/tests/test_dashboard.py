"""The inspector dashboard (today at a hub), the day schedule, the vehicle register and profile, search and the
notification feed."""


def test_today_at_the_hub(client, s1):
    """The demo hub's day is the ten main vehicles on its four lanes; the live replay takes its vehicle's place."""
    d = client.get("/api/hub/today", params={"branch_id": "BR00", "at": "11:00"}).json()
    assert d["branch"]["name"] == "Central Inspection Hub" and d["branch"]["lanes"] == 4
    assert d["clock"]["time"] == "11:00" and d["clock"]["demo"] is True
    k = d["kpis"]
    assert k["total"] == 10 and k["completed"] >= 4 and k["total_prev"] is None
    assert len(d["lanes"]) == 4 and {ln["state"] for ln in d["lanes"]} <= {"operation", "preparing", "idle"}
    u = d["utilization"]
    assert u["operation"] + u["preparing"] + u["idle"] == 4
    assert all(q["wait_min"] >= 1 for q in d["queue"])
    assert d["upcoming"] and all(x["status"] in ("in_queue", "scheduled") for x in d["upcoming"])
    assert d["activity"] and all(a["time"] <= "11:00" or a.get("live") for a in d["activity"])
    # the live replay that ran today is on its lane (or among today's live inspections once reported), once
    assert any(li["inspection_id"] == s1["inspection_id"] for li in d["live"])
    plates = [x["plate"] for x in d["upcoming"]] + [li["plate"] for li in d["live"]]
    assert len(plates) == len(set(plates))
    # every vehicle of the day is one of the ten main vehicles
    from vhi.services.showcase import MAIN_PLATES
    sched = client.get("/api/hub/schedule", params={"branch_id": "BR00", "page_size": 30}).json()
    assert {x["plate"] for x in sched["items"]} <= set(MAIN_PLATES)
    # the same moment reads the same every time
    again = client.get("/api/hub/today", params={"branch_id": "BR00", "at": "11:00"}).json()
    assert [x["plate"] for x in again["upcoming"]] == [x["plate"] for x in d["upcoming"]]


def test_restarting_the_hub_day(client):
    r = client.post("/api/hub/restart").json()
    assert r["anchor"]
    d = client.get("/api/hub/today", params={"branch_id": "BR00"}).json()
    if not d["clock"]["demo"]:  # during opening hours the day starts again from now
        assert d["kpis"]["completed"] >= 4 and d["kpis"]["in_queue"] >= 1


def test_day_schedule_is_paged_and_filtered(client):
    s = client.get("/api/hub/schedule", params={"branch_id": "BR00", "page_size": 4}).json()
    assert s["total"] == 10 and len(s["items"]) == 4 and s["pages"] == 3
    assert sum(s["counts"].values()) == s["total"]
    plate = s["items"][0]["plate"]
    f = client.get("/api/hub/schedule", params={"branch_id": "BR00", "q": plate}).json()
    assert f["total"] >= 1 and all(x["plate"] == plate for x in f["items"])
    # other hubs keep a synthetic day drawn from the whole register
    o = client.get("/api/hub/schedule", params={"branch_id": "BR01", "page_size": 10}).json()
    assert o["total"] == 0 or o["total"] >= 30


def test_vehicle_register_and_profile(client):
    r = client.get("/api/vehicles").json()
    from vhi.services.showcase import MAIN_PLATES
    assert [x["plate"] for x in r["items"]] == MAIN_PLATES and r["counts"]["total"] == 10
    assert all(x["story"] and x["inspections"] >= 1 for x in r["items"])
    assert all(x["health"] for x in r["items"] if x["fleet_id"])
    every = client.get("/api/vehicles", params={"scope": "all", "page_size": 25}).json()
    assert every["counts"]["total"] > 4000 and len(every["items"]) == 25 and every["pages"] > 100
    lorries = client.get("/api/vehicles", params={"scope": "all", "vtype": "Lorry", "page_size": 5}).json()
    assert lorries["counts"]["total"] > 500 and all(x["vtype"] == "Lorry" for x in lorries["items"])
    fails = client.get("/api/vehicles", params={"scope": "all", "result": "FAIL", "page_size": 5}).json()
    assert all(x["latest"]["result"] == "FAIL" for x in fails["items"])
    assert {"Sedan", "Lorry"} <= set(client.get("/api/vehicles/facets").json()["vtypes"])
    p = client.get("/api/vehicles/DMO%209003/profile").json()
    assert p["vehicle"]["make"] == "Honda" and len(p["inspections"]) >= 2 and p["links"]["sale"].startswith("/oversight/sales")
    assert p["odometer"]["rollback"] is True and p["main"]["session"] == "S3" and p["links"]["passport"].startswith("/mobile")
    w = client.get("/api/vehicles/WXD%202291/profile").json()
    assert w["fleet_health"] and w["library"] and len(w["inspections"]) == 2
    assert client.get("/api/vehicles/NOPE%201/profile").status_code == 404


def test_search_and_notifications(client, s1):
    g = client.get("/api/search", params={"q": "DMO 9001"}).json()["groups"]
    names = {x["group"] for x in g}
    assert "Vehicles" in names and "Inspections" in names
    # vehicle search covers the ten main vehicles, by plate, owner, make or model
    myvi = client.get("/api/search", params={"q": "myvi"}).json()["groups"]
    assert [x["title"] for x in myvi[0]["items"]] == ["DMO 9006"]
    assert g[0]["items"][0]["href"].startswith("/")
    assert client.get("/api/search", params={"q": "x"}).json()["groups"] == []
    n = client.get("/api/notifications").json()
    assert isinstance(n, list) and all({"title", "href", "kind"} <= set(x) for x in n)


def test_inspection_checklist_captures_and_preview(client):
    client.post("/api/sessions/S7/start", json={"fast": True})
    d = client.get("/api/inspections/latest", params={"session_id": "S7"}).json()
    c = d["checklist"]
    ids = [i["id"] for i in c["items"]]
    # the lane's ten stations in order, then the final review (a petrol car: Emission, not the EV battery)
    assert ids == ["identification", "above_carriage", "tinted_glass", "emission", "side_slip", "suspension", "brake",
                   "undercarriage", "speedometer", "headlight", "final"]
    assert all(i["status"] == "pass" for i in c["items"][:-1])  # a clean car: every measured item passes
    assert c["items"][-1]["status"] == "review" and c["done"] == c["total"] - 1
    assert d["verdict_preview"] == {"verdict": "PASS", "reasons": [], "open_required": 0, "can_issue": True}
    views = {x["view"]: x for x in d["captures"]}
    assert set(views) == {"front", "rear", "left", "right", "underbody", "interior", "tyre"}
    assert views["tyre"]["image"] and views["front"]["image"] is None
    assert d["owner"]["name"] == "Nurul Aina"


def test_examiner_captures_a_photo_and_records_a_remark(client):
    import io

    from PIL import Image

    from vhi.config import get_settings
    client.post("/api/sessions/S7/start", json={"fast": True})
    iid = client.get("/api/inspections/latest", params={"session_id": "S7"}).json()["inspection_id"]
    tyre = get_settings().data_dir / "images/tyre/defective/tyre_helath_qualit_00231.jpg"
    r = client.post(f"/api/inspections/{iid}/capture", params={"view": "tyre"},
                    files={"file": ("x.html", tyre.read_bytes(), "text/html")}).json()  # the name is never kept
    assert r["image"]["annotated"].endswith(".jpg") and r["image"]["flag"] is True and r["finding"]["code"].startswith("capture:tyre")
    bad = client.post(f"/api/inspections/{iid}/capture", params={"view": "front"}, files={"file": ("a.jpg", b"not an image", "image/jpeg")})
    assert bad.status_code == 400
    assert client.post(f"/api/inspections/{iid}/capture", params={"view": "roof"},
                       files={"file": ("a.jpg", tyre.read_bytes(), "image/jpeg")}).status_code == 400
    d = client.get(f"/api/inspections/{iid}").json()
    assert next(x for x in d["captures"] if x["view"] == "tyre")["source"] == "examiner"
    assert next(i for i in d["checklist"]["items"] if i["id"] == "undercarriage")["status"] == "review"  # the tyre scanner's station
    rm = client.post(f"/api/inspections/{iid}/remark", json={"text": "Customer asked for the tyre to be re-checked"}).json()
    assert rm["remarks"][-1]["text"].startswith("Customer") and rm["remarks"][-1]["chain_seq"] > 0
    _ = io, Image


def test_pass_advisory_fail_and_the_verdict(client):
    client.post("/api/sessions/S1/start", json={"fast": True})
    d = client.get("/api/inspections/latest", params={"session_id": "S1"}).json()
    fails = [a for a in d["alerts"] if a["fail_item"]]
    others = [a for a in d["alerts"] if not a["fail_item"]]
    # passing or downgrading a fail item, or failing an item the rules do not fail, takes a reason
    assert client.post(f"/api/inspections/alerts/{fails[0]['alert_id']}/decision", json={"action": "advisory"}).status_code == 400
    assert client.post(f"/api/inspections/alerts/{others[0]['alert_id']}/decision", json={"action": "fail"}).status_code == 400
    for a in fails:
        r = client.post(f"/api/inspections/alerts/{a['alert_id']}/decision",
                        json={"action": "advisory", "reason": "Repaired on site and re-measured", "recommendation": "Re-test"}).json()
        assert r["status"] == "advisory" and r["evidence"]["recommendation"] == "Re-test"
    for a in others:
        assert client.post(f"/api/inspections/alerts/{a['alert_id']}/decision", json={"action": "advisory"}).json()["status"] == "advisory"
    p = client.get(f"/api/inspections/{d['inspection_id']}").json()["verdict_preview"]
    assert p["verdict"] == "PASS" and p["can_issue"]
    r = client.post(f"/api/inspections/alerts/{others[0]['alert_id']}/decision", json={"action": "fail", "reason": "Unsafe on inspection"}).json()
    assert r["fail_item"] is True and r["status"] == "confirmed"
    p = client.get(f"/api/inspections/{d['inspection_id']}").json()["verdict_preview"]
    assert p["verdict"] == "FAIL"
    rep = client.post(f"/api/inspections/{d['inspection_id']}/report", json={"examiner_id": "VE011"}).json()
    assert rep["verdict"] == "FAIL"
    sent = client.post(f"/api/inspections/{d['inspection_id']}/send-report").json()
    assert sent["channel"] == "mock" and sent["chain_seq"] > 0
    b = client.post(f"/api/inspections/{d['inspection_id']}/reinspection").json()
    assert b["status"] == "confirmed" and b["plate"] == "DMO 9001" and b["source"] == "examiner"

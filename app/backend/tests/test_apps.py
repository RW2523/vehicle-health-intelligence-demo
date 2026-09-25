"""Owner, fleet, HQ, regulator and vision APIs."""
import datetime as dt


def test_owner_booking_gear_and_payment(client):
    t = client.get("/api/owner/inspection-types", params={"selling": True, "buyer_loan": True}).json()
    assert t["recommended"] == ["B5+B7"]
    g = client.get("/api/owner/gear", params={"branch_id": "BR01"}).json()
    assert g["slots"], "GEAR next-day slots should be available"
    b = client.post("/api/owner/bookings", json={"plate": "DMO 9006", "branch_id": "BR01", "date": g["date"],
                                                  "slot": g["slots"][0], "inspection_type": "B5", "gear": True}).json()
    assert b["status"] == "pending_payment" and b["price_rm"] == 70.0
    p = client.post(f"/api/owner/bookings/{b['booking_id']}/pay", json={"method": "FPX"}).json()
    assert p["status"] == "confirmed" and p["payment_ref"].startswith("FPX-")
    # the same GEAR slot cannot be sold twice
    again = client.post("/api/owner/bookings", json={"plate": "DMO 9006", "branch_id": "BR01", "date": g["date"],
                                                      "slot": g["slots"][0], "inspection_type": "B5", "gear": True})
    assert again.status_code == 409
    assert client.get(f"/api/owner/checkin/{p['checkin_token']}").json()["booking_id"] == b["booking_id"]


def test_assistant_three_languages(client):
    import uuid
    t1, t2, t3 = (f"t{i}-{uuid.uuid4().hex[:8]}" for i in range(3))
    bm = client.post("/api/owner/assistant", json={"conversation": t1, "text": "Saya nak jual kereta, pemeriksaan apa yang saya perlu?"}).json()
    assert bm["lang"] == "ms" and "B5" in bm["answer"]
    slot = client.post("/api/owner/assistant", json={"conversation": t1, "text": "Ada slot esok di Glenmarie?"}).json()
    assert slot["tool"]["name"] == "gear_slots" and slot["tool"]["branch"] == "Glenmarie"
    zh = client.post("/api/owner/assistant", json={"conversation": t2, "text": "电动车怎么检验？"}).json()
    assert zh["lang"] == "zh" and "电" in zh["answer"]
    en = client.post("/api/owner/assistant", json={"conversation": t3, "text": "What is the window tint limit?"}).json()
    assert en["lang"] == "en" and "70%" in en["answer"]
    assert len(client.get(f"/api/owner/assistant/{t1}").json()) == 4


def test_self_check_then_passport(client):
    script = client.get("/api/owner/self-check/script").json()
    a1 = client.post("/api/owner/self-check", json={"plate": script["plate"], **script["first_attempt"]}).json()
    assert a1["verdict"] == "Fix these first"
    failed = {i["item"] for i in a1["items"] if not i["ok"]}
    assert "Window tint" in failed and "Headlamp (left)" in failed
    assert any(i["source"].startswith("live model") for i in a1["items"])
    a2 = client.post("/api/owner/self-check", json={"plate": script["plate"], **script["second_attempt"]}).json()
    assert a2["verdict"] == "Likely to pass"
    pp = client.get(f"/api/owner/passport/{script['plate']}").json()
    kinds = [e["kind"] for e in pp["events"]]
    assert kinds.count("self_check") >= 2 and "inspection" in kinds


def test_fleet_overview_and_vehicle(client):
    o = client.get("/api/fleet/overview").json()
    assert o["total"] == 165 + 44  # FLEET07 includes the S1 prime mover DMO 9001
    plates = {r["plate"]: r for r in o["attention"]}
    for p in ["VKR 3128", "WXD 2291", "JTR 5510", "BHY 7783", "BPR 7730", "PKE 4410"]:
        assert p in plates, p
    assert plates["VKR 3128"]["issue"]["risk"] == "High"
    assert plates["BPR 7730"]["issue"]["pattern"] == "New damage, growing"
    assert o["next_berkala"]["fleet_id"] == "FLEET07" and o["next_berkala"]["at_risk"] > 0
    f = client.get("/api/fleet/overview", params={"fleet_id": "OP-LPC"}).json()
    assert f["total"] == 38 and all(r["operator"] == "Lembah Parcel Co." for r in f["attention"])
    d = client.get("/api/fleet/vehicles/WXD 2291").json()
    assert d["primary"]["metric"] == "tread_depth" and len(d["photos"]) == 3
    assert any(a["kind"] == "rate_change" for a in d["primary"]["anomalies"])
    assert d["primary"]["forecast"]["weeks_to_limit"] < 8
    rep = client.post("/api/fleet/vehicles/WXD 2291/report").json()
    assert rep["sent_at"] and "WXD 2291" in rep["text"]


def test_fleet_bulk_booking_and_api(client):
    bk = client.post("/api/fleet/bookings", json={"plates": ["VKR 3128", "JTR 5510"]}).json()
    assert all(b.get("status") == "confirmed" for b in bk)
    fc = dt.date.fromisoformat(client.get("/api/fleet/vehicles/VKR 3128").json()["primary"]["forecast"]["date"])
    assert dt.date.fromisoformat(bk[0]["date"]) <= fc
    keys = {k["fleet_id"]: k["api_key"] for k in client.get("/api/fleet/keys").json()}
    assert client.get("/api/fleet/v1/vehicles").status_code == 401
    assert client.get("/api/fleet/v1/vehicles", headers={"X-API-Key": "nope"}).status_code == 403
    v = client.get("/api/fleet/v1/vehicles", headers={"X-API-Key": keys["OP-SMR"]}).json()
    assert v["fleet_id"] == "OP-SMR" and len(v["vehicles"]) == 48
    bad = client.post("/api/fleet/v1/bookings", json={"plates": ["WXD 2291"]}, headers={"X-API-Key": keys["OP-SMR"]})
    assert bad.status_code == 403


def test_hq(client):
    integ = client.get("/api/hq/integrity").json()
    assert {"VE017", "VE044"} <= set(integ["flagged"])
    eq = client.get("/api/hq/equipment").json()["devices"]
    worst = eq[0]
    assert (worst["branch_id"], worst["lane"], worst["device"]) == ("BR00", 3, "roller_brake_tester")
    dm = client.get("/api/hq/demand", params={"branch_id": "BR00"}).json()
    assert len(dm["forecast"]) == 14 and dm["summary"]["days_over_capacity"] >= 0
    au = client.get("/api/hq/audit").json()
    assert au["verify"]["intact"] is True


def test_regulator(client):
    r = client.get("/api/regulator").json()
    assert r["registrations"]["total"] == 1629552
    assert len(r["defects"]["monthly"]) == 12 and r["remote_sensing"]["high_emitters"] > 0
    assert r["web"]["mode"] in ("snapshot", "live")


def test_vision(client):
    caps = client.get("/api/vision/captures").json()["cases"]
    assert len(caps) == 22
    tyre = next(c for c in caps if "tyres" in c["cats"])
    r = client.post("/api/vision/analyse", json={"task": "tyre", "capture_id": tyre["id"]}).json()
    assert r["result"]["available"] and r["annotated_url"].startswith("/media/evidence/")
    s = client.get("/api/vision/samples").json()
    pl = client.post("/api/vision/analyse", json={"task": "plate", "data_path": s["plate"][2]}).json()
    assert pl["result"]["plate"] == "QTD 6957"
    img = client.get(caps[0]["original_url"])
    up = client.post("/api/vision/upload", params={"task": "damage"}, files={"file": ("x.jpg", img.content, "image/jpeg")})
    assert up.status_code == 200 and up.json()["result"]["class"] in ("normal", "breakage", "crushed")

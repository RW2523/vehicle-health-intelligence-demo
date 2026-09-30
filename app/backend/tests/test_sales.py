"""Used-vehicle sales: the listings (cars and the synthetic motorcycles) and each vehicle's whole record."""

BIKE_CHECKS = {"brake_efficiency_pct", "tyre_tread_min_mm", "headlamp_aim_dev_pct", "co_pct", "hc_ppm"}
CAR_ONLY = {"suspension_efficiency_pct", "side_slip_m_per_km", "tint_vlt_front_pct", "brake_imbalance_pct"}


def listing(client, plate: str) -> dict:
    rows = client.get("/api/sales", params={"q": plate}).json()["listings"]
    assert [r["plate"] for r in rows] == [plate]
    return client.get(f"/api/sales/{rows[0]['listing_id']}").json()


def test_listings_and_filters(client):
    d = client.get("/api/sales").json()
    assert d["total"] == len(d["listings"]) == 55
    assert d["counts"]["car"] == 40 and d["counts"]["motorcycle"] == 15
    for flag in ("rollback", "flood", "failed", "obd", "clean"):
        assert d["counts"][flag] > 0, flag
    r = d["listings"][0]
    assert {"inspections", "last_result", "last_date", "health", "odometer_ok", "flood_claims", "accident_claims",
            "open_obd"} <= set(r["badges"])
    assert r["trust"]["level"] in ("ok", "warn", "bad") and r["headline"]
    assert "owner_name" not in r

    bikes = client.get("/api/sales", params={"kind": "motorcycle"}).json()["listings"]
    assert len(bikes) == 15 and all(b["vtype"] == "Motorcycle" and b["badges"]["health"] is None for b in bikes)
    assert all(1 <= b["badges"]["inspections"] <= 4 for b in bikes)
    cheap = client.get("/api/sales", params={"max_price": 5000}).json()["listings"]
    assert cheap and all(x["asking_price_rm"] <= 5000 for x in cheap)
    kl = client.get("/api/sales", params={"state": "Selangor", "kind": "car"}).json()["listings"]
    assert kl and all(x["state"] == "Selangor" and x["kind"] == "car" for x in kl)
    rollback = client.get("/api/sales", params={"flag": "rollback"}).json()["listings"]
    assert "DMO 9003" in {x["plate"] for x in rollback} and not any(x["badges"]["odometer_ok"] for x in rollback)
    assert {"car", "motorcycle"} == {x["kind"] for x in rollback}
    assert client.get("/api/sales", params={"flag": "nope"}).status_code == 400
    assert client.get("/api/sales/LS9999").status_code == 404


def test_seed_fills_once_and_rebuilds_the_same_listings(client):
    from vhi.seed.sales import seed_sales
    from vhi.db import session_scope
    from vhi.tables import Listing
    from sqlalchemy import delete

    def snapshot():
        return [(r["listing_id"], r["plate"], r["asking_price_rm"], r["seller"]) for r in client.get("/api/sales").json()["listings"]]

    before = snapshot()
    assert seed_sales() is False  # listings exist: nothing to do
    with session_scope() as s:
        s.execute(delete(Listing))
    assert seed_sales() is True
    assert snapshot() == before  # deterministic, and the motorcycles' history is not duplicated
    assert len(client.get("/api/sales", params={"kind": "motorcycle"}).json()["listings"]) == 15


def test_car_dossier_end_to_end(client, s3):
    """DMO 9003 (session S3) is sold with a rolled-back odometer; its lane report sits in the same timeline."""
    if not client.get("/api/reports", params={"plate": "DMO 9003"}).json():
        for a in s3["alerts"]:
            client.post(f"/api/inspections/alerts/{a['alert_id']}/decision", json={"action": "confirm", "examiner_id": "VE001"})
        client.post(f"/api/inspections/{s3['inspection_id']}/route-senior", json={"examiner_id": "VE012", "senior_id": "VE001"})
        rep = client.post(f"/api/inspections/{s3['inspection_id']}/report", json={"examiner_id": "VE001", "senior_signed": True})
        assert rep.status_code == 200, rep.text
    d = listing(client, "DMO 9003")
    ins = d["inspections"]
    assert [i["date"] for i in ins] == sorted(i["date"] for i in ins)
    assert [i["source"] for i in ins][:2] == ["history", "history"] and ins[-1]["source"] == "lane"
    assert all(isinstance(i["health"], int) for i in ins)  # history scored by the health model, the lane by the lane
    lane = ins[-1]
    assert lane["report"]["verify_url"].endswith("/verify/" + lane["report"]["verify_token"])
    assert d["report"]["report_id"] == lane["report"]["report_id"]
    assert lane["images"] and d["images"]["count"] >= len(lane["images"])
    assert d["health"]["model"] and 0 <= d["health"]["next_fail"]["p_fail_next"] <= 1
    odo = d["odometer"]
    assert not odo["consistent"] and odo["max_recorded_km"] == 182900 and odo["advertised_km"] == 96400
    assert max(e["drop_km"] for e in odo["rollbacks"]) == 86500
    assert d["trust"]["level"] == "bad" and "rollback" in d["trust"]["flags"]
    assert any("Odometer rollback" in p["text"] for p in d["trust"]["points"])
    assert "owner_name" not in d["vehicle"] and d["vehicle"]["chassis_no"]


def test_flood_claim_and_fault_codes_are_on_the_record(client):
    flood = client.get("/api/sales", params={"flag": "flood", "kind": "car"}).json()["listings"]
    d = client.get(f"/api/sales/{flood[0]['listing_id']}").json()
    assert any(c["type"] == "flood_natural_disaster" for c in d["claims"])
    assert any(p["level"] == "bad" and p["text"].startswith("Flood claim") for p in d["trust"]["points"])
    obd = client.get("/api/sales", params={"flag": "obd"}).json()["listings"]
    d = client.get(f"/api/sales/{obd[0]['listing_id']}").json()
    assert d["obd"]["latest"]["dtcs"] and all(x["code"] and x["description"] for x in d["obd"]["latest"]["dtcs"])
    assert obd[0]["badges"]["open_obd"] == [x["code"] for x in d["obd"]["latest"]["dtcs"]]


def test_motorcycle_dossier(client):
    bikes = client.get("/api/sales", params={"kind": "motorcycle"}).json()["listings"]
    for b in bikes:
        d = client.get(f"/api/sales/{b['listing_id']}").json()
        assert d["vehicle"]["vtype"] == "Motorcycle" and d["health"]["latest"] is None and "car, van, lorry and bus" in d["health"]["note"]
        assert d["images"]["count"] == 0  # no motorcycle photos in the curated data: the apps show a placeholder
        for i in d["inspections"]:
            keys = {m["key"] for m in i["measures"]}
            assert BIKE_CHECKS <= keys and not keys & CAR_ONLY
            assert i["type"] in ("B5_MV15", "voluntary") and i["odometer_km"] > 0
        if not d["obd"]["supported"]:
            assert "Carburettor" in d["obd"]["note"]
    rolled = [b for b in bikes if "rollback" in b["trust"]["flags"]]
    failed = [b for b in bikes if b["badges"]["last_result"] == "FAIL"]
    assert len(rolled) == 1 and len(failed) == 1
    assert any(b["badges"]["open_obd"] == ["P0122"] for b in bikes)


def test_ex_fleet_car_with_photos(client):
    d = listing(client, "VJM 3287")
    assert d["images"]["photo"] and "i7" in {e["id"] for e in d["images"]["library"]}
    assert d["listing"]["seller"] == "dealer" and len(d["inspections"]) == 3
    assert d["odometer"]["consistent"]

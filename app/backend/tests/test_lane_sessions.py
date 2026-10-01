"""End-to-end: scripted lane sessions S1-S3 through player -> bus -> processor -> models -> alerts -> fusion ->
examiner decisions -> report -> public verify."""
from vhi.config import get_settings


def codes(insp):
    return {a["code"] for a in insp["alerts"]}


def test_s1_tampered_diesel(s1):
    assert s1["status"] == "review"
    c = codes(s1)
    assert "pn:high" in c                        # DPF removal caught by PN although opacity passes
    assert {"dtc:P2002", "dtc:P20EE", "dtc:P2BAD"} <= c
    # the e-nose is a future R&D sensor: its preview still sees the NH3 slip, but it raises no alert
    assert not any(x.startswith("enose:") for x in c)
    assert s1["results"]["enose"]["rnd"] is True
    assert "nh3_slip_scr" in {e["condition"] for e in s1["results"]["enose"]["events"]}
    assert "thermal:A2R" in c                     # dragging brake on axle 2 right
    # every image result names the AI module that found it
    tyre = next(a for a in s1["alerts"] if a["code"] == "tyre:defect")
    assert tyre["source"] == "live_model" and tyre["detail"].startswith("Tyre AI:")
    assert {im["system"] for im in s1["results"]["images"]} == {"undercarriage", "tyre"}
    assert "acoustic:wheel_bearing_or_suspension" in c
    assert s1["results"]["instruments"]["smoke_opacity_pct"]["verdict"] == "pass"
    assert s1["results"]["pn"]["opacity_misleading"] is True
    assert s1["results"]["anpr"]["plate"] == "DMO 9001"          # live OCR on the lane plate image
    assert s1["results"]["chassis"]["match"] is True
    assert 20 <= s1["health_score"] <= 60
    assert s1["route"] == "normal"
    ranks = [a["rank"] for a in s1["alerts"]]
    assert sorted(ranks) == list(range(1, len(ranks) + 1))
    assert s1["alerts"][0]["fail_item"] is True


def test_s2_flooded_ev(s2):
    c = codes(s2)
    assert "flood" in c and "ev:hv_isolation" in c and not any(x.startswith("enose:") for x in c)
    assert "e-nose" not in " ".join(s2["fusion"]["flood"]["signals"])
    assert s2["fusion"]["flood"]["p"] >= 0.8
    assert 60 <= s2["results"]["ev"]["pack_soh_pct"] <= 75
    assert s2["results"]["adas"]["status"] == "advisory only"


def test_s3_identity(s3):
    c = codes(s3)
    assert "identity:odometer" in c and "identity:engine" in c and "route:senior" in c
    assert s3["route"] == "senior"
    assert s3["results"]["odometer"]["rollback_km"] == 86500
    fp = next(a["fingerprint"] for a in s3["results"]["acoustic"] if a.get("fingerprint"))
    assert fp["engine_changed"] is True and fp["similarity"] < fp["threshold"]
    assert s3["results"]["chassis"]["match"] is True
    assert "body:damage" in c
    # a good health score and the next-inspection risk tell one story: the risk is read against vehicles of the same
    # age that pass today, and its main reason (here age) is named
    nf = s3["fusion"]["next_fail"]
    assert s3["health_score"] >= 90 and abs(nf["p_fail_next"] - nf["peer_rate"]) < 0.1
    assert nf["peer"] == "vehicles 10-12 years old that pass today" and nf["drivers"][0]["label"] == "Vehicle age"
    assert "Heavy vehicle" not in {d["label"] for d in nf["drivers"]}
    body = next(a for a in s3["alerts"] if a["code"] == "body:damage")
    assert body["source"] == "live_model" and body["detail"].startswith("Above-carriage AI:")


def test_report_requires_decisions_then_verifies(client, s1):
    iid = s1["inspection_id"]
    r = client.post(f"/api/inspections/{iid}/report", json={"examiner_id": "VE012"})
    assert r.status_code == 409  # open high alerts
    # dismiss needs a reason
    first = s1["alerts"][0]
    assert client.post(f"/api/inspections/alerts/{first['alert_id']}/decision",
                       json={"action": "dismiss", "reason": ""}).status_code == 400
    for a in s1["alerts"]:
        action = "defer" if a["code"].startswith("acoustic") else "confirm"
        r = client.post(f"/api/inspections/alerts/{a['alert_id']}/decision",
                        json={"action": action, "reason": "re-check on the next visit" if action == "defer" else "", "examiner_id": "VE012"})
        assert r.status_code == 200, r.text
    rep = client.post(f"/api/inspections/{iid}/report", json={"examiner_id": "VE012"}).json()
    assert rep["verdict"] == "FAIL"
    assert rep["summary"] and (rep["summary_source"] == "template" or ":" in rep["summary_source"])  # engine:model
    v = client.get(f"/api/verify/{rep['verify_token']}").json()
    assert v["valid"] is True and v["verdict"] == "FAIL" and v["chain"]["anchored"]
    qr = client.get(f"/api/reports/{rep['report_id']}/qr.svg")
    assert qr.status_code == 200 and b"<svg" in qr.content
    # the verify link follows the address the visitor used (forwarded by the web server or a tunnel)
    fwd = {"x-forwarded-host": "demo.trycloudflare.com", "x-forwarded-proto": "https"}
    assert client.get(f"/api/reports/{rep['report_id']}", headers=fwd).json()["verify_url"] == \
        f"https://demo.trycloudflare.com/verify/{rep['verify_token']}"
    assert rep["verify_url"] == f"{get_settings().public_base_url}/verify/{rep['verify_token']}"
    # decisions are locked after the report
    assert client.post(f"/api/inspections/alerts/{first['alert_id']}/decision",
                       json={"action": "dismiss", "reason": "late change"}).status_code == 409


def test_ev_conditional_certificate(client, s2):
    for a in s2["alerts"]:
        client.post(f"/api/inspections/alerts/{a['alert_id']}/decision", json={"action": "confirm", "examiner_id": "VE020"})
    rep = client.post(f"/api/inspections/{s2['inspection_id']}/report", json={"examiner_id": "VE020"}).json()
    assert rep["verdict"] == "CONDITIONAL"
    assert rep["data"]["ev"]["pack_soh_pct"] > 0


def test_s3_referred_until_senior_signs(client, s3):
    for a in s3["alerts"]:
        client.post(f"/api/inspections/alerts/{a['alert_id']}/decision", json={"action": "confirm", "examiner_id": "VE012"})
    r = client.post(f"/api/inspections/{s3['inspection_id']}/route-senior", json={"examiner_id": "VE012", "senior_id": "VE001"})
    assert r.json()["route"] == "senior"
    # a non-senior examiner cannot sign off the identity flags, even when the request claims a senior sign-off
    rep = client.post(f"/api/inspections/{s3['inspection_id']}/report", json={"examiner_id": "VE012", "senior_signed": True}).json()
    assert rep["verdict"] == "REFERRED" and rep["data"]["examiner"]["senior"] is False


def test_evidence_chain_and_tamper_detection(client, s1):
    v = client.get("/api/evidence/verify").json()
    assert v["intact"] is True and v["total"] > 20
    t = client.post("/api/evidence/tamper-test").json()
    assert t["ran"] and t["detected"] is True
    assert t["verify_after_restore"]["intact"] is True
    ents = client.get("/api/evidence", params={"inspection_id": s1["inspection_id"]}).json()
    kinds = {e["kind"] for e in ents}
    assert {"inspection_started", "anpr", "alert_raised", "fusion", "decision", "report_issued"} <= kinds


def test_readings_stored(client, s1):
    import time
    time.sleep(1.5)  # readings are flushed to the database every second
    en = client.get(f"/api/inspections/{s1['inspection_id']}/readings", params={"sensor": "enose"}).json()
    assert len(en) > 500 and len(en[0]["ch"]) == 16


def test_enose_as_a_live_sensor_when_switched_on(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "enose_in_results", True)
    assert client.post("/api/sessions/S1/start", json={"fast": True}).status_code == 200
    s1 = client.get("/api/inspections/latest", params={"session_id": "S1"}).json()
    assert "enose:nh3_slip_scr" in codes(s1)
    assert any(r["rule"].startswith("E-nose") for r in s1["fusion"]["health"]["rules"])


def test_petrol_exhaust_gas_test_shows_lambda_with_co_and_hc(client, s3):
    ins = s3["results"]["instruments"]
    assert {"co_pct", "hc_ppm", "lambda"} <= set(ins)
    assert ins["lambda"]["value"] == 1.01 and ins["lambda"]["verdict"] == "pass" and ins["lambda"]["limit"] == "0.97-1.03"
    # a rich mixture fails the test and reaches the examiner as a fail item
    assert client.post("/api/sessions/S3/start", json={"fast": True, "overrides": {"instrument.lambda": 0.92}}).status_code == 200
    rich = client.get("/api/inspections/latest", params={"session_id": "S3"}).json()
    lam = next(a for a in rich["alerts"] if a["code"] == "emissions:lambda")
    assert lam["fail_item"] and "rich" in lam["detail"]
    # past petrol inspections carry lambda too (derived from their CO and HC)
    hist = client.get("/api/vehicles/DMO 9006/history").json()
    assert any(h.get("lambda") for h in (hist.get("inspections") if isinstance(hist, dict) else hist))


def test_s7_clean_inspection_passes(client, s7):
    """UC-04: a healthy car goes through every lane step with nothing to decide, and passes."""
    assert s7["status"] == "review" and s7["plate"] == "DMO 9006"
    assert s7["alerts"] == [], [a["title"] for a in s7["alerts"]]
    assert s7["health_score"] >= 70 and s7["route"] == "normal"
    assert s7["results"]["brakes"]["verdict"] == "pass"
    assert all(i["verdict"] == "pass" for i in s7["results"]["instruments"].values())
    assert {im["system"] for im in s7["results"]["images"]} == {"tyre", "above"}
    rep = client.post(f"/api/inspections/{s7['inspection_id']}/report", json={"examiner_id": "VE011"}).json()
    assert rep["verdict"] == "PASS" and rep["data"]["findings"] == []
    passport = client.get("/api/owner/passport/DMO%209006").json()
    assert passport["latest"]["result"] == "PASS" and passport["latest"]["verify_token"] == rep["verify_token"]

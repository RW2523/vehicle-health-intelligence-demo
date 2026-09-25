"""End-to-end: scripted lane sessions S1-S3 through player -> bus -> processor -> models -> alerts -> fusion ->
examiner decisions -> report -> public verify."""


def codes(insp):
    return {a["code"] for a in insp["alerts"]}


def test_s1_tampered_diesel(s1):
    assert s1["status"] == "review"
    c = codes(s1)
    assert "pn:high" in c                        # DPF removal caught by PN although opacity passes
    assert {"dtc:P2002", "dtc:P20EE", "dtc:P2BAD"} <= c
    assert "enose:nh3_slip_scr" in c              # e-nose picks up NH3 slip
    assert "thermal:A2R" in c                     # dragging brake on axle 2 right
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
    assert "flood" in c and "enose:ev_electrolyte_offgas" in c and "ev:hv_isolation" in c
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
    assert rep["summary"] and rep["summary_source"] in ("template",) or rep["summary_source"].startswith("ollama")
    v = client.get(f"/api/verify/{rep['verify_token']}").json()
    assert v["valid"] is True and v["verdict"] == "FAIL" and v["chain"]["anchored"]
    qr = client.get(f"/api/reports/{rep['report_id']}/qr.svg")
    assert qr.status_code == 200 and b"<svg" in qr.content
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

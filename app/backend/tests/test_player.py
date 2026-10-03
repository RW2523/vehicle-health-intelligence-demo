"""Presenter controls: live playback, pause, speed, seek, value overrides changing the outcome."""
import time


def test_live_playback_controls(client):
    st = client.post("/api/sessions/S3/start", json={"speed": 8}).json()
    assert st["status"] == "playing" and st["lane_id"] == "BR00-L1"
    time.sleep(1.2)
    st = client.post("/api/sessions/S3/pause").json()
    assert st["status"] == "paused" and st["t"] > 1
    t_paused = st["t"]
    time.sleep(1.0)
    assert client.get("/api/sessions/S3").json()["player"]["t"] == t_paused
    st = client.post("/api/sessions/S3/speed", json={"speed": 16}).json()
    assert st["speed"] == 16
    st = client.post("/api/sessions/S3/seek", json={"step": "brake_roller"}).json()
    assert st["step"] == "brake_roller" and st["t"] >= 240  # station 7 of the lane
    st = client.post("/api/sessions/S3/resume").json()
    assert st["status"] == "playing"
    t_resumed = st["t"]
    time.sleep(0.3)
    # the time spent paused must not be played on resume (0.3 s at 16x plus a tick or two, not the whole pause)
    assert client.get("/api/sessions/S3").json()["player"]["t"] - t_resumed < 0.3 * 16 + 8
    client.post("/api/sessions/S3/stop")


def test_override_changes_result(client):
    # S1 with the DPF refitted (PN x0.05): the PN alert must disappear, everything else still runs
    preset = next(p for p in client.get("/api/sessions").json()[0]["presets"] if p["id"] == "dpf_refitted")
    r = client.post("/api/sessions/S1/start", json={"fast": True, "overrides": preset["overrides"]})
    assert r.status_code == 200
    insp = client.get("/api/inspections/latest", params={"session_id": "S1"}).json()
    codes = {a["code"] for a in insp["alerts"]}
    assert "pn:high" not in codes and "dtc:P2002" in codes
    assert insp["results"]["pn"]["verdict"] == "pass"


def test_catalogue(client):
    cat = client.get("/api/sessions").json()
    assert [c["session_id"] for c in cat] == ["S1", "S2", "S3", "S7", "S4", "S5", "S6"]
    assert [c["lane_id"] for c in cat if c["kind"] == "lane"] == ["BR00-L3", "BR00-L2", "BR00-L1", "BR00-L4"]
    assert client.post("/api/sessions/S6/start", json={}).status_code == 404  # S6 is an app journey, not a lane


def test_status(client):
    s = client.get("/api/system/status").json()
    assert s["bus"]["published"] > 0 and s["processor"]["model_calls"] > 0
    keys = {m["key"] for m in s["models"] if m["ready"]}
    assert {"tyre", "damage", "enose", "acoustic", "fusion", "demand"} <= keys


def test_the_lane_runs_in_station_order(client):
    """Every replay follows the lane's ten stations in order (vhi/lane.py), each instrument is read at its own station,
    and the speedometer is checked against its tolerance."""
    from vhi import lane
    from vhi.sim.player import build_events

    win = {s: (a, b) for s, a, b in lane.TIMELINE}
    for sid in ("S1", "S2", "S3", "S7"):
        meta, ev = build_events(sid)
        assert [x["step"] for x in meta["lane_timeline"]] == lane.STEPS
        assert [e.payload["step"] for e in ev if e.sensor == "step"] == lane.STEPS + ["done"]
        at = {e.payload["field"]: e.t for e in ev if e.sensor == "instrument"}
        for field, step in (("tint_vlt_pct", "tinted_glass"), ("side_slip_m_per_km", "side_slip"), ("suspension_eff_pct", "suspension"),
                            ("speedo_kmh_at_40", "speedometer"), ("headlamp_dev_pct", "headlight_alignment")):
            assert win[step][0] <= at[field] < win[step][1], (sid, field)
    assert [s[1] for s in lane.STATIONS] == ["Identification", "Above-carriage", "Tinted glass", "Emission", "Side slip", "Suspension",
                                             "Brake", "Undercarriage", "Speedometer", "Headlight alignment"]
    client.post("/api/sessions/S7/start", json={"fast": True})
    d = client.get("/api/inspections/latest", params={"session_id": "S7"}).json()
    sp = d["results"]["instruments"]["speedo_kmh_at_40"]
    assert sp["value"] == 42 and sp["verdict"] == "pass" and sp["limit"] == "40-48"

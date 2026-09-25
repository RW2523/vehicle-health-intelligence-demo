"""Presenter controls: live playback, pause, speed, seek, value overrides changing the outcome."""
import time


def test_live_playback_controls(client):
    st = client.post("/api/sessions/S3/start", json={"speed": 8}).json()
    assert st["status"] == "playing" and st["lane_id"] == "BR02-L1"
    time.sleep(1.2)
    st = client.post("/api/sessions/S3/pause").json()
    assert st["status"] == "paused" and st["t"] > 1
    t_paused = st["t"]
    time.sleep(0.6)
    assert client.get("/api/sessions/S3").json()["player"]["t"] == t_paused
    st = client.post("/api/sessions/S3/speed", json={"speed": 16}).json()
    assert st["speed"] == 16
    st = client.post("/api/sessions/S3/seek", json={"step": "brake_roller"}).json()
    assert st["step"] == "brake_roller" and st["t"] >= 130
    st = client.post("/api/sessions/S3/resume").json()
    assert st["status"] == "playing"
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
    assert [c["session_id"] for c in cat] == ["S1", "S2", "S3", "S4", "S5", "S6"]
    assert client.post("/api/sessions/S6/start", json={}).status_code == 404  # S6 is an app journey, not a lane


def test_status(client):
    s = client.get("/api/system/status").json()
    assert s["bus"]["published"] > 0 and s["processor"]["model_calls"] > 0
    keys = {m["key"] for m in s["models"] if m["ready"]}
    assert {"tyre", "damage", "enose", "acoustic", "fusion", "demand"} <= keys

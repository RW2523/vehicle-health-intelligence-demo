"""Flood watch: reading the JPS tables, station status rules, the synthetic districts, the risk ranking and the mock
invitations. Nothing here reaches the JPS site: the fetcher is replaced by one that fails, or by pages rendered in
the JPS markup from the committed snapshot."""
import datetime as dt
import json
import re
from zoneinfo import ZoneInfo

import pytest

from vhi.config import get_settings
from vhi.services import floodwatch, jps

LEVELS = """<tbody>
    </tr></tr><tr  class='item'><td data-th='No'>1</td><td data-th='Station ID'>3516424</td><td data-th='Station Name'>Sg. Selangor di Ampang Pecah</td><td data-th='District'>Hulu Selangor</td><td data-th='Main Basin (mm)'>Sungai Selangor</td><td data-th='Sub River Basin (mm)'>Sg. Selangor</td><td data-th='Last Update'>01/10/2026 00:45</td><td data-th='wl'>
          <a href='/index.php/wl-graph/?stationid=3516025_' id='wl' target='_blank'>
          50.24</a></td><td data-th='Normal'>50.10</td><td data-th='Alert'>51.30</td><td data-th='Warning'>51.60</td><td data-th='Danger'>51.90</td></tr></tr></tr>"""
RAIN = """<th style='background-color:#aed9e5;'>25/09/2026</th><th style='x'>26/09/2026</th><th style='x'>27/09/2026</th>
<th style='x'>28/09/2026</th><th style='x'>29/09/2026</th><th style='x'>30/09/2026</th></tr>
<th rowspan='2'>Rainfall from Midnight (01/10/2026)</th><tbody><tr></tr></tr><td data-th='No'>2</td><td data-th='Station ID'>0232371RF</td><td>SMK SS 17 (F2)</td><td>Petaling</td><td>30/09/2026 16:15:00</td><td>0.0</td><td>45.5</td><td>2.0</td><td>0.0</td><td>-9999.0</td><td>33.0</td><td><a href='/index.php/rf-graph/?stationid=27395' target='_blank'>0.5</a></td><td class='info'>0.5</td></tr>"""


def test_parsers_read_the_jps_tables():
    (s,) = jps.parse_levels(LEVELS, "SEL")
    assert s["id"] == s["graph"] == "3516025_" and s["station_no"] == "3516424" and s["state"] == "Selangor"
    assert s["level"] == 50.24 and (s["alert"], s["warning"], s["danger"]) == (51.3, 51.6, 51.9)
    assert s["updated"] == "2026-10-01T00:45"
    (g,) = jps.parse_rain(RAIN, "SEL")
    assert g["district"] == "Petaling" and g["hour"] == 0.5
    assert g["daily"]["2026-09-26"] == 45.5 and g["daily"]["2026-09-29"] is None
    assert g["daily"]["2026-10-01"] is None  # last report on 30 Sep: its "since midnight" is 30 Sep's rain, not today's
    (d,) = jps.rain_by_district([g])
    assert d["max_mm"] == 45.5 and d["max_day"] == "2026-09-26" and d["max_gauge"] == "SMK SS 17 (F2)"


def test_station_status_rules():
    at = dt.datetime(2026, 10, 1, 1, 20)
    base = {"normal": 50.1, "alert": 51.3, "warning": 51.6, "danger": 51.9, "updated": "2026-10-01T01:00"}
    status = lambda **kw: floodwatch.classify({**base, **kw}, at)["status"]  # noqa: E731
    assert status(level=50.24) == "normal"
    assert status(level=51.4) == "alert"
    assert status(level=51.7) == "warning"
    assert status(level=52.0) == "danger"
    assert status(level=0.0) == "no_reading"  # 0.00 under a positive normal level is a missing reading, not "normal"
    assert status(level=None) == "no_reading"
    assert status(level=52.0, updated="2026-09-28T10:00") == "no_reading"  # stale
    assert floodwatch.classify({"level": 3.1, "normal": None, "alert": None, "warning": None, "danger": None,
                                "updated": "2026-10-01T01:00"}, at)["status"] == "no_thresholds"
    c = floodwatch.classify({**base, "level": 52.2}, at)
    assert c["to_danger_m"] == -0.3 and c["over"] > 1


def test_every_vehicle_has_a_synthetic_district(client):
    from sqlalchemy import func, select

    from vhi.db import session_scope
    from vhi.seed.floodwatch import DISTRICTS, place, seed_vehicle_locations
    from vhi.tables import Vehicle, VehicleLocation

    with session_scope() as s:
        n = s.execute(select(func.count()).select_from(Vehicle)).scalar()
        locs = s.execute(select(VehicleLocation)).scalars().all()
        assert len(locs) == n
        assert all(loc.district in DISTRICTS[loc.state] for loc in locs)
        fv = s.get(VehicleLocation, "FV0001")  # a showcase-fleet car (no state of its own): its fleet's home branch
        assert (fv.state, fv.district) == ("W.P. Kuala Lumpur", "Kuala Lumpur")
    assert seed_vehicle_locations() == 0  # idempotent
    assert place("V00042", "Selangor") == place("V00042", "Selangor")  # deterministic


def _myt_now() -> dt.datetime:
    return dt.datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).replace(tzinfo=None)


def _snapshot() -> dict:
    return json.loads((get_settings().assets_dir / "web_snapshots" / jps.SNAPSHOT).read_text())


FLOODED = {}  # the station the fake site puts at DANGER


def _levels_page(rows: list[dict]) -> str:
    n = lambda v: "" if v is None else f"{v:.2f}"  # noqa: E731
    out = []
    for i, s in enumerate(rows, 1):
        t = dt.datetime.fromisoformat(s["updated"]).strftime("%d/%m/%Y %H:%M") if s["updated"] else ""
        link = f"<a href='/index.php/wl-graph/?stationid={s['graph']}' id='wl'>{n(s['level'])}</a>" if s["graph"] else n(s["level"])
        out.append(f"<tr  class='item'><td data-th='No'>{i}</td><td data-th='Station ID'>{s['id']}</td>"
                   f"<td data-th='Station Name'>{s['name']}</td><td data-th='District'>{s['district']}</td>"
                   f"<td data-th='Main Basin (mm)'>{s['basin']}</td><td data-th='Sub River Basin (mm)'>{s['river']}</td>"
                   f"<td data-th='Last Update'>{t}</td><td data-th='wl'>{link}</td><td data-th='Normal'>{n(s['normal'])}</td>"
                   f"<td data-th='Alert'>{n(s['alert'])}</td><td data-th='Warning'>{n(s['warning'])}</td>"
                   f"<td data-th='Danger'>{n(s['danger'])}</td></tr></tr>")
    return "<table><tbody>" + "".join(out) + "</tbody></table>"


def _rain_page(districts: list[str], wet: dict[str, float], now: dt.datetime) -> str:
    days = [now.date() - dt.timedelta(days=k) for k in range(6, 0, -1)]
    head = "".join(f"<th style='x'>{d:%d/%m/%Y}</th>" for d in days) + f"<th>Rainfall from Midnight ({now:%d/%m/%Y})</th>"
    rows = []
    for i, dist in enumerate(districts, 1):
        vals = [wet.get(dist, 0.0) if k == 5 else 0.0 for k in range(6)] + [0.0]
        rows.append(f"<td data-th='No'>{i}</td><td data-th='Station ID'>G{i}RF</td><td>Gauge {dist}</td><td>{dist}</td>"
                    f"<td>{now:%d/%m/%Y %H:%M:%S}</td>" + "".join(f"<td>{v}</td>" for v in vals) + "<td class='info'>0.0</td></tr>")
    return head + "<tbody>" + "".join(rows) + "</tbody>"


def fake_site(url: str) -> str:
    """JPS as it would answer now: the snapshot's stations re-read at the current time, one station in Hulu Langat at
    DANGER, and 120 mm of rain in Petaling yesterday."""
    if "getwaterlevellast7days" in url:
        raise OSError("no network in the tests")
    code = re.search(r"state=([A-Z]{3})", url).group(1)
    now = _myt_now()
    snap = _snapshot()
    if "aras-air-data" in url:
        rows = []
        for s in (x for x in snap["stations"] if x["code"] == code):
            s = {**s, "updated": (now - dt.timedelta(minutes=10)).isoformat(timespec="minutes")}
            if s["id"] == FLOODED.get("id"):
                s["level"] = round(s["danger"] + 0.3, 2)
            elif s["alert"] and s["level"] and s["level"] >= s["alert"]:
                s["level"] = round(s["alert"] - 0.5, 2)  # everything else back to normal
            rows.append(s)
        return _levels_page(rows)
    districts = sorted({r["district"] for r in snap["rain"] if r["code"] == code})
    return _rain_page(districts, {"Petaling": 120.0}, now)


def offline(url: str) -> str:
    raise OSError("JPS unreachable (test)")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(floodwatch, "AUTO_REFRESH", False)
    monkeypatch.setattr(jps, "http_get", offline)


def test_offline_the_page_runs_on_the_committed_snapshot(client):
    o = client.get("/api/floodwatch").json()
    snap = _snapshot()
    assert o["source"]["mode"] == "snapshot" and o["source"]["fetched_at"] == snap["fetched_at"]
    assert o["total"] == len(snap["stations"]) and sum(o["counts"].values()) == o["total"]
    assert o["counts"]["no_reading"] > 0  # stations reporting 0.00 are not counted as normal
    assert o["source"]["positions"]["jps"] > 300  # most stations have their real position
    assert {s["state"] for s in o["by_state"]} >= {"Selangor", "Kelantan", "Sarawak"}
    r = client.post("/api/floodwatch/refresh").json()
    assert r["updated"] is False and "could not be reached" in r["note"]
    assert client.get("/api/floodwatch").json()["source"]["mode"] == "snapshot"


def test_live_fetch_ranks_the_vehicles_in_the_flooded_district(client, monkeypatch):
    snap = _snapshot()
    FLOODED.update(next(s for s in snap["stations"] if s["district"] == "Hulu Langat" and s["danger"] and s["level"]))
    monkeypatch.setattr(jps, "http_get", fake_site)
    r = client.post("/api/floodwatch/refresh").json()
    assert r["updated"] is True and r["mode"] == "live" and r["stations"] == len(snap["stations"])
    again = client.post("/api/floodwatch/refresh").json()
    assert again["updated"] is False and "at most" in again["note"]  # polite to JPS: no second fetch within 2 minutes

    o = client.get("/api/floodwatch").json()
    assert o["source"]["mode"] == "live" and o["counts"]["danger"] == 1
    danger = client.get("/api/floodwatch/stations", params={"status": "danger"}).json()
    assert [s["id"] for s in danger["items"]] == [FLOODED["id"]]
    assert danger["items"][0]["to_danger_m"] == -0.3

    areas = client.get("/api/floodwatch/areas").json()["items"]
    top = areas[0]
    assert (top["state"], top["district"]) == ("Selangor", "Hulu Langat")
    assert top["exposure"] >= 0.8 and top["to_inspect"] > 0 and top["worst_station"]["id"] == FLOODED["id"]
    wet = next(a for a in areas if a["district"] == "Petaling")
    assert wet["rain"]["mm"] == 120.0 and wet["rain_exposure"] > 0 and "120 mm of rain" in wet["reasons"][0]["text"]

    v = client.get("/api/floodwatch/vehicles", params={"page_size": 50}).json()
    risks = [x["risk"] for x in v["items"]]
    assert v["total"] > 0 and risks == sorted(risks, reverse=True) and min(risks) >= floodwatch.CHECK_RISK
    first = v["items"][0]
    assert first["district"] == "Hulu Langat" and first["recommendation"] == "Flood-damage inspection"
    assert FLOODED["name"] in first["reasons"][0]["text"] and first["reasons"][0]["source"] == "real"
    only = client.get("/api/floodwatch/vehicles", params={"district": "Petaling", "min_risk": 0}).json()
    assert only["total"] > 0 and all(x["district"] == "Petaling" for x in only["items"])

    h = client.get(f"/api/floodwatch/stations/{FLOODED['id']}/history").json()
    assert [p["status"] for p in h["recorded"]][-1] == "danger" and len(h["recorded"]) >= 2  # snapshot + this fetch
    assert h["jps_7d"] == [] and h["jps_7d_error"]  # JPS's own 7-day series is optional


def test_vehicle_detail_and_the_mock_invitation(client):
    items = client.get("/api/floodwatch/vehicles").json()["items"]
    assert any(x["kind"] == "vehicle" for i in items for x in i["reasons"])
    first = items[0]
    d = client.get(f"/api/floodwatch/vehicles/{first['plate']}").json()
    assert d["risk"] == first["risk"] and d["exposed"] and d["reasons"] == first["reasons"]
    assert d["how"].startswith("Exposure") and d["how"].endswith(f"risk {d['risk']}")
    assert "ground_truth" not in d and not any(k.startswith("gt_") for k in d)
    assert d["model"] == first["model"] and isinstance(d["flood_model"], dict)  # the car's model, not the flood model
    inv = client.post("/api/floodwatch/invitations", json={"plates": [first["plate"], "NOPE 1"]}).json()
    assert [i["plate"] for i in inv["invited"]] == [first["plate"]] and inv["unknown"] == ["NOPE 1"]
    assert inv["channel"] == "mock"
    assert client.post("/api/floodwatch/invitations", json={"plates": [first["plate"]]}).json()["already"] == [first["plate"]]
    assert client.get("/api/floodwatch/invitations").json()[0]["plate"] == first["plate"]
    assert client.get("/api/floodwatch/vehicles").json()["items"][0]["invited_at"]


def test_past_flood_ranks_the_claimants_and_labels_the_real_event(client):
    evs = client.get("/api/floodwatch").json()["events"]
    dec21 = next(e for e in evs if e["date"] == "2021-12-18")
    assert dec21["real"] and "public record" in dec21["note"] and dec21["claims"] > 0
    assert any(not e["real"] and "Synthetic" in e["note"] for e in evs)
    v = client.get("/api/floodwatch/vehicles", params={"scope": "event:2021-12-18", "min_risk": 0, "page_size": 5}).json()
    assert v["items"][0]["reasons"][0]["text"].startswith("Flood insurance claim for this flood")
    areas = client.get("/api/floodwatch/areas", params={"scope": "event:2021-12-18"}).json()["items"]
    klang = next(a for a in areas if a["district"] == "Klang")
    assert klang["exposure"] == floodwatch.EVENT_DISTRICT and klang["reasons"][0]["source"] == "public_record"
    assert client.get("/api/floodwatch/vehicles", params={"scope": "tomorrow"}).status_code == 400
    assert client.get("/api/floodwatch/vehicles", params={"scope": "event:2020-01-01"}).status_code == 404

"""Flood watch: JPS river levels and rainfall (real, public) x the vehicles registered in each district (synthetic)
-> which vehicles need a flood-damage inspection or an underbody corrosion check, and why.

* Stations and rainfall come from JPS Public InfoBanjir (``vhi.services.jps``) for every state, fetched in parallel
  and kept for 15 minutes. Reading the data starts a fetch in the background once it is older than that; when the
  site cannot be reached the last stored fetch is used, else the committed snapshot. Every fetch is kept
  (``flood_refreshes``, ``flood_readings``) so the page can show how the levels moved.
* A station's status is read against its own JPS thresholds. A level of 0.00 under a positive normal level, or a
  reading more than a day older than the fetch, counts as no reading - never as normal.
* Vehicles and their districts are synthetic (``vhi.seed.floodwatch``).
* The risk score is scoring logic: how exposed the vehicle's district is (river levels over their thresholds, very
  heavy rain; or a past flood) x how vulnerable the vehicle is (ground clearance, age, high-voltage battery,
  corrosion found before, earlier flood claims), combined with the flood model (``vhi.ml.fusion``, LightGBM on
  physical evidence) for vehicles with an inspection history. Every factor comes with a reason in plain words.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from collections import Counter
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy import delete, select, text

from .. import terms
from ..config import get_settings
from ..db import engine, session_scope
from ..seed.floodwatch import DISTRICTS, area_of, centre, unit
from ..tables import FloodInvitation, FloodReading, FloodRefresh, Setting
from . import jps

log = logging.getLogger("vhi.floodwatch")

TTL_S = 15 * 60       # a fetch stays fresh this long
RETRY_S = 5 * 60      # after JPS could not be reached
MIN_GAP_S = 120       # "Refresh" never asks JPS more often than this
STALE_H = 24          # a reading this much older than the fetch counts as no reading
KEEP_DAYS = 30
AUTO_REFRESH = True   # the tests switch the background fetch off
LIVE = "live"
STATUSES = ["danger", "warning", "alert", "normal", "no_reading", "no_thresholds"]
AT_RISK = ("danger", "warning", "alert")
LEVEL_EXPOSURE = {"alert": 0.3, "warning": 0.55, "danger": 0.8}  # + up to 0.15 above danger (never 1: see CLAIM_EXPOSURE)
RAIN_EXPOSURE = ((100, 0.25), (60, 0.12))  # mm in a day -> exposure, fading by 0.15 a day
# A past flood: a claim for the flood itself (not 1: the vehicle factor still orders the claimants), a district the
# flood hit (public record), a whole state it hit, a state with several claims that day. Being registered where a
# flood was years ago is weak evidence on its own: it takes a vulnerable vehicle or the flood model to reach a check.
CLAIM_EXPOSURE, EVENT_DISTRICT, EVENT_STATE, CLAIM_STATE = 0.95, 0.3, 0.2, 0.1
CHECK_RISK, HIGH_RISK = 45, 70  # an inspection is recommended from CHECK_RISK (medium risk), high from HIGH_RISK

# Past floods known from the public record, for the flood dates in the (synthetic) insurance claims.
REAL_EVENTS = {
    "2021-12-18": {"title": "Klang Valley floods, Dec 2021",
                   "note": "Real event (public record): a tropical depression brought days of heavy rain from 17 Dec 2021 "
                           "and flooded large parts of Selangor and Kuala Lumpur (Shah Alam, Klang, Hulu Langat) and "
                           "towns in Pahang.",
                   "areas": {"Selangor": ["Petaling", "Klang", "Hulu Langat", "Sepang", "Kuala Langat"],
                             "W.P. Kuala Lumpur": ["Kuala Lumpur"], "Pahang": ["Temerloh", "Bentong"]}},
    "2024-11-28": {"title": "East-coast monsoon floods, Nov 2024",
                   "note": "Real event (public record): the north-east monsoon brought severe floods to Kelantan and "
                           "Terengganu from late November 2024.",
                   "areas": {"Kelantan": "*", "Terengganu": "*"}},
}
VTYPE_POINTS = {"Sedan": 0.15, "Hatchback": 0.15, "MPV": 0.08, "Van": 0.05, "SUV": 0.0, "Pickup": 0.0,
                "Lorry": -0.15, "Bus": -0.15}
VTYPE_WHY = {"Sedan": "Sedan: low ground clearance, so shallow water reaches the floor, wiring and exhaust",
             "Hatchback": "Hatchback: low ground clearance, so shallow water reaches the floor, wiring and exhaust",
             "MPV": "MPV: medium ground clearance", "Van": "Van: medium ground clearance",
             "Lorry": "Lorry: high ground clearance lowers the risk", "Bus": "Bus: high ground clearance lowers the risk"}
FEATURE_LABEL = {"age_years": "Vehicle age", "is_ev": "Electric", "corrosion_max": "Worst corrosion found",
                 "corrosion_last": "Latest corrosion score", "hv_isolation_min": "Lowest HV isolation",
                 "soh_gap": "Battery health below its age", "flood_state": "Flood-prone state",
                 "structural_any": "Structural repair found"}
METHOD = ("Exposure (0-1) comes from the vehicle's district: its worst JPS station at alert 0.3, warning 0.55, "
          "danger 0.8 (up to 0.95 well above danger; less when the reading is hours old), combined with a day of 60 mm "
          "of rain or more 0.12 (100 mm: 0.25, fading by 0.15 a day). For a past flood: a flood claim for that event "
          "0.95, a district the flood hit 0.3 (a whole state 0.2), a state with several claims that day 0.1. The "
          "vehicle factor starts at 1: +3% a year over 3 years (up to +30%), low ground clearance +15%, electric "
          "+25%, hybrid +15%, corrosion 5/10 or worse found before +12% (7/10: +25%), an earlier flood claim +20%, "
          "a structural repair +5%, high clearance -15%. Exposure risk = 1 - (1 - exposure)^factor, so a factor "
          "above 1 raises it and below 1 lowers it. Risk = 1 - (1 - exposure risk) x (1 - 0.6 x flood model), as a "
          "percentage. From risk 45 an inspection is recommended: a flood-damage inspection when the exposure risk is "
          "0.6 or more or the flood model says 50% or more, otherwise an underbody corrosion check.")

_lock = threading.Lock()
_busy = threading.Lock()
_mem: dict = {"data": None, "mode": None, "attempt": 0.0, "error": None}
_cache: dict[str, tuple[float, object]] = {}
_jps_hist: dict[str, tuple[float, list]] = {}


def _cached(key: str, ttl: float, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (time.time(), val)
    return val


def _now() -> dt.datetime:
    """Malaysia time without a zone, as JPS writes it."""
    return dt.datetime.now(ZoneInfo(get_settings().timezone)).replace(tzinfo=None)


def _t(s: str | None) -> dt.datetime | None:
    return dt.datetime.fromisoformat(s) if s else None


def _day(s: str) -> str:
    d = dt.date.fromisoformat(s[:10])
    return f"{d.day} {d:%b %Y}"


def _pct(p: float) -> str:
    return "over 99%" if p >= 0.995 else f"{p:.0%}"


def _ago(hours: float) -> str:
    return f"{hours:.0f} hours" if hours < 48 else f"{hours / 24:.0f} days"


# ---------------------------------------------------------------- JPS data: load, refresh, record
def _snapshot() -> dict:
    return json.loads((get_settings().assets_dir / "web_snapshots" / jps.SNAPSHOT).read_text())


def _positions() -> dict[str, list[float]]:
    def load():
        p = get_settings().assets_dir / "web_snapshots" / jps.STATIONS
        return json.loads(p.read_text()).get("coords", {}) if p.exists() else {}
    return _cached("positions", 1e9, load)


def _load() -> tuple[dict, str]:
    with session_scope() as s:
        row = s.get(Setting, "floodwatch_live")
        stored = row.value if row else None
    if stored:
        return stored, LIVE
    snap = _snapshot()
    _record(snap, "snapshot")
    return snap, "snapshot"


def data(auto: bool = True) -> tuple[dict, str]:
    """The latest JPS data and where it came from ("live" = fetched by this server, "snapshot" = the committed file).
    Starts a background fetch when it is older than 15 minutes."""
    with _lock:
        if _mem["data"] is None:
            _mem["data"], _mem["mode"] = _load()
        d, mode = _mem["data"], _mem["mode"]
    if auto and AUTO_REFRESH and _due():
        threading.Thread(target=refresh, kwargs={"wait": False}, name="jps-fetch", daemon=True).start()
    return d, mode


def _age_s(d: dict) -> float:
    return (_now() - _t(d["fetched_at"])).total_seconds()


def _due() -> bool:
    if _busy.locked() or time.time() - _mem["attempt"] < (RETRY_S if _mem["error"] else TTL_S):
        return False
    return _mem["mode"] != LIVE or _age_s(_mem["data"]) > TTL_S


def refreshing() -> bool:
    return _busy.locked()


def refresh(wait: bool = True) -> dict:
    """Fetch every state from JPS now (at most once every two minutes). Offline, the current data stays."""
    if not _busy.acquire(blocking=wait):
        return {"updated": False, "note": "A fetch from JPS is already running."}
    try:
        data(auto=False)
        since = time.time() - _mem["attempt"]
        if _mem["mode"] == LIVE and not _mem["error"] and since < MIN_GAP_S:
            return {"updated": False, "mode": LIVE, "fetched_at": _mem["data"]["fetched_at"],
                    "note": f"Fetched from JPS {int(since)} s ago; it is asked at most every {MIN_GAP_S // 60} minutes."}
        _mem["attempt"] = time.time()
        try:
            d = jps.fetch_all()
        except Exception as e:  # noqa: BLE001
            d = {"stations": [], "errors": {"all": f"{type(e).__name__}: {e}"[:160]}}
        if not d["stations"]:
            _mem["error"] = next(iter(d["errors"].values()), "no stations returned")
            log.warning("JPS unreachable, keeping the %s data: %s", _mem["mode"], _mem["error"])
            return {"updated": False, "mode": _mem["mode"], "fetched_at": _mem["data"]["fetched_at"], "errors": d["errors"],
                    "note": "JPS Public InfoBanjir could not be reached: kept the "
                            + ("last fetch." if _mem["mode"] == LIVE else "snapshot.")}
        prev = _mem["data"]
        failed = {k.split(":")[0] for k in d["errors"]}
        if failed:  # a state that failed this time keeps its last readings rather than vanishing from the map
            d["stations"] += [s for s in prev["stations"] if s["code"] in failed and f"{s['code']}:levels" in d["errors"]]
            d["rain"] += [r for r in prev.get("rain", []) if r["code"] in failed and f"{r['code']}:rain" in d["errors"]]
        with session_scope() as s:
            s.merge(Setting(key="floodwatch_live", value=d))
        _record(d, LIVE)
        with _lock:
            _mem.update(data=d, mode=LIVE, error=None)
            for k in [k for k in _cache if k != "positions" and k != "fleet"]:
                del _cache[k]
        log.info("JPS: %d stations, %d rain districts (%d errors)", len(d["stations"]), len(d["rain"]), len(d["errors"]))
        return {"updated": True, "mode": LIVE, "fetched_at": d["fetched_at"], "stations": len(d["stations"]),
                "errors": d["errors"], "note": "Fetched every state from JPS Public InfoBanjir."}
    finally:
        _busy.release()


def _record(d: dict, source: str) -> None:
    """Keep the fetch: status counts per fetch, and each station's reading once per JPS reading time."""
    at = _t(d["fetched_at"])
    rows = [(s, classify(s, at)["status"]) for s in d["stations"]]
    counts = Counter(st for _, st in rows)
    with session_scope() as s:
        if s.execute(select(FloodRefresh.id).where(FloodRefresh.fetched_at == d["fetched_at"])).first():
            return
        s.add(FloodRefresh(fetched_at=d["fetched_at"], source=source, counts=dict(counts), errors=d.get("errors") or {}))
        new = [(st, status) for st, status in rows if st.get("updated")]
        if new:
            first = min(st["updated"] for st, _ in new)
            have = set(s.execute(select(FloodReading.station_id, FloodReading.reading_at)
                                 .where(FloodReading.reading_at >= first)).all())
            s.add_all([FloodReading(station_id=st["id"], reading_at=st["updated"], level=st["level"], status=status,
                                    fetched_at=d["fetched_at"]) for st, status in new if (st["id"], st["updated"]) not in have])
        cutoff = (at - dt.timedelta(days=KEEP_DAYS)).isoformat(timespec="minutes")
        s.execute(delete(FloodReading).where(FloodReading.reading_at < cutoff))


# ---------------------------------------------------------------- stations
def classify(st: dict, at: dt.datetime) -> dict:
    """A station's status against its own JPS thresholds, at the time of the fetch."""
    lvl, normal = st.get("level"), st.get("normal")
    a, w, d = st.get("alert"), st.get("warning"), st.get("danger")
    if a is not None and w is not None:
        w = max(w, a)
    if w is not None and d is not None:
        d = max(d, w)
    upd = _t(st.get("updated"))
    age_h = round((at - upd).total_seconds() / 3600, 1) if upd else None
    out = {"age_h": age_h, "over": None, "above_alert_m": None, "to_danger_m": None}
    if lvl is None or (lvl == 0 and (normal or 0) > 0):
        return {**out, "status": "no_reading", "note": "No current reading (JPS shows 0.00 or nothing)"}
    if age_h is None or age_h > STALE_H:
        return {**out, "status": "no_reading",
                "note": f"Last reading {_ago(age_h)} before the fetch" if age_h is not None else "No reading time"}
    if not any((a, w, d)):
        return {**out, "status": "no_thresholds", "note": "JPS publishes no thresholds for this station"}
    status = "danger" if d and lvl >= d else "warning" if w and lvl >= w else "alert" if a and lvl >= a else "normal"
    out.update(above_alert_m=round(lvl - a, 2) if a is not None else None,
               to_danger_m=round(d - lvl, 2) if d is not None else None,
               over=round((lvl - a) / (d - a), 3) if a is not None and d is not None and d > a else None)
    return {**out, "status": status, "note": ""}


def _previous_levels(since: str) -> dict[str, list[tuple[str, float]]]:
    rows = pd.read_sql(text("select station_id, reading_at, level from flood_readings where reading_at >= :s "
                            "order by station_id, reading_at"), engine(), params={"s": since})
    return {k: list(zip(g.reading_at, g.level)) for k, g in rows.groupby("station_id")}


def stations_view() -> list[dict]:
    d, _ = data()

    def build():
        at = _t(d["fetched_at"])
        pos = _positions()
        prev = _previous_levels((at - dt.timedelta(days=2)).isoformat(timespec="minutes"))
        out = []
        for s in d["stations"]:
            c = classify(s, at)
            p = pos.get(s["id"])
            ctr = centre(s["state"], s["district"])
            lat, lon, where = (p[0], p[1], "jps") if p else ((ctr[0], ctr[1], "district") if ctr else (None, None, None))
            if where == "district":  # spread a district's unplaced stations around its centre instead of stacking them
                lat = round(lat + (unit(s["id"] + ":lat") - 0.5) * 0.14, 4)
                lon = round(lon + (unit(s["id"] + ":lon") - 0.5) * 0.14, 4)
            earlier = [(t, v) for t, v in prev.get(s["id"], []) if s.get("updated") and t < s["updated"] and v is not None]
            change = None
            if earlier and c["status"] not in ("no_reading",) and s["level"] is not None:
                change = {"m": round(s["level"] - earlier[-1][1], 2), "since": earlier[-1][0]}
            out.append({**s, **c, "area": area_of(s["state"], s["district"]), "lat": lat, "lon": lon, "position": where,
                        "change": change})
        return out
    return _cached(f"stations:{d['fetched_at']}", 600, build)


def stations(status: str | None = None, state: str | None = None) -> dict:
    d, mode = data()
    items = stations_view()
    if status:
        want = set(status.split(","))
        items = [s for s in items if s["status"] in want]
    if state:
        items = [s for s in items if state in (s["state"], s["code"])]
    keep = ("id", "station_no", "name", "district", "area", "state", "code", "basin", "river", "updated", "level", "normal", "alert",
            "warning", "danger", "status", "note", "age_h", "above_alert_m", "to_danger_m", "lat", "lon", "position", "change")
    order = {k: i for i, k in enumerate(STATUSES)}
    items = sorted(items, key=lambda s: (order[s["status"]], -(s["over"] or 0), s["state"], s["name"]))
    return {"fetched_at": d["fetched_at"], "mode": mode, "total": len(items), "items": [{k: s[k] for k in keep} for s in items]}


def station_history(station_id: str) -> dict:
    """A station's readings as this server recorded them, plus JPS's own last 7 days when the site answers."""
    st = next((s for s in stations_view() if s["id"] == station_id), None)
    if st is None:
        raise HTTPException(404, f"station {station_id} not found")
    ours = pd.read_sql(text("select reading_at, level, status from flood_readings where station_id = :s order by reading_at"),
                       engine(), params={"s": station_id})
    series, err = [], None
    if st.get("graph"):
        hit = _jps_hist.get(st["graph"])
        if hit and time.time() - hit[0] < TTL_S:
            series = hit[1]
        else:
            try:
                series = jps.station_history(st["graph"])
                _jps_hist[st["graph"]] = (time.time(), series)
            except Exception as e:  # noqa: BLE001 - offline: our own readings still show the trend
                err = f"{type(e).__name__}"
    return {"station": {k: v for k, v in st.items() if k != "graph"},
            "recorded": [{"t": r.reading_at, "level": r.level, "status": r.status} for r in ours.itertuples()],
            "jps_7d": series, "jps_7d_error": err}


# ---------------------------------------------------------------- exposure by area: live, or a past flood
def _area(state: str, district: str) -> dict:
    c = DISTRICTS.get(state, {}).get(district)
    return {"state": state, "district": district, "lat": c[0] if c else None, "lon": c[1] if c else None,
            "exposure": 0.0, "level_e": 0.0, "rain_e": 0.0, "stations": Counter(), "worst": None, "rain": None,
            "reasons": [], "headline": None, "source": None}


def _live_areas() -> dict[tuple[str, str], dict]:
    d, _ = data()

    def build():
        at = _t(d["fetched_at"])
        areas: dict[tuple[str, str], dict] = {}
        for s in stations_view():
            a = areas.setdefault((s["state"], s["area"]), _area(s["state"], s["area"]))
            a["stations"][s["status"]] += 1
            if s["status"] not in AT_RISK:
                continue
            e = LEVEL_EXPOSURE[s["status"]] + 0.15 * min(1.0, max(0.0, (s["over"] or 1.0) - 1.0))
            if s["age_h"] and s["age_h"] > 3:
                e *= max(0.7, 1 - (s["age_h"] - 3) / 70)
            if e > a["level_e"]:
                a.update(level_e=round(e, 3), worst=s)
        for r in d.get("rain", []):
            best = (0.0, None, None)
            for day, mm in r["daily"].items():
                ago = (at.date() - dt.date.fromisoformat(day)).days
                e = next((x for lim, x in RAIN_EXPOSURE if mm is not None and mm >= lim), 0.0) * max(0.0, 1 - 0.15 * ago)
                if e > best[0]:
                    best = (round(e, 3), day, mm)
            if best[0] > 0:
                key = (r["state"], area_of(r["state"], r["district"]))
                a = areas.setdefault(key, _area(*key))
                if best[0] > a["rain_e"]:
                    a.update(rain_e=best[0], rain={"mm": best[2], "day": best[1],
                                                   "gauge": r["max_gauge"] if r.get("max_day") == best[1] else None})
        for a in areas.values():
            a["exposure"] = round(1 - (1 - a["level_e"]) * (1 - a["rain_e"]), 3)
            if a["worst"]:
                w = a["worst"]
                how = ""
                if w["status"] == "danger" and w["to_danger_m"] is not None:
                    how = f", {-w['to_danger_m']:.2f} m above the danger level"
                elif w["status"] == "warning" and w["to_danger_m"] is not None:
                    how = f", {w['to_danger_m']:.2f} m below the danger level"
                elif w["above_alert_m"] is not None:
                    how = f", {w['above_alert_m']:.2f} m above the alert level"
                a["reasons"].append({"text": f"JPS station {w['name']} ({w['district']}) is at {w['status'].upper()}: "
                                             f"{w['level']:.2f} m at {w['updated'][11:16]}{how}",
                                     "kind": "exposure", "source": "real"})
            if a["rain"]:
                r = a["rain"]
                a["reasons"].append({"text": f"{r['mm']:.0f} mm of rain in one day in {a['district']} on {_day(r['day'])}"
                                             + (f" ({r['gauge']})" if r["gauge"] else ""),
                                     "kind": "exposure", "source": "real"})
            a["headline"] = (f"{a['worst']['status'].capitalize()} at {a['worst']['name']}" if a["worst"] else
                             f"{a['rain']['mm']:.0f} mm of rain on {_day(a['rain']['day'])[:-5]}" if a["rain"] else None)
            a["source"] = "real"
        return {k: a for k, a in areas.items() if a["exposure"] > 0}
    return _cached(f"live_areas:{d['fetched_at']}", 600, build)


def events() -> list[dict]:
    """Past floods: the flood dates in the (synthetic) insurance claims, with the real event where there is one."""
    def build():
        c = pd.read_sql(text("select c.claim_date, l.state from hist_claims c join vehicle_locations l "
                             "on l.vehicle_id = c.vehicle_id where c.claim_type like '%flood%'"), engine())
        c["date"] = c.claim_date.astype(str).str[:10]
        out = []
        for date, g in c.groupby("date"):
            real = REAL_EVENTS.get(date)
            states = g.state.value_counts()
            out.append({"id": f"event:{date}", "date": date, "real": bool(real),
                        "title": real["title"] if real else f"Flood claims, {_day(date)}",
                        "note": real["note"] if real else "Synthetic: a cluster of flood insurance claims in the demo data "
                                                           "on this date. No real event is attached to it.",
                        "claims": int(len(g)), "states": [{"state": k, "claims": int(v)} for k, v in states.head(5).items()]})
        return sorted(out, key=lambda e: e["date"], reverse=True)
    return _cached("events", 600, build)


def _event_areas(date: str) -> dict[tuple[str, str], dict]:
    ev = next((e for e in events() if e["date"] == date), None)
    if ev is None:
        raise HTTPException(404, f"no flood event on {date}")
    real = REAL_EVENTS.get(date)
    areas: dict[tuple[str, str], dict] = {}
    for st in ev["states"]:
        if st["claims"] >= 3:
            for dist in DISTRICTS.get(st["state"], {}):
                a = areas.setdefault((st["state"], dist), _area(st["state"], dist))
                a.update(exposure=CLAIM_STATE, headline=f"{st['claims']} flood claims in {st['state']} that day",
                         source="synthetic")
                a["reasons"] = [{"text": f"{st['claims']} flood insurance claims from {st['state']} on {_day(date)}",
                                 "kind": "exposure", "source": "synthetic"}]
    for state, dists in (real or {}).get("areas", {}).items():
        names = list(DISTRICTS.get(state, {})) if dists == "*" else dists
        for dist in names:
            a = areas.setdefault((state, dist), _area(state, dist))
            a.update(exposure=EVENT_STATE if dists == "*" else EVENT_DISTRICT, headline=f"Hit by the {real['title']}",
                     source="public_record")
            a["reasons"] = [{"text": f"{state if dists == '*' else dist} was hit by the {real['title']} (public record)",
                             "kind": "exposure", "source": "public_record"}]
    return areas


def _scope_areas(scope: str) -> dict[tuple[str, str], dict]:
    if scope == LIVE:
        return _live_areas()
    if scope.startswith("event:"):
        return _event_areas(scope[6:])
    raise HTTPException(400, "scope is 'live' or 'event:<date>'")


# ---------------------------------------------------------------- vehicles and their risk
def _fleet() -> pd.DataFrame:
    """Every vehicle with its (synthetic) district, inspection history and flood claims, and the flood model's
    probability for those with an inspection history."""
    def build():
        eng = engine()
        v = pd.read_sql(text("select v.vehicle_id, v.plate, v.make, v.model, v.vtype, v.fuel, v.year, v.fleet_id, "
                             "l.state, l.district, l.lat, l.lon from vehicles v join vehicle_locations l "
                             "on l.vehicle_id = v.vehicle_id"), eng).set_index("vehicle_id")
        ins = pd.read_sql(text("select vehicle_id, date, corrosion_score_0_10 as corr, structural_anomaly as structural, "
                               "hv_isolation_mohm as hv, ev_soh_pct as soh from hist_inspections"), eng)
        for c in ("corr", "hv", "soh", "structural"):
            ins[c] = pd.to_numeric(ins[c], errors="coerce")
        ins = ins.sort_values("date")
        g = ins.groupby("vehicle_id")
        agg = pd.DataFrame({"n_insp": g.size(), "corrosion_max": g["corr"].max(), "corrosion_last": g["corr"].last(),
                            "hv_min": g.hv.min(), "soh_min": g.soh.min(), "structural_any": g.structural.max()})
        worst = ins.dropna(subset=["corr"]).sort_values("corr").groupby("vehicle_id").tail(1).set_index("vehicle_id")
        agg["corrosion_date"] = worst.date.astype(str).str[:10]
        cl = pd.read_sql(text("select vehicle_id, claim_date, amount_rm, ber_total_loss from hist_claims "
                              "where claim_type like '%flood%' order by claim_date"), eng)
        claims = cl.groupby("vehicle_id").apply(
            lambda x: [{"date": str(r.claim_date)[:10], "amount_rm": float(r.amount_rm), "written_off": bool(r.ber_total_loss)}
                       for r in x.itertuples()], include_groups=False)
        df = v.join(agg).join(claims.rename("flood_claims"))
        df["n_insp"] = df.n_insp.fillna(0).astype(int)
        df["age"] = dt.date.fromisoformat(get_settings().demo_today).year - df.year
        df["p_model"] = _flood_model(df)
        return df
    return _cached("fleet", 1800, build)


def _model_features(df: pd.DataFrame) -> pd.DataFrame:
    from ..ml.fusion import FLOOD_STATES

    return pd.DataFrame({
        "age_years": df.age, "is_ev": (df.fuel == "ev").astype(float), "corrosion_max": df.corrosion_max,
        "corrosion_last": df.corrosion_last, "hv_isolation_min": df.hv_min, "soh_gap": (100 - 2.2 * df.age) - df.soh_min,
        "flood_state": df.state.isin(FLOOD_STATES).astype(float), "structural_any": df.structural_any.astype(float),
    }, index=df.index)


def _models():
    from ..runtime import rt

    return rt().models


def _flood_model(df: pd.DataFrame) -> pd.Series:
    p = pd.Series(np.nan, index=df.index)
    models = _models()
    has = df.n_insp > 0
    if models is None or not has.any():
        return p
    booster = models.fusion.flood
    p[has] = booster.predict(_model_features(df[has])[booster.feature_name()])
    return p.round(3)


def _score(df: pd.DataFrame, exposure: pd.Series, event: str | None) -> pd.DataFrame:
    d = df.loc[exposure.index].copy()
    d["exposure"] = exposure.round(3)
    prior = d.flood_claims.apply(lambda cs: any(c["date"] != event for c in cs) if isinstance(cs, list) else False)
    corr = d.corrosion_max.fillna(0)
    d["susceptibility"] = (1 + ((d.age - 3).clip(lower=0) * 0.03).clip(upper=0.3) + d.vtype.map(VTYPE_POINTS).fillna(0.05)
                           + d.fuel.map({"ev": 0.25, "hybrid": 0.15}).fillna(0.0)
                           + np.where(corr >= 7, 0.25, np.where(corr >= 5, 0.12, 0.0))
                           + prior * 0.2 + (d.structural_any.fillna(0) > 0) * 0.05).round(3)
    # a factor above 1 raises the chance that the exposure did damage, below 1 lowers it, and it never passes 100%
    d["exposure_score"] = (1 - (1 - d.exposure) ** d.susceptibility).round(3)
    p = d.p_model.fillna(0.0)
    d["risk"] = (100 * (1 - (1 - d.exposure_score) * (1 - 0.6 * p))).round().astype(int)
    check = d.risk >= CHECK_RISK
    flood = check & ((d.exposure_score >= 0.6) | (p >= 0.5))
    d["recommendation"] = np.where(flood, "Flood-damage inspection",
                                   np.where(check, "Underbody corrosion check", "No inspection needed yet"))
    d["band"] = np.where(d.risk >= HIGH_RISK, "High", np.where(check, "Medium", "Low"))
    return d.sort_values(["risk", "exposure", "plate"], ascending=[False, False, True])


def _scored(scope: str) -> tuple[pd.DataFrame, dict]:
    areas = _scope_areas(scope)
    d, _ = data()

    def build():
        df = _fleet()
        keys = list(zip(df.state, df.district))
        exp = pd.Series([areas[k]["exposure"] if k in areas else 0.0 for k in keys], index=df.index)
        event = scope[6:] if scope.startswith("event:") else None
        if event:
            hit = df.flood_claims.apply(lambda cs: isinstance(cs, list) and any(c["date"] == event for c in cs))
            exp[hit] = CLAIM_EXPOSURE
        return _score(df, exp[exp > 0], event)
    return _cached(f"scored:{scope}:{d['fetched_at']}", 300, build), areas


def _reasons(r, areas: dict, event: str | None) -> list[dict]:
    out = []
    claims = r.flood_claims if isinstance(r.flood_claims, list) else []
    for c in claims:
        if c["date"] == event:
            out.append({"text": f"Flood insurance claim for this flood (RM {c['amount_rm']:,.0f}"
                                + (", written off)" if c["written_off"] else ")"), "kind": "exposure", "source": "synthetic"})
    a = areas.get((r.state, r.district))
    if a:
        out += [{**x, "district": True} for x in a["reasons"]]
    if r.p_model == r.p_model and r.p_model >= 0.15:
        p = _pct(r.p_model)
        out.append({"text": f"Flood model: {p} likely to have flood damage already, from its inspection history "
                            "(corrosion, HV isolation, battery health)", "kind": "model", "source": "live_model"})
    factors = []
    for c in claims:
        if c["date"] != event:
            factors.append((0.2, f"Earlier flood insurance claim on {_day(c['date'])}"
                                 + (" (written off, back on the road)" if c["written_off"] else ""), "synthetic"))
    corr = r.corrosion_max if r.corrosion_max == r.corrosion_max else 0
    if corr >= 5:
        factors.append((0.25 if corr >= 7 else 0.12, f"Underbody corrosion {corr:.1f}/10 at its inspection on "
                                                      f"{_day(r.corrosion_date)}", "synthetic"))
    if r.fuel == "ev":
        factors.append((0.25, "Electric: the high-voltage battery sits under the floor; water in it can cause faults "
                              "or a fire weeks later", "synthetic"))
    elif r.fuel == "hybrid":
        factors.append((0.15, "Hybrid: a high-voltage battery and inverter that water can damage", "synthetic"))
    pts = VTYPE_POINTS.get(r.vtype, 0.05)
    if r.vtype in VTYPE_WHY:
        factors.append((pts, VTYPE_WHY[r.vtype], "synthetic"))
    age_pts = min(0.3, max(0, r.age - 3) * 0.03)
    if age_pts >= 0.09:
        factors.append((age_pts, f"{int(r.age)} years old: older seals and underbody coating let water and rust in",
                        "synthetic"))
    if r.structural_any == r.structural_any and r.structural_any > 0:
        factors.append((0.05, "A structural repair was found at an earlier inspection", "synthetic"))
    for p, t, src in sorted(factors, key=lambda f: -abs(f[0])):
        out.append({"text": t, "kind": "vehicle", "source": src, "effect": f"{'+' if p >= 0 else '-'}{abs(p):.0%}"})
    return out


def _invited() -> dict[str, str]:
    with session_scope() as s:
        return {i.vehicle_id: i.created_at.isoformat(timespec="seconds")
                for i in s.execute(select(FloodInvitation).order_by(FloodInvitation.created_at)).scalars()}


def _public(r, areas: dict, event: str | None, invited: dict) -> dict:
    a = areas.get((r.state, r.district)) or {}
    claimed = event and isinstance(r.flood_claims, list) and any(c["date"] == event for c in r.flood_claims)
    return {"vehicle_id": r.Index, "plate": r.plate, "make": r.make, "model": r.model, "vtype": r.vtype, "fuel": r.fuel,
            "year": int(r.year), "state": r.state, "district": r.district, "lat": r.lat, "lon": r.lon,
            "risk": int(r.risk), "band": r.band, "recommendation": r.recommendation, "exposure": float(r.exposure),
            "susceptibility": float(r.susceptibility), "exposure_risk": float(r.exposure_score),
            "p_model": None if r.p_model != r.p_model else float(r.p_model), "reasons": _reasons(r, areas, event),
            "exposure_headline": "Flood claim for this flood" if claimed else a.get("headline"),
            "exposure_source": "synthetic" if claimed else a.get("source"), "invited_at": invited.get(r.Index)}


def vehicles(scope: str = LIVE, min_risk: int = CHECK_RISK, page: int = 1, page_size: int = 25,
             state: str | None = None, district: str | None = None, recommendation: str | None = None) -> dict:
    d, areas = _scored(scope)
    counts = {"exposed": int(len(d)), "to_inspect": int((d.risk >= CHECK_RISK).sum()),
              "high": int((d.risk >= HIGH_RISK).sum()), "medium": int(((d.risk >= CHECK_RISK) & (d.risk < HIGH_RISK)).sum()),
              "flood_inspection": int((d.recommendation == "Flood-damage inspection").sum()),
              "corrosion_check": int((d.recommendation == "Underbody corrosion check").sum())}
    f = d[d.risk >= min_risk]
    if state:
        f = f[f.state == state]
    if district:
        f = f[f.district == district]
    if recommendation:
        f = f[f.recommendation == recommendation]
    page_size = max(1, min(100, page_size))
    pages = max(1, -(-len(f) // page_size))
    page = max(1, min(page, pages))
    invited = _invited()
    event = scope[6:] if scope.startswith("event:") else None
    rows = f.iloc[(page - 1) * page_size: page * page_size]
    return {"scope": scope, "min_risk": min_risk, "total": int(len(f)), "page": page, "pages": pages, "page_size": page_size,
            "counts": counts, "items": [_public(r, areas, event, invited) for r in rows.itertuples()]}


def _find(key: str) -> str:
    from ..api.deps import norm_plate

    df = _fleet()
    if key in df.index:
        return key
    hit = df.index[df.plate == norm_plate(key)]
    if not len(hit):
        raise HTTPException(404, f"vehicle {key} not found")
    return hit[0]


def vehicle_detail(key: str, scope: str = LIVE) -> dict:
    vid = _find(key)
    d, areas = _scored(scope)
    event = scope[6:] if scope.startswith("event:") else None
    if vid in d.index:
        row = d.loc[[vid]]
    else:  # not exposed in this scope: the vehicle factors alone
        row = _score(_fleet(), pd.Series([0.0], index=[vid]), event)
    r = next(row.itertuples())
    out = _public(r, areas, event, _invited())
    out["scope"] = scope
    out["exposed"] = vid in d.index
    out["flood_model"] = {"available": r.p_model == r.p_model, "p": out["p_model"], "factors": []}
    models = _models()
    if models is not None and r.p_model == r.p_model:
        feats = _model_features(_fleet().loc[[vid]]).iloc[0].to_dict()
        fp = models.fusion.flood_probability(feats)

        def shown(f: str):
            v = feats.get(f)
            if v is None or v != v:
                return None
            return ("yes" if v else "no") if f in ("is_ev", "flood_state", "structural_any") else round(float(v), 2)
        out["flood_model"]["factors"] = [{"label": FEATURE_LABEL.get(f["feature"], f["feature"]), "value": shown(f["feature"]),
                                          "shap": f["shap"], "direction": "raises" if f["shap"] > 0 else "lowers"}
                                         for f in fp["factors"]]
    ins = pd.read_sql(text("select date, inspection_type, result, corrosion_score_0_10 as corr from hist_inspections "
                           "where vehicle_id = :v order by date"), engine(), params={"v": vid})
    out["inspections"] = [{"date": str(x.date)[:10], "type": terms.label(x.inspection_type), "result": x.result,
                           "corrosion": None if pd.isna(x.corr) else float(x.corr)} for x in ins.itertuples()]
    out["flood_claims"] = r.flood_claims if isinstance(r.flood_claims, list) else []
    from .reports import for_plate
    out["lane_reports"] = for_plate(out["plate"], 3)
    out["how"] = (f"Exposure {r.exposure:.2f} with vehicle factor {r.susceptibility:.2f}: exposure risk "
                  f"1 - (1 - {r.exposure:.2f})^{r.susceptibility:.2f} = {r.exposure_score:.2f}"
                  + (f"; flood model {_pct(r.p_model)} (counts 0.6 x {r.p_model:.2f})" if r.p_model == r.p_model else
                     "; no inspection history, so the flood model is not used")
                  + f" -> risk {int(r.risk)}")
    return out


# ---------------------------------------------------------------- summaries
def areas(scope: str = LIVE) -> dict:
    d, ar = _scored(scope)
    registered = _fleet().groupby(["state", "district"]).size()
    out = []
    for (state, dist), a in ar.items():
        m = d[(d.state == state) & (d.district == dist)]
        w = a.get("worst")
        keep = ("id", "name", "status", "level", "alert", "warning", "danger", "updated")
        out.append({"state": state, "district": dist, "lat": a["lat"], "lon": a["lon"], "exposure": a["exposure"],
                    "level_exposure": a["level_e"], "rain_exposure": a["rain_e"], "stations": dict(a["stations"]),
                    "worst_station": {k: w[k] for k in keep} if w else None, "rain": a["rain"], "reasons": a["reasons"],
                    "headline": a["headline"], "vehicles": int(registered.get((state, dist), 0)),
                    "to_inspect": int((m.risk >= CHECK_RISK).sum()),
                    "flood_inspection": int((m.recommendation == "Flood-damage inspection").sum())})
    out.sort(key=lambda x: (-x["exposure"], -x["to_inspect"], x["state"], x["district"]))
    return {"scope": scope, "items": out}


def overview() -> dict:
    d, mode = data()
    st = stations_view()
    counts = Counter(s["status"] for s in st)
    by_state: dict[str, Counter] = {}
    for s in st:
        by_state.setdefault(s["state"], Counter())[s["status"]] += 1
    order = list(jps.STATES.values())
    live = vehicles(LIVE, page_size=1)["counts"]
    with session_scope() as s:
        trend = s.execute(select(FloodRefresh).order_by(FloodRefresh.fetched_at.desc()).limit(96)).scalars().all()
        trend = [{"fetched_at": t.fetched_at, "source": t.source, "counts": t.counts} for t in reversed(trend)]
    pos = Counter(s["position"] or "none" for s in st)
    rain = d.get("rain", [])
    wettest = max(rain, key=lambda r: r["max_mm"] or 0, default=None)
    return {
        "source": {"mode": mode, "fetched_at": d["fetched_at"], "age_min": round(_age_s(d) / 60), "refreshing": refreshing(),
                   "errors": d.get("errors") or {}, "last_error": _mem["error"], "url": jps.BASE + "/aras-air/data-paras-air/",
                   "positions": dict(pos), "ttl_min": TTL_S // 60},
        "counts": {k: counts.get(k, 0) for k in STATUSES}, "total": len(st),
        "by_state": [{"state": k, **{s: v.get(s, 0) for s in STATUSES}, "total": sum(v.values())}
                     for k, v in sorted(by_state.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 99)],
        "rain": {"districts": len(rain), "days_60mm": sum(1 for r in rain if (r["max_mm"] or 0) >= 60),
                 "wettest": {k: wettest[k] for k in ("state", "district", "max_mm", "max_day", "max_gauge")} if wettest else None},
        "live": live, "events": events(), "trend": trend, "method": METHOD,
    }


def invite(plates: list[str], scope: str = LIVE) -> dict:
    """Mock: record that the owners were invited for a flood-damage / corrosion inspection. Nothing is sent."""
    d, areas_ = _scored(scope)
    event = scope[6:] if scope.startswith("event:") else None
    with session_scope() as s:
        done = {i.vehicle_id for i in s.execute(select(FloodInvitation).where(FloodInvitation.scope == scope)).scalars()}
    invited, already, unknown = [], [], []
    for p in plates:
        try:
            vid = _find(p)
        except HTTPException:
            unknown.append(p)
            continue
        if vid in done:
            already.append(p)
            continue
        row = d.loc[[vid]] if vid in d.index else _score(_fleet(), pd.Series([0.0], index=[vid]), event)
        r = next(row.itertuples())
        reasons = [x["text"] for x in _reasons(r, areas_, event)]
        with session_scope() as s:
            inv = FloodInvitation(vehicle_id=vid, plate=r.plate, scope=scope, district=r.district, risk=int(r.risk),
                                  recommendation=str(r.recommendation), reasons=reasons)
            s.add(inv)
            s.flush()
            invited.append({"invite_id": inv.invite_id, "plate": r.plate, "recommendation": inv.recommendation})
        done.add(vid)
    return {"invited": invited, "already": already, "unknown": unknown, "channel": "mock",
            "note": "Recorded only: no SMS, e-mail or letter is sent in the demo."}


def invitations(limit: int = 50) -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(FloodInvitation).order_by(FloodInvitation.created_at.desc()).limit(limit)).scalars().all()
        return [{"invite_id": i.invite_id, "plate": i.plate, "scope": i.scope, "district": i.district, "risk": i.risk,
                 "recommendation": i.recommendation, "reasons": i.reasons, "created_at": i.created_at.isoformat(timespec="seconds")}
                for i in rows]

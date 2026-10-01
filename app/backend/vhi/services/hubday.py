"""Today at an inspection hub: the day's arrivals, queue, lanes and results.

At the demo hub (BR00, the Central Inspection Hub) the day is the ten main vehicles (services/showcase.py): a fixed plan
per lane - which vehicle, when it arrives, how long its inspection takes, what it finds - laid against the clock from an
anchor set when the day is first looked at (`restart()` sets it again). So the day flows naturally from the first look:
a few inspections are done, every lane is busy, one vehicle waits and one is still to come. Outside opening hours (and
on Sundays) the hub is shown at a fixed mid-morning moment, and the reply says so.

Other hubs keep a SYNTHETIC day drawn from the register (deterministic per hub and day), for the aggregate views.

Real things are laid on top: the owners', fleets' and staff's bookings for the day, and the live lane inspections (the
demo replays, whose sensors are simulated but whose analysis is live), which take over their vehicle and its lane.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import random
import threading
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .. import terms
from ..config import get_settings
from ..db import session_scope
from ..tables import Booking, Branch, EvidenceEntry, LiveInspection, Report, Setting, Vehicle
from . import booking as booking_svc
from . import showcase

OPEN, CLOSE = 8 * 60, 17 * 60 + 30
DEMO_MINUTE = 10 * 60 + 30
_lock = threading.Lock()
_vehicles: list[dict] | None = None

ADVISORIES = ["Headlamp aim slightly off", "Front tyre tread approaching the limit", "Wiper blades worn",
              "Minor oil seepage at the sump", "Brake pads at 4 mm", "Number-plate lamp dim", "Light corrosion on the exhaust"]
FAILS = ["Brake efficiency below the limit", "Tyre tread below the limit", "Window tint darker than allowed",
         "Headlamp not working", "Excessive smoke", "Suspension damper leaking", "Brake imbalance over 30%"]


def now_myt() -> dt.datetime:
    return dt.datetime.now(ZoneInfo(get_settings().timezone))


def clock(at: str | None = None) -> dict:
    """The day and minute the dashboard shows: now, or a fixed mid-morning moment when the hub is closed."""
    n = now_myt()
    minute = n.hour * 60 + n.minute
    if at:  # "HH:MM", for a presenter who wants another moment of the day
        h, m = (int(x) for x in at.split(":")[:2])
        return {"date": n.date().isoformat(), "minute": h * 60 + m, "demo": True, "note": f"Shown at {at}, as asked"}
    closed = n.weekday() == 6 or not (OPEN <= minute < CLOSE)
    if closed:
        return {"date": n.date().isoformat(), "minute": DEMO_MINUTE, "demo": True,
                "note": "The hub is closed now: the day is shown as it looks at 10:30"}
    return {"date": n.date().isoformat(), "minute": minute, "demo": False, "note": None}


def hhmm(m: float) -> str:
    m = int(round(m))
    return f"{m // 60:02d}:{m % 60:02d}"


def _register() -> list[dict]:
    global _vehicles
    with _lock:
        if _vehicles is None:
            with session_scope() as s:
                _vehicles = [{"vehicle_id": v.vehicle_id, "plate": v.plate, "make": v.make, "model": v.model, "year": v.year,
                              "vtype": v.vtype, "fuel": v.fuel, "usage": v.usage, "heavy": v.heavy, "owner": v.owner_name,
                              "owner_type": v.owner_type, "fleet_id": v.fleet_id, "state": v.state}
                             for v in s.execute(select(Vehicle).where(Vehicle.vtype != "Motorcycle",
                                                                      ~Vehicle.plate.like("DMO 900%"))).scalars()]
        return _vehicles


def _itype(v: dict, rng: random.Random) -> str:
    if v["heavy"] or v["usage"] in ("lorry", "bus", "van"):
        return "periodic_commercial"
    if v["usage"] in ("ehailing", "taxi"):
        return "periodic_ride_hailing"
    if v["fuel"] == "ev" and rng.random() < 0.5:
        return "ev_health"
    return rng.choices(["ownership_transfer", "voluntary", "financing"], [0.55, 0.3, 0.15])[0]


def _seed(*parts) -> int:
    return int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)


# The demo hub's day: (plate, lane, arrival, start, duration) in minutes after the anchor, the inspection type, the
# result and what it found. At anchor + 75 four are done, one per lane is on it, one waits and one is still to come.
DEMO_HUB = "BR00"
LOOK = 75
PLAN = [
    ("BHY 7783", 3, 0, 5, 40, "periodic_commercial", "PASS", []),
    ("VKR 3128", 1, 4, 9, 30, "periodic_ride_hailing", "FAIL", ["Brake disc scoring, front left", "Dent on the left front fender"]),
    ("PKE 4410", 2, 14, 19, 34, "periodic_ride_hailing", "PASS_ADVISORY", ["ADAS camera mount tilted", "Scratch on the rear door"]),
    ("WXD 2291", 4, 19, 25, 30, "periodic_commercial", "FAIL", ["Sidewall bulge, front right tyre", "Uneven tyre wear, outer shoulder"]),
    ("DMO 9003", 1, 48, 54, 34, "ownership_transfer", "PASS", []),
    ("DMO 9001", 3, 46, 50, 52, "periodic_commercial", "FAIL", ["Front tyre tread below the limit", "Particle number above the limit"]),
    ("DMO 9002", 2, 57, 62, 38, "ev_health", "PASS_ADVISORY", ["Flood claim on record: interior checked"]),
    ("DMO 9006", 4, 63, 68, 30, "voluntary", "PASS", []),
    ("JTR 5510", 3, 70, 106, 36, "periodic_commercial", "FAIL", ["Tail lamp cracked", "Oil-wet shock absorber, rear right"]),
    ("VJM 7412", 1, 96, 98, 28, "ownership_transfer", "PASS_ADVISORY", ["Rear bumper scratch", "12 V battery terminal corrosion"]),
]


def _anchor(day: str, minute: int, demo: bool) -> int:
    """The minute the demo hub's plan starts: kept for the day once set, so the day flows on from the first look."""
    if demo:
        return minute - LOOK
    with session_scope() as s:
        row = s.get(Setting, "hubday:anchor")
        if row and row.value.get("date") == day:
            return int(row.value["minute"])
        a = max(OPEN - 20, min(CLOSE - 170, minute - LOOK))
        s.merge(Setting(key="hubday:anchor", value={"date": day, "minute": a}))
        return a


def restart(at_minute: int | None = None) -> dict:
    """Start the demo hub's day again from now: four done, every lane busy, one waiting, one to come."""
    c = clock()
    m = at_minute if at_minute is not None else c["minute"]
    with session_scope() as s:
        s.merge(Setting(key="hubday:anchor", value={"date": c["date"], "minute": m - LOOK}))
    return {"date": c["date"], "anchor": hhmm(m - LOOK)}


def _demo_schedule(day: str, name: str, booked: list[tuple], c: dict | None = None) -> list[dict]:
    c = c or clock()
    a = _anchor(day, c["minute"], c["demo"]) if day == c["date"] else OPEN + 60
    rows = {v["plate"]: v for v in showcase.vehicles()}
    books = {b[0]: b for b in booked}
    out = []
    for k, (plate, lane, arr, start, dur, code, result, issues) in enumerate(PLAN):
        v = rows.get(plate)
        if v is None:
            continue
        bk = books.get(plate)
        label = booking_svc.TYPES.get(bk[2], {}).get("label", bk[2]) if bk else terms.label(code)
        out.append({
            "no": f"INS-{day.replace('-', '')}-{k + 1:04d}", "plate": plate, "vehicle_id": v["vehicle_id"],
            "make": v["make"], "model": v["model"], "year": v["year"], "vtype": v["vtype"], "fuel": v["fuel"],
            "owner": v["owner_name"] or "Company vehicle", "fleet_id": v["fleet_id"], "inspection_type": label,
            "arrival": a + arr, "lane": lane, "start": a + start, "end": a + start + dur, "result": result, "issues": issues,
            "source": "booking" if bk else "plan", "booking_id": bk[3] if bk else None, "branch": name,
        })
    return out


def schedule(branch_id: str, day: str, c: dict | None = None) -> list[dict]:
    """Every vehicle at the hub that day, with its arrival, lane, start and end (minutes after midnight)."""
    with session_scope() as s:
        br = s.get(Branch, branch_id)
        if br is None:
            return []
        lanes, heavy_ok, name = br.lanes, br.heavy_capable, br.name
        books = s.execute(select(Booking).where(Booking.branch_id == branch_id, Booking.date == day,
                                                Booking.status.in_(("confirmed", "checked_in")))).scalars().all()
        booked = [(b.plate, b.slot, b.inspection_type, b.booking_id, b.source) for b in books]
    d = dt.date.fromisoformat(day)
    if branch_id == DEMO_HUB:  # shown on Sundays too, at the demo moment
        return _demo_schedule(day, name, booked, c)
    if d.weekday() == 6:
        return []
    rng = random.Random(_seed(branch_id, day))
    pool = [v for v in _register() if heavy_ok or not v["heavy"]]
    n = int(round(lanes * rng.uniform(9.5, 11.5) * (0.75 if d.weekday() == 5 else 1.0)))
    picks = rng.sample(pool, min(n, len(pool)))
    arrivals = []
    for v in picks:
        # busier mornings: two overlapping waves of arrivals
        m = rng.gauss(10 * 60, 75) if rng.random() < 0.6 else rng.gauss(14 * 60 + 30, 80)
        arrivals.append((max(OPEN - 20, min(CLOSE - 50, m)), v, "schedule", None, None))
    by_plate = {v["plate"]: v for v in _register()}
    for plate, slot, itype, bid, src in booked:
        v = by_plate.get(plate)
        with session_scope() as s:
            if v is None:
                vv = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
                if vv is None:
                    continue
                v = {"vehicle_id": vv.vehicle_id, "plate": vv.plate, "make": vv.make, "model": vv.model, "year": vv.year,
                     "vtype": vv.vtype, "fuel": vv.fuel, "usage": vv.usage, "heavy": vv.heavy, "owner": vv.owner_name,
                     "owner_type": vv.owner_type, "fleet_id": vv.fleet_id, "state": vv.state}
        h, mm = (int(x) for x in slot.split(":"))
        arrivals.append((h * 60 + mm - 5, v, "booking", booking_svc.TYPES.get(itype, {}).get("label", itype), bid))
    arrivals.sort(key=lambda a: a[0])
    free = [float(OPEN)] * lanes
    out = []
    for k, (arr, v, src, label, bid) in enumerate(arrivals):
        r = random.Random(_seed(branch_id, day, v["plate"]))
        lane = min(range(lanes), key=lambda i: free[i])
        start = max(arr, free[lane]) + r.uniform(2, 6)
        dur = r.uniform(40, 55) if v["heavy"] else r.uniform(24, 38)
        end = start + dur
        free[lane] = end + r.uniform(2, 5)  # the lane is cleared for the next vehicle
        code = _itype(v, r)
        age = max(0, int(day[:4]) - int(v["year"]))
        roll = r.random()
        p_fail = min(0.35, 0.05 + 0.012 * age + (0.05 if v["heavy"] else 0))
        result = "FAIL" if roll < p_fail else ("PASS" if roll > p_fail + 0.22 else "PASS_ADVISORY")
        issues = (r.sample(FAILS, 1 + (r.random() < 0.3)) if result == "FAIL" else
                  r.sample(ADVISORIES, 1 + (r.random() < 0.25)) if result == "PASS_ADVISORY" else [])
        out.append({
            "no": f"INS-{day.replace('-', '')}-{k + 1:04d}", "plate": v["plate"], "vehicle_id": v["vehicle_id"],
            "make": v["make"], "model": v["model"], "year": v["year"], "vtype": v["vtype"], "fuel": v["fuel"],
            "owner": v["owner"] or "Company vehicle", "fleet_id": v["fleet_id"],
            "inspection_type": label or terms.label(code), "arrival": arr, "lane": lane + 1, "start": start, "end": end,
            "result": result, "issues": issues, "source": src, "booking_id": bid, "branch": name,
        })
    return out


def _state(item: dict, minute: int) -> dict:
    s = dict(item)
    if item["end"] <= minute:
        s["status"] = "completed"
    elif item["start"] <= minute:
        s["status"] = "in_progress"
        s["progress"] = round(100 * (minute - item["start"]) / (item["end"] - item["start"]))
        s["eta_min"] = round(item["end"] - minute)
    elif item["arrival"] <= minute:
        s["status"] = "in_queue"
        s["wait_min"] = max(1, round(item["start"] - minute))
    else:
        s["status"] = "scheduled"
    for k in ("arrival", "start", "end"):
        s[k + "_at"] = hhmm(item[k])
    return s


def _live(branch_id: str, day: str) -> list[dict]:
    """Today's live lane inspections at the hub (the demo replays), newest first."""
    tz = ZoneInfo(get_settings().timezone)
    start = dt.datetime.combine(dt.date.fromisoformat(day), dt.time(0), tz).astimezone(dt.timezone.utc).replace(tzinfo=None)
    with session_scope() as s:
        rows = s.execute(select(LiveInspection).where(LiveInspection.branch_id == branch_id, LiveInspection.started_at >= start)
                         .order_by(LiveInspection.started_at.desc())).scalars().all()
        reps = {r.inspection_id: r for r in s.execute(select(Report).where(
            Report.inspection_id.in_([li.inspection_id for li in rows]))).scalars()} if rows else {}
        vs = {v.plate: v for v in s.execute(select(Vehicle).where(Vehicle.plate.in_([li.plate for li in rows]))).scalars()} if rows else {}
        out = []
        for li in rows:
            v = vs.get(li.plate)
            rep = reps.get(li.inspection_id)
            out.append({"inspection_id": li.inspection_id, "session_id": li.session_id, "lane": int(li.lane_id.split("-L")[1]),
                        "plate": li.plate, "make": v.make if v else "", "model": v.model if v else "", "year": v.year if v else None,
                        "vtype": v.vtype if v else "", "fuel": v.fuel if v else "", "owner": (v.owner_name if v else "") or "Company vehicle",
                        "inspection_type": li.inspection_type, "status": li.status, "step": li.step,
                        "health": li.health_score, "verdict": rep.verdict if rep else li.verdict,
                        "started_at": li.started_at.replace(tzinfo=dt.timezone.utc).astimezone(tz).strftime("%H:%M")})
        return out


STEPS = ["check_in_anpr", "identity_ocr", "emission_idle_rev", "brake_roller", "suspension", "side_slip", "headlamp_tint",
         "undercarriage_ai", "above_carriage_ai", "examiner_review", "report"]


def today(branch_id: str = "BR00", at: str | None = None) -> dict:
    c = clock(at)
    day, minute = c["date"], c["minute"]
    # the latest live inspection of each vehicle (a replay run again replaces the earlier run); it takes the vehicle's
    # place in the day (the replays run the demo hub's own vehicles)
    live, live_plates = [], set()
    for li in _live(branch_id, day):
        if li["plate"] not in live_plates:
            live.append(li)
            live_plates.add(li["plate"])
    items = [_state(x, minute) for x in schedule(branch_id, day, c) if x["plate"] not in live_plates]
    if branch_id == DEMO_HUB:
        prev = None  # the same ten vehicles: no day-to-day comparison
    else:
        prev_day = (dt.date.fromisoformat(day) - dt.timedelta(days=1)).isoformat()
        prev = schedule(branch_id, prev_day)
        if not prev:  # after a Sunday, compare with the Saturday
            prev = schedule(branch_id, (dt.date.fromisoformat(day) - dt.timedelta(days=2)).isoformat())
    with session_scope() as s:
        br = s.get(Branch, branch_id)
        lanes_n, name, state = (br.lanes, br.name, br.state) if br else (0, branch_id, "")
    if branch_id == DEMO_HUB:
        lanes_n = min(lanes_n, max(x[1] for x in PLAN))  # the four lanes the demo vehicles and replays run on
    # lanes: a live inspection on a lane takes the lane while it is in the lane or awaiting the examiner
    live_on = {}
    for li in live:
        if li["lane"] not in live_on and li["status"] in ("in_lane", "review", "decided"):
            live_on[li["lane"]] = li
    lanes = []
    for k in range(1, lanes_n + 1):
        if k in live_on:
            li = live_on[k]
            step = STEPS.index(li["step"]) + 1 if li["step"] in STEPS else (len(STEPS) if li["status"] != "in_lane" else 0)
            lanes.append({"lane": k, "state": "operation", "live": True, "vehicle": li,
                          "progress": round(100 * step / len(STEPS)) if li["status"] == "in_lane" else 100,
                          "note": "Live · " + ("in the lane" if li["status"] == "in_lane" else "awaiting the examiner")})
            continue
        cur = next((x for x in items if x["lane"] == k and x["status"] == "in_progress"), None)
        nxt = next((x for x in sorted(items, key=lambda x: x["start"]) if x["lane"] == k and x["status"] in ("in_queue", "scheduled")), None)
        if cur:
            lanes.append({"lane": k, "state": "operation", "live": False, "vehicle": cur, "progress": cur["progress"],
                          "note": f"About {cur['eta_min']} min left"})
        elif nxt and nxt["start"] - minute <= 10 and nxt["arrival"] <= minute:
            lanes.append({"lane": k, "state": "preparing", "live": False, "vehicle": nxt, "progress": 0,
                          "note": f"Starts in {max(1, round(nxt['start'] - minute))} min"})
        else:
            last = max((x for x in items if x["lane"] == k and x["status"] == "completed"), key=lambda x: x["end"], default=None)
            lanes.append({"lane": k, "state": "idle", "live": False, "vehicle": None, "progress": 0, "note": "Lane available",
                          "next": {kk: nxt[kk] for kk in ("plate", "make", "model", "vtype", "start_at", "inspection_type")} if nxt else None,
                          "last": {kk: last[kk] for kk in ("plate", "make", "model", "vtype", "end_at", "result")} if last else None})
    done = [x for x in items if x["status"] == "completed"]
    live_done = [li for li in live if li["status"] == "reported"]
    issues = [x for x in done if x["result"] != "PASS"] + [li for li in live_done if li["verdict"] != "PASS"]
    inspected = len(done) + len(live_done)
    queue = sorted([x for x in items if x["status"] == "in_queue"], key=lambda x: x["start"])
    upcoming = sorted([x for x in items if x["status"] in ("in_queue", "scheduled")], key=lambda x: x["arrival"])
    total, total_prev = len(items) + len(live), (len(prev) if prev is not None else None)
    activity = []
    for x in items:
        if x["status"] == "completed":
            word = {"PASS": "Passed", "FAIL": "Failed", "PASS_ADVISORY": "Passed with advisory"}[x["result"]]
            activity.append({"at": x["end"], "kind": "completed", "title": "Inspection completed", "sub": f"{x['plate']} · {word}",
                             "result": x["result"], "plate": x["plate"]})
        if x["start"] <= minute:
            activity.append({"at": x["start"], "kind": "started", "title": "Inspection started", "sub": f"{x['plate']} · Lane {x['lane']}",
                             "plate": x["plate"]})
        if x["arrival"] <= minute:
            activity.append({"at": x["arrival"], "kind": "queued", "title": "New vehicle in queue",
                             "sub": f"{x['plate']} · {x['inspection_type']}", "plate": x["plate"]})
    for li in live:
        h, m = (int(v) for v in li["started_at"].split(":"))
        activity.append({"at": h * 60 + m, "kind": "live", "title": "Live inspection " + ("reported" if li["status"] == "reported" else "started"),
                         "sub": f"{li['plate']} · Lane {li['lane']}" + (f" · {li['verdict']}" if li["verdict"] else ""),
                         "plate": li["plate"], "inspection_id": li["inspection_id"], "live": True})
    activity = sorted([a for a in activity if a["at"] <= minute or a.get("live")], key=lambda a: -a["at"])[:14]
    for a in activity:
        a["time"] = hhmm(a["at"])
    photos: dict[str, dict | None] = {}

    def photo(plate: str) -> dict | None:
        if plate not in photos:
            try:
                from . import images
                photos[plate] = images.hero(plate)
            except Exception:  # noqa: BLE001 - a missing photo never breaks the dashboard
                photos[plate] = None
        return photos[plate]
    for ln in lanes:
        for key in ("vehicle", "next", "last"):
            if ln.get(key):
                ln[key] = {**ln[key], "photo": photo(ln[key]["plate"])}
    states = {"operation": 0, "preparing": 0, "idle": 0}
    for ln in lanes:
        states[ln["state"]] += 1
    return {
        "branch": {"branch_id": branch_id, "name": name, "state": state, "lanes": lanes_n},
        "clock": {**c, "time": hhmm(minute)},
        "kpis": {"total": total, "total_prev": total_prev, "completed": inspected,
                 "in_progress": sum(1 for ln in lanes if ln["state"] == "operation"),
                 "in_queue": len(queue), "issues": len(issues), "issue_rate": round(len(issues) / inspected, 3) if inspected else None,
                 "fails": sum(1 for x in done if x["result"] == "FAIL") + sum(1 for li in live_done if li["verdict"] == "FAIL")},
        "lanes": lanes, "utilization": {**states, "pct": round(100 * states["operation"] / lanes_n) if lanes_n else 0},
        "queue": [{**{k: x[k] for k in ("no", "plate", "make", "model", "vtype", "inspection_type", "wait_min", "lane", "start_at")},
                   "photo": photo(x["plate"])} for x in queue],
        "upcoming": [{**{k: x.get(k) for k in ("no", "plate", "make", "model", "vtype", "owner", "inspection_type", "arrival_at", "status",
                                               "source", "lane")}, "photo": photo(x["plate"])} for x in upcoming],
        "activity": activity, "live": live,
        "provenance": {"schedule": ("synthetic: the hub's plan for the ten main vehicles, laid against the clock" if branch_id == DEMO_HUB
                                    else "synthetic: drawn from the registered vehicles, deterministic per hub and day"),
                       "live": "live lane inspections (simulated sensors, live analysis)", "bookings": "real bookings made in the apps"},
    }


def item(plate: str, branch_id: str = "BR00") -> dict | None:
    """A vehicle's place in today's schedule, if it has one."""
    c = clock()
    for x in schedule(branch_id, c["date"]):
        if x["plate"] == plate:
            return _state(x, c["minute"])
    return None


def evidence_today(limit: int = 20) -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(EvidenceEntry).order_by(EvidenceEntry.seq.desc()).limit(limit)).scalars().all()
        return [{"seq": e.seq, "ts": e.ts, "kind": e.kind, "inspection_id": e.inspection_id, "actor": e.actor} for e in rows]

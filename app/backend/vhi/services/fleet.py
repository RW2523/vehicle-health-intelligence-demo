"""Fleet Intelligence (features 20, 27): fleet health, attention list, vehicle history, degradation, forecasts,
pattern reports and bulk booking. Everything is computed from the stored readings on request (cached)."""
from __future__ import annotations

import datetime as dt
import math
import threading
from collections import defaultdict

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy import func, select, text

from ..config import get_settings
from ..db import engine, session_scope
from ..fleet_metrics import METRICS, SYSTEMS
from ..ml.degradation import Point, analyse
from ..tables import Booking, Fleet, FleetReading, PatternReport, Vehicle
from . import booking as booking_svc

_cache: dict[str, dict] = {}
_lock = threading.Lock()
BASELINE_AVOIDED = {"OP-SMR": 7, "OP-TJR": 6, "OP-LPC": 5, "OP-KAS": 2, "OP-SCT": 2, "FLEET07": 4}
RISK_W = {"High": 2, "Medium": 1, "Low": 0}


def today() -> dt.date:
    return dt.date.fromisoformat(get_settings().demo_today)


def _vehicles(fleet_ids: list[str] | None = None) -> list[Vehicle]:
    with session_scope() as s:
        q = select(Vehicle).join(Fleet, Fleet.fleet_id == Vehicle.fleet_id).where(Fleet.showcase.is_(True))
        if fleet_ids:
            q = q.where(Vehicle.fleet_id.in_(fleet_ids))
        return list(s.execute(q).scalars().all())


def analyse_vehicle(v: Vehicle) -> dict:
    with _lock:
        if v.vehicle_id in _cache:
            return _cache[v.vehicle_id]
    rows = pd.read_sql(text("select metric, month, date, value, note, photo, source from fleet_readings where vehicle_id = :v "
                       "order by metric, date"), engine(), params={"v": v.vehicle_id})
    metrics = {}
    for m, g in rows.groupby("metric"):
        pts = [Point(i, r.date, float(r.value), r.note or "", r.photo, r.source) for i, r in enumerate(g.itertuples())]
        metrics[m] = analyse(pts, METRICS[m], v.km_per_month, today())
    sys_scores = {}
    for sname in SYSTEMS:
        ms = [a for a in metrics.values() if a["system"] == sname]
        sys_scores[sname] = min((a["score"] for a in ms), default=100)
    ranked = sorted(metrics.values(), key=lambda a: (-a["attention"], -a["risk_i"],
                                                      a["forecast"]["weeks_to_limit"] if a["forecast"]["weeks_to_limit"] is not None else 1e9))
    primary = ranked[0] if ranked else None
    health = round(float(np.mean(list(sys_scores.values())))) if sys_scores else None
    # monthly health history (for the fleet trend): score of each metric at each month
    months = sorted(rows.month.unique())
    hist = []
    for mi, _ in enumerate(months):
        per_sys = defaultdict(list)
        for a in metrics.values():
            pts = a["points"]
            if mi < len(pts):
                v0 = pts[0]["value"]
                used = (pts[mi]["value"] - v0) / (a["limit"] - v0) if a["limit"] != v0 else 0
                per_sys[a["system"]].append(100 - 70 * max(0.0, min(1.0, used)))
        hist.append(round(float(np.mean([min(x) for x in per_sys.values()])), 1) if per_sys else None)
    out = {"vehicle_id": v.vehicle_id, "health": health, "subsystems": sys_scores, "metrics": metrics,
           "primary": primary, "attention": bool(primary and primary["attention"]), "months": months,
           "health_history": hist}
    with _lock:
        _cache[v.vehicle_id] = out
    return out


def invalidate(vehicle_id: str | None = None) -> None:
    with _lock:
        if vehicle_id:
            _cache.pop(vehicle_id, None)
        else:
            _cache.clear()


def warm() -> int:
    vs = _vehicles()
    for v in vs:
        analyse_vehicle(v)
    return len(vs)


def fleets() -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(Fleet, func.count(Vehicle.vehicle_id)).join(Vehicle, Vehicle.fleet_id == Fleet.fleet_id)
                         .where(Fleet.showcase.is_(True)).group_by(Fleet.fleet_id)).all()
        return [{"fleet_id": f.fleet_id, "name": f.name, "branch_id": f.branch_id, "segment": f.segment, "vehicles": n}
                for f, n in rows]


def _booked() -> dict[str, dict]:
    with session_scope() as s:
        rows = s.execute(select(Booking).where(Booking.source.in_(("fleet", "api")), Booking.status != "cancelled")).scalars().all()
        return {b.plate: {"date": b.date, "slot": b.slot, "booking_id": b.booking_id} for b in rows}


def _vehicle_row(v: Vehicle, a: dict, fleet_names: dict, booked: dict) -> dict:
    p = a["primary"]
    ev = (v.ground_truth or {}).get("evidence") or []
    lane_dates = [pt["date"] for pt in p["points"] if pt["source"] == "lane_check"] if p else []
    fc = p["forecast"] if p else {}
    return {"vehicle_id": v.vehicle_id, "plate": v.plate, "make": v.make, "model": v.model, "vtype": v.vtype, "fuel": v.fuel,
            "fleet_id": v.fleet_id, "operator": fleet_names.get(v.fleet_id, v.fleet_id), "photo": v.photo,
            "evidence": ["captures/" + e for e in ev], "health": a["health"], "attention": a["attention"],
            "issue": p and {"metric": p["metric"], "name": p["name"], "system": p["system"], "icon": p["icon"],
                            "pattern": p["pattern"], "ratio_text": p["ratio_text"], "risk": p["risk"],
                            "weeks_label": fc.get("weeks_label"), "weeks": fc.get("weeks_to_limit"), "date": fc.get("date"),
                            "value": p["points"][-1]["value"], "unit": p["unit"], "limit": p["limit"],
                            "spark": [pt["value"] for pt in p["points"]], "anomalies": len([x for x in p["anomalies"] if x["kind"] != "repair"])},
            "last_check": lane_dates[-1] if lane_dates else None, "booked": booked.get(v.plate)}


def overview(fleet_id: str | None = None, vtype: str | None = None, branch_id: str | None = None, months: int = 12) -> dict:
    fl = fleets()
    names = {f["fleet_id"]: f["name"] for f in fl}
    ids = [f["fleet_id"] for f in fl if (not fleet_id or f["fleet_id"] == fleet_id) and (not branch_id or f["branch_id"] == branch_id)]
    vs = [v for v in _vehicles(ids) if not vtype or v.vtype == vtype]
    booked = _booked()
    rows, comp = [], defaultdict(int)
    hist_mat = []
    for v in vs:
        a = analyse_vehicle(v)
        comp[v.vtype] += 1
        if a["health_history"]:
            hist_mat.append(a["health_history"])
        rows.append(_vehicle_row(v, a, names, booked))
    total = len(vs)
    health_now = float(np.mean([r["health"] for r in rows if r["health"] is not None])) if rows else 0.0
    hm = np.array([h for h in hist_mat if len(h) == len(hist_mat[0])], dtype=float) if hist_mat else np.zeros((0, 0))
    trend = np.nanmean(hm, axis=0).round(1).tolist() if hm.size else []
    month_labels = analyse_vehicle(vs[0])["months"] if vs else []
    attention = sorted([r for r in rows if r["attention"]],
                       key=lambda r: (r["issue"]["weeks"] if r["issue"] and r["issue"]["weeks"] is not None else 1e9))
    prev = trend[-2] if len(trend) > 1 else health_now
    acc = [r for r in attention if r["issue"]["pattern"] in ("Accelerating", "Spike, then faster rise")]
    new_month = [r for r in attention if r["issue"]["anomalies"] and r["issue"]["risk"] != "Low"]
    good = sum(1 for r in rows if (r["health"] or 0) >= 70 and not r["attention"])
    app_bookings = sum(1 for r in rows if r["booked"])
    avoided = sum(BASELINE_AVOIDED.get(i, 0) for i in ids) + app_bookings
    reports_sent = pattern_report_count(ids)
    types = ["Sedan", "MPV", "Van", "Pickup", "Hatchback", "Lorry", "Prime mover", "Bus", "SUV"]
    return {
        "filters": {"fleet_id": fleet_id, "vtype": vtype, "branch_id": branch_id, "months": months},
        "fleets": fl, "total": total,
        "kpis": {"health": round(health_now), "health_delta": round(health_now - prev, 1), "good": good,
                 "alerts": len(attention), "alerts_new": len(new_month), "avoided": avoided, "avoided_from_app": app_bookings,
                 "accelerating": len(acc), "high_risk": sum(1 for r in attention if r["issue"]["risk"] == "High")},
        "trend": {"months": month_labels[-months:], "health": trend[-months:]},
        "composition": [{"vtype": t, "count": comp[t], "share": round(comp[t] / total, 3) if total else 0} for t in types if comp.get(t)],
        "attention": attention,
        "insights": {"avoided": avoided, "savings_rm": avoided * 560, "reports_sent": reports_sent,
                     "method": "Avoided = synthetic baseline for the operator + inspections booked from this portal before the forecast fail date; RM 560 per avoided failed test (demo assumption)."},
        "next_berkala": next_berkala_risk(ids),
        "source": {"readings": "synthetic monthly fleet checks / telematics / lane visits", "analysis": "live logic (vhi.ml.degradation)"},
    }


def next_berkala_risk(fleet_ids: list[str]) -> dict | None:
    """Next-inspection fail risk from the survival/next-fail model on each vehicle's latest synthetic inspection."""
    if "FLEET07" not in fleet_ids:
        return None
    from ..runtime import rt

    ins = pd.read_sql(text("select h.* from hist_inspections h join vehicles v on v.vehicle_id = h.vehicle_id "
                      "where v.fleet_id = 'FLEET07'"), engine())
    veh = {v.vehicle_id: v for v in _vehicles(["FLEET07"])}
    out = []
    for vid, g in ins.sort_values("date").groupby("vehicle_id"):
        last = g.iloc[-1].to_dict()
        v = veh.get(vid)
        if v is None:
            continue
        r = rt().models.fusion.next_fail(last, {"year": v.year, "heavy": v.heavy, "fuel": v.fuel, "odometer_km": v.odometer_km},
                                         last["result"] == "FAIL")
        due = (dt.date.fromisoformat(str(last["date"])[:10]) + dt.timedelta(days=182)).isoformat()
        out.append({"plate": v.plate, "model": f"{v.make} {v.model}", "p_fail_next": r["p_fail_next"],
                    "months_to_failure": r["months_to_failure_median"], "next_due": due, "last_result": last["result"]})
    out.sort(key=lambda r: -r["p_fail_next"])
    at_risk = [r for r in out if r["p_fail_next"] >= 0.5]
    return {"fleet_id": "FLEET07", "vehicles": out, "at_risk": len(at_risk), "threshold": 0.5,
            "model": "LightGBM next-fail + Weibull AFT (trained on synthetic inspection history)"}


def pattern_report_count(ids: list[str]) -> int:
    with session_scope() as s:
        return s.execute(select(func.count()).select_from(PatternReport).join(Vehicle, Vehicle.vehicle_id == PatternReport.vehicle_id)
                         .where(Vehicle.fleet_id.in_(ids))).scalar() or 0


def _get_vehicle(plate: str) -> Vehicle:
    from ..api.deps import norm_plate

    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == norm_plate(plate))).scalar_one_or_none()
        if v is None or not v.fleet_id:
            raise HTTPException(404, "fleet vehicle not found")
        return v


def report_text(v: Vehicle, a: dict) -> str:
    p = a["primary"]
    if not p:
        return f"{v.plate}: no condition readings on record."
    pts = p["points"]
    fc = p["forecast"]
    anoms = [x for x in p["anomalies"] if x["kind"] != "repair"]
    t = (f"{v.plate} ({v.make} {v.model}): {p['name'].lower()} went from {pts[0]['value']:g} to {pts[-1]['value']:g} {p['unit']} "
         f"in {len(pts)} months. Pattern: {p['pattern'].lower()}")
    if anoms:
        t += f", with {len(anoms)} anomal{'ies' if len(anoms) > 1 else 'y'} (latest {anoms[-1]['date']}"
        t += f": {anoms[-1]['context']})" if anoms[-1]["context"] else ")"
    t += ". "
    if fc["date"]:
        t += f"At the current rate it reaches the fail limit ({p['limit']:g} {p['unit']}) around {fc['date']} ({fc['weeks_label'].replace('~', 'about ')}). "
    else:
        t += "The drift is slow, but the change needs attention. "
    return t + f"Recommended: {p['action']}."


def recipients(v: Vehicle, a: dict, sent: PatternReport | None) -> list[dict]:
    p = a["primary"] or {}
    high = p.get("risk") == "High"
    recent = any(x["kind"] != "repair" for x in p.get("anomalies", []) if x["idx"] >= len(p.get("points", [])) - 3)
    auto = high or recent
    with session_scope() as s:
        f = s.get(Fleet, v.fleet_id)
        fname = f.name if f else v.fleet_id
        from ..tables import Branch
        br = s.get(Branch, f.branch_id) if f else None
    return [
        {"who": f"Fleet operator · {fname}", "status": ("Sent " + sent.created_at.strftime("%d %b %H:%M")) if sent else
         ("Auto-send due (rule matched)" if auto else "In weekly digest (Mon)"), "ok": bool(sent) or auto},
        {"who": "Driver app", "status": "Warning shown" if (high or sent) else "Not needed yet", "ok": high or bool(sent)},
        {"who": f"Inspection pre-brief · {br.name if br else ''}", "status": "Added for next visit", "ok": True},
        {"who": "Regulator", "status": "Escalates if unfixed for 14 days" if high else "Not required", "ok": not high},
    ]


REPORT_RULE = ("Reporting rule: High risk, or an anomaly in the last 3 months, goes to the operator within 24 h. "
               "Everything else goes in the weekly digest. High risk left unfixed for 14 days is escalated.")


def vehicle_detail(plate: str) -> dict:
    v = _get_vehicle(plate)
    a = analyse_vehicle(v)
    names = {f["fleet_id"]: f["name"] for f in fleets()}
    row = _vehicle_row(v, a, names, _booked())
    with session_scope() as s:
        sent = s.execute(select(PatternReport).where(PatternReport.vehicle_id == v.vehicle_id)
                         .order_by(PatternReport.created_at.desc())).scalars().first()
        f = s.get(Fleet, v.fleet_id)
    hist = pd.read_sql(text("select date, inspection_type, result, fail_reasons, odometer_km from hist_inspections where vehicle_id = :v "
                       "order by date desc"), engine(), params={"v": v.vehicle_id})
    p = a["primary"]
    checks = []
    if p:
        for i in [len(p["points"]) - 1 - k for k in range(len(p["points"]))]:
            pt = p["points"][i]
            if pt["source"] == "lane_check" or pt["note"] or pt["photo"]:
                v0, lim = p["points"][0]["value"], p["limit"]
                used = (pt["value"] - v0) / (lim - v0) if lim != v0 else 0
                res = "Fail risk" if used >= 0.75 else ("Advisory" if used >= 0.4 or pt["note"] else "Pass")
                checks.append({"date": pt["date"], "kind": {"lane_check": "AI lane check", "fleet_check": "Fleet check",
                                                             "telematics": "Telematics"}.get(pt["source"], pt["source"]),
                               "value": pt["value"], "unit": p["unit"], "result": res, "note": pt["note"], "photo": pt["photo"]})
    photos = [{"date": pt["date"], "value": pt["value"], "unit": p["unit"], "photo": pt["photo"]}
              for pt in (p["points"] if p else []) if pt["photo"]]
    return {
        "vehicle": {**row, "year": v.year, "odometer_km": v.odometer_km, "km_per_month": v.km_per_month, "operator": names.get(v.fleet_id),
                    "branch_id": f.branch_id if f else None, "mvl_expiry": v.mvl_expiry},
        "health": a["health"], "subsystems": a["subsystems"], "primary": p,
        "metrics": sorted(a["metrics"].values(), key=lambda m: (-m["attention"], -m["risk_i"])),
        "checks": checks[:6], "photos": photos, "inspections": hist.to_dict("records"),
        "report": {"text": report_text(v, a), "recipients": recipients(v, a, sent), "rule": REPORT_RULE,
                   "sent_at": sent.created_at.isoformat() if sent else None},
    }


def send_report(plate: str, actor: str = "fleet manager") -> dict:
    v = _get_vehicle(plate)
    a = analyse_vehicle(v)
    p = a["primary"] or {}
    with session_scope() as s:
        r = PatternReport(vehicle_id=v.vehicle_id, metric=p.get("metric", ""), text=report_text(v, a), risk=p.get("risk", "Low"),
                          recipients={"operator": True, "driver_app": True}, trigger=f"manual:{actor}")
        s.add(r)
        s.flush()
        rid = r.report_id
    return {"report_id": rid, **vehicle_detail(plate)["report"]}


def book(plates: list[str], fleet_id: str | None = None) -> list[dict]:
    """Book an inspection for each vehicle before its forecast fail date (earliest free slot at the fleet's branch)."""
    out = []
    for plate in plates:
        v = _get_vehicle(plate)
        a = analyse_vehicle(v)
        with session_scope() as s:
            f = s.get(Fleet, v.fleet_id)
        fc = (a["primary"] or {}).get("forecast", {})
        latest = dt.date.fromisoformat(fc["date"]) - dt.timedelta(days=14) if fc.get("date") else today() + dt.timedelta(days=21)
        d = max(today() + dt.timedelta(days=2), min(latest, today() + dt.timedelta(days=45)))
        b = None
        for _ in range(20):
            if d.weekday() != 6:
                free = [x for x in booking_svc.slots(f.branch_id, d.isoformat()) if x["available"] and not x["gear"]]
                if free:
                    itype = "BERKALA" if v.heavy or v.usage in ("lorry", "van", "ehailing") else "VOLUNTARY"
                    b = booking_svc.create(v.plate, f.branch_id, d.isoformat(), free[0]["time"], itype, source="fleet",
                                           fleet_id=v.fleet_id)
                    break
            d += dt.timedelta(days=1)
        out.append(b or {"plate": v.plate, "error": "no slot found"})
    return out


def api_vehicles(fleet_id: str) -> list[dict]:
    names = {f["fleet_id"]: f["name"] for f in fleets()}
    booked = _booked()
    out = []
    for v in _vehicles([fleet_id]):
        r = _vehicle_row(v, analyse_vehicle(v), names, booked)
        out.append({k: r[k] for k in ("plate", "make", "model", "vtype", "health", "attention", "issue", "booked")})
    return out


_ = (math, FleetReading)

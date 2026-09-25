"""HQ operations (features 23, 26, 28, 31) and the regulator view (features 29, 30)."""
from __future__ import annotations

import datetime as dt
import json
import threading
import time
from functools import lru_cache

import httpx
import numpy as np
import pandas as pd
from sqlalchemy import func, select, text

from ..config import get_settings
from ..db import engine, session_scope
from ..ml import analytics
from ..tables import Alert, Branch, LiveInspection, Setting
from . import evidence

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def _cached(key: str, ttl: float, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (time.time(), val)
    return val


# ---------------------------------------------------------------- HQ
def integrity() -> dict:
    def run():
        ins = pd.read_sql(text("select * from hist_inspections"), engine())
        veh = pd.read_sql(text("select vehicle_id, heavy from vehicles"), engine())
        ex = pd.read_sql(text("select examiner_id, name from examiners"), engine())
        return analytics.examiner_integrity(ins, veh, ex)
    return _cached("integrity", 600, run)


def equipment() -> dict:
    return _cached("equipment", 600, lambda: analytics.equipment_health(pd.read_sql(text("select * from hist_equipment"), engine())))


def demand(branch_id: str, models) -> dict:
    def run():
        b = pd.read_sql(text("select * from hist_bookings"), engine())
        fc = models.demand.forecast(b, branch_id, 14)
        recent = b[b.branch_id == branch_id].sort_values("date").tail(28)
        gap_days = [d for d in fc if d["gap"] > 0]
        extra = int(sum(d["gap"] for d in gap_days))
        with session_scope() as s:
            br = s.get(Branch, branch_id)
        per_lane = max(1, int(recent.capacity_slots.iloc[-1] / max(1, br.lanes)))
        roster = [{"date": d["date"], "extra_slots": d["gap"], "extra_lane_shifts": int(np.ceil(d["gap"] / per_lane))} for d in gap_days]
        return {"branch_id": branch_id, "branch": br.name if br else branch_id, "lanes": br.lanes if br else None,
                "forecast": fc, "recent": [{"date": r.date, "demand": int(r.demand_requests), "capacity": int(r.capacity_slots),
                                            "booked": int(r.booked), "gear": int(r.gear_premium_booked), "no_show": int(r.no_show)}
                                           for r in recent.itertuples()],
                "summary": {"days_over_capacity": len(gap_days), "extra_slots_needed": extra, "roster": roster,
                            "slots_per_lane_day": per_lane},
                "model": "LightGBM (calendar, holidays, lags) - see /api/system/status for holdout error"}
    return _cached(f"demand:{branch_id}", 300, run)


def live_ops() -> dict:
    with session_scope() as s:
        rows = s.execute(select(LiveInspection.status, func.count()).group_by(LiveInspection.status)).all()
        n_alerts = s.execute(select(Alert.status, func.count()).group_by(Alert.status)).all()
        recent = s.execute(select(LiveInspection).order_by(LiveInspection.started_at.desc()).limit(10)).scalars().all()
        return {"inspections_by_status": dict(rows), "alerts_by_status": dict(n_alerts),
                "recent": [{"inspection_id": r.inspection_id, "plate": r.plate, "lane_id": r.lane_id, "status": r.status,
                            "health": r.health_score, "verdict": r.verdict, "started_at": r.started_at.isoformat()} for r in recent]}


def audit() -> dict:
    v = evidence.verify()
    return {"verify": v, "recent": evidence.entries(limit=25)}


# ---------------------------------------------------------------- regulator
def _snapshot(name: str) -> dict:
    p = get_settings().assets_dir / "web_snapshots" / name
    return json.loads(p.read_text()) if p.exists() else {}


def web_data() -> dict:
    with session_scope() as s:
        live = s.get(Setting, "web_live")
    live = live.value if live else {}
    return {
        "fuelprice": live.get("fuelprice") or _snapshot("fuelprice.json"),
        "weather_warnings": live.get("weather_warnings") or _snapshot("weather_warnings.json"),
        "flood_stations": live.get("flood_stations") or _snapshot("flood_warning_stations.json"),
        "weather_forecast": _snapshot("weather_forecast_shah_alam.json"),
        "refreshed_at": live.get("refreshed_at"),
        "mode": "live" if live else "snapshot",
    }


def refresh_web() -> dict:
    """Try the live data.gov.my APIs; keep the cached snapshot when offline."""
    api = "https://api.data.gov.my"
    out, errors = {}, {}
    feeds = {"fuelprice": (f"{api}/data-catalogue", {"id": "fuelprice", "limit": 10, "sort": "-date"}),
             "weather_warnings": (f"{api}/weather/warning", {"limit": 20}),
             "flood_stations": (f"{api}/flood-warning", {"limit": 50})}
    for k, (url, params) in feeds.items():
        try:
            r = httpx.get(url, params=params, timeout=8)
            r.raise_for_status()
            out[k] = {"source": str(r.url), "captured": dt.datetime.now().isoformat(timespec="seconds"), "records": r.json()}
        except (httpx.HTTPError, ValueError) as e:
            errors[k] = str(e)[:120]
    if out:
        out["refreshed_at"] = dt.datetime.now().isoformat(timespec="seconds")
        with session_scope() as s:
            s.merge(Setting(key="web_live", value=out))
    return {"updated": sorted(k for k in out if k != "refreshed_at"), "errors": errors,
            "note": "Offline or blocked: the dashboards keep using the last snapshot." if errors else "ok"}


@lru_cache(maxsize=1)
def _hist_frames():
    ins = pd.read_sql(text("select vehicle_id, date, branch_id, result, fail_reasons, smoke_opacity_pct, pn_per_cm3, ev_soh_pct, "
                      "hv_isolation_mohm, co_pct, hc_ppm from hist_inspections"), engine())
    veh = pd.read_sql(text("select vehicle_id, fuel, usage, heavy, year, state from vehicles"), engine())
    return ins.merge(veh, on="vehicle_id", how="left")


def regulator() -> dict:
    def run():
        df = _hist_frames()
        df["month"] = df.date.str[:7]
        counts = df.month.value_counts()
        full = [m for m in sorted(counts.index) if counts[m] >= 0.5 * counts.median()]  # drop the partial current month
        last12 = full[-12:]
        d12 = df[df.month.isin(last12)]
        monthly = d12.groupby("month").agg(inspections=("result", "size"), fail_rate=("result", lambda s: float((s == "FAIL").mean())))
        reasons = d12.fail_reasons.fillna("").str.split(";").explode()
        reasons = reasons[reasons != ""].value_counts().head(8)
        by_branch = df.groupby("branch_id").agg(inspections=("result", "size"), fail_rate=("result", lambda s: float((s == "FAIL").mean())))
        with session_scope() as s:
            brs = {b.branch_id: b for b in s.execute(select(Branch)).scalars()}
        ev = df[df.fuel == "ev"].copy()
        for col in ("hv_isolation_mohm", "ev_soh_pct"):
            ev[col] = pd.to_numeric(ev[col], errors="coerce")
        ev_issues = ev[(ev.hv_isolation_mohm < 2) | (ev.ev_soh_pct < 75)]
        rs = pd.read_sql(text("select * from hist_remote_sensing"), engine())
        rs["high_emitter_flag"] = rs["high_emitter_flag"].astype(bool)
        sites = rs.groupby("site").agg(lat=("lat", "first"), lon=("lon", "first"), readings=("plate", "size"),
                                       high_emitters=("high_emitter_flag", "sum"), co=("co_pct", "mean"),
                                       hc=("hc_ppm", "mean"), no=("no_ppm", "mean"), smoke=("pm_uv_smoke", "mean")).reset_index()
        hits = rs[rs.high_emitter_flag].sort_values("timestamp", ascending=False).head(12)
        reg = _snapshot("jpj_registrations_2025.json")
        with session_scope() as s:
            live_ev = s.execute(select(func.count()).select_from(Alert).where(Alert.code.like("ev:%"))).scalar()
        return {
            "registrations": reg,
            "defects": {"monthly": [{"month": m, "inspections": int(r.inspections), "fail_rate": round(r.fail_rate, 3)}
                                    for m, r in monthly.iterrows()],
                        "top_reasons": [{"reason": k, "count": int(v)} for k, v in reasons.items()]},
            "branches": [{"branch_id": b, "name": brs[b].name if b in brs else b, "lat": brs[b].lat if b in brs else None,
                          "lon": brs[b].lon if b in brs else None, "inspections": int(r.inspections),
                          "fail_rate": round(r.fail_rate, 3)} for b, r in by_branch.iterrows()],
            "ev": {"inspections": int(len(ev)), "flagged": int(len(ev_issues)), "live_alerts": int(live_ev or 0),
                   "hv_isolation_below_2": int((ev.hv_isolation_mohm < 2).sum()), "soh_below_75": int((ev.ev_soh_pct < 75).sum())},
            "remote_sensing": {"sites": sites.round(3).to_dict("records"),
                               "hits": hits[["timestamp", "site", "plate", "co_pct", "hc_ppm", "no_ppm", "pm_uv_smoke"]].to_dict("records"),
                               "total": int(len(rs)), "high_emitters": int(rs.high_emitter_flag.sum()),
                               "source": "simulated roadside remote-sensing feed"},
            "sources": {"registrations": "real (data.gov.my snapshot)", "defects": "synthetic inspection history",
                        "remote_sensing": "simulated", "web": "live data.gov.my when reachable, else snapshot"},
        }
    out = dict(_cached("regulator", 300, run))
    out["web"] = web_data()
    return out


# ---------------------------------------------------------------- owner: self-check and passport
def self_check(plate: str, attempt: dict, models) -> dict:
    """Pre-inspection self-check (feature 3). Photos run through the tyre model, the 20 s engine clip through the
    acoustic model; tint and headlamp readings come from the phone check (simulated inputs in the demo)."""
    s = get_settings()
    items = []
    tint = attempt.get("tint_vlt_pct")
    if tint is not None:
        ok = tint >= 50
        items.append({"item": "Window tint", "value": f"VLT {tint}%", "ok": ok, "source": "simulated (phone light check)",
                      "advice": None if ok else "Tint is darker than 50% on the front side windows. Remove or replace the film."})
    for side in ("left", "right"):
        st = attempt.get(f"headlamp_{side}")
        if st is not None:
            ok = st == "ok"
            items.append({"item": f"Headlamp ({side})", "value": st, "ok": ok, "source": "simulated (photo check)",
                          "advice": None if ok else f"The {side} headlamp is not working. Replace the bulb before the inspection."})
    for i, ref in enumerate(attempt.get("tyre_images", [])):
        p = s.data_dir / ref
        r = models.vision.classify("tyre", p)
        ok = not (r.get("available") and r["class"] == "defective" and r["p"] >= 0.6)
        items.append({"item": f"Tyre {i + 1}", "value": r.get("label"), "p": r.get("p"), "ok": ok, "image": f"/media/data/{ref}",
                      "source": f"live model ({r.get('arch', 'YOLO11')})", "advice": None if ok else "This tyre looks damaged or worn. Have it checked."})
    if attempt.get("engine_audio"):
        r = models.acoustic.classify(s.data_dir / attempt["engine_audio"])
        ok = r["top"]["class"] in ("normal_engine", "lane_background") or r["top"]["p"] < 0.4
        items.append({"item": "Engine sound (20 s)", "value": r["top"]["label"], "p": r["top"]["p"], "ok": ok,
                      "source": "live model (acoustic classifier)", "clip": f"/media/data/{attempt['engine_audio']}",
                      "advice": None if ok else "An unusual engine sound was detected. Ask a workshop to check it."})
    fails = [i for i in items if not i["ok"]]
    verdict = "Fix these first" if fails else "Likely to pass"
    from ..tables import SelfCheck
    with session_scope() as sess:
        sc = SelfCheck(plate=plate, results={"items": items}, verdict=verdict)
        sess.add(sc)
        sess.flush()
        cid = sc.check_id
    return {"check_id": cid, "plate": plate, "verdict": verdict, "items": items, "to_fix": [i["advice"] for i in fails]}


def passport(plate: str) -> dict:
    from ..api.deps import norm_plate, vehicle_public
    from ..tables import Booking, Report, SelfCheck, Vehicle

    plate = norm_plate(plate)
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
        if v is None:
            return {}
        vp = vehicle_public(v)
        reps = s.execute(select(Report).where(Report.plate == plate).order_by(Report.created_at)).scalars().all()
        checks = s.execute(select(SelfCheck).where(SelfCheck.plate == plate).order_by(SelfCheck.created_at)).scalars().all()
        books = s.execute(select(Booking).where(Booking.plate == plate).order_by(Booking.created_at)).scalars().all()
        events = []
        for r in reps:
            events.append({"date": r.created_at.date().isoformat(), "kind": "report", "title": f"{r.kind}: {r.verdict}",
                           "health": (r.data.get("health") or {}).get("score"), "verify_token": r.verify_token, "source": "live"})
        for c in checks:
            events.append({"date": c.created_at.date().isoformat(), "kind": "self_check", "title": f"Self-check: {c.verdict}",
                           "items": c.results.get("items", []), "source": "live"})
        for b in books:
            events.append({"date": b.date, "kind": "booking", "title": f"Booked {b.inspection_type} {b.slot}"
                           + (" (GEAR)" if b.gear else ""), "status": b.status, "source": "live"})
    hist = pd.read_sql(text("select date, inspection_type, result, fail_reasons, odometer_km, branch_id from hist_inspections "
                       "where vehicle_id = :v"), engine(), params={"v": vp["vehicle_id"]})
    for r in hist.itertuples():
        events.append({"date": str(r.date)[:10], "kind": "inspection", "title": f"{r.inspection_type}: {r.result}",
                       "odometer_km": int(r.odometer_km), "fail_reasons": r.fail_reasons, "source": "history (synthetic)"})
    claims = pd.read_sql(text("select claim_date, claim_type, amount_rm, ber_total_loss from hist_claims where vehicle_id = :v"),
                         engine(), params={"v": vp["vehicle_id"]})
    for r in claims.itertuples():
        events.append({"date": str(r.claim_date)[:10], "kind": "claim", "title": f"Insurance claim: {r.claim_type.replace('_', ' ')}",
                       "amount_rm": float(r.amount_rm), "source": "insurer feed (synthetic)"})
    events.sort(key=lambda e: e["date"], reverse=True)
    health = next((e["health"] for e in events if e.get("health") is not None), None)
    return {"vehicle": vp, "events": events, "health": health}

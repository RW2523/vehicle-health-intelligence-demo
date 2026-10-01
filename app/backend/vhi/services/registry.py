"""The vehicle register and one vehicle's whole profile (identity, owner, inspections, lane reports, health trends,
photos, claims, bookings, today's visit). The inspection app lists the ten main vehicles (services/showcase.py); the
whole synthetic register stays available with scope=all. Global search and the notification feed live here too."""
from __future__ import annotations

import datetime as dt
import threading
import time
from urllib.parse import quote

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import or_, select, text

from .. import terms
from ..api.deps import clean, norm_plate, vehicle_public
from ..db import engine, session_scope
from ..tables import Alert, Booking, Fleet, LiveInspection, Listing, Report, Vehicle
from . import booking as booking_svc
from . import hubday, showcase
from .reports import for_plate

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "latest": None}


def _latest() -> pd.DataFrame:
    """Each vehicle's latest inspection on record and how many it has (cached for ten minutes)."""
    with _lock:
        if _cache["latest"] is not None and time.time() - _cache["at"] < 600:
            return _cache["latest"]
    h = pd.read_sql(text("select vehicle_id, date, result, inspection_type, odometer_km from hist_inspections"), engine())
    h["date"] = h["date"].astype(str).str[:10]
    h = h.sort_values("date")
    last = h.groupby("vehicle_id").tail(1).set_index("vehicle_id")
    last["count"] = h.groupby("vehicle_id").size()
    with _lock:
        _cache.update(at=time.time(), latest=last)
    return last


def _row(v: Vehicle, last: pd.DataFrame, reports: dict) -> dict:
    r = last.loc[v.vehicle_id] if v.vehicle_id in last.index else None
    rep = reports.get(v.plate)
    latest = None
    if rep is not None:
        latest = {"date": rep.created_at.date().isoformat(), "result": rep.verdict, "type": rep.kind, "source": "lane"}
    elif r is not None:
        latest = {"date": r["date"], "result": r["result"], "type": terms.label(r["inspection_type"]), "source": "history"}
    return {"plate": v.plate, "make": v.make, "model": v.model, "year": v.year, "vtype": v.vtype, "fuel": v.fuel,
            "usage": v.usage, "state": v.state, "owner": v.owner_name or ("Fleet vehicle" if v.fleet_id else "Company vehicle"),
            "fleet_id": v.fleet_id, "odometer_km": v.odometer_km, "photo": v.photo,
            "inspections": int(r["count"]) if r is not None else 0, "latest": latest}


def _photo(plate: str) -> dict | None:
    """The vehicle's hero photo (services/images.py), if the image library has one."""
    try:
        from . import images
        return images.hero(plate)
    except Exception:  # noqa: BLE001 - a missing photo must never break a list
        return None


def _health(v: Vehicle) -> dict | None:
    """A fleet vehicle's most urgent health trend: the metric, its risk and the time left before its fail limit."""
    if not v.fleet_id:
        return None
    try:
        from . import fleet
        a = fleet.analyse_vehicle(v)
        p = a.get("primary")
        if not p:
            return None
        return {"metric": p.get("name") or p.get("metric"), "risk": p.get("risk"), "weeks_label": (p.get("forecast") or {}).get("weeks_label"),
                "attention": bool(p.get("attention"))}
    except Exception:  # noqa: BLE001
        return None


def listing(q: str = "", vtype: str = "", fuel: str = "", state: str = "", result: str = "", page: int = 1, page_size: int = 25,
            scope: str = "main") -> dict:
    last = _latest()
    main = scope != "all"
    with session_scope() as s:
        stmt = select(Vehicle)
        if main:
            stmt = stmt.where(Vehicle.plate.in_(showcase.MAIN_PLATES))
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(Vehicle.plate.ilike(f"%{norm_plate(q)}%"), Vehicle.plate.ilike(like), Vehicle.make.ilike(like),
                                  Vehicle.model.ilike(like), Vehicle.owner_name.ilike(like)))
        if vtype:
            stmt = stmt.where(Vehicle.vtype == vtype)
        if fuel:
            stmt = stmt.where(Vehicle.fuel == fuel)
        if state:
            stmt = stmt.where(Vehicle.state == state)
        vs = s.execute(stmt.order_by(Vehicle.plate)).scalars().all()
        reports = {}
        for r in s.execute(select(Report).order_by(Report.created_at)).scalars():
            reports[r.plate] = r
        if main:
            order = {p: k for k, p in enumerate(showcase.MAIN_PLATES)}
            vs = sorted(vs, key=lambda v: order[v.plate])
        rows = [_row(v, last, reports) for v in vs]
        if main:
            c = hubday.clock()
            today = {x["plate"]: x for x in hubday.day_states("BR00", c)}
            for r, v in zip(rows, vs):
                m = showcase.BY_PLATE[v.plate]
                t = today.get(v.plate)
                r.update(story=m["story"], session=m["session"], lane=m["lane"], photo=_photo(v.plate), health=_health(v),
                         today={k: t[k] for k in ("status", "lane", "arrival_at", "end_at", "result", "inspection_type", "issues")} if t else None)
                if t and t["status"] == "completed" and (not r["latest"] or r["latest"]["source"] == "history"):
                    r["inspections"] += 1
                    r["latest"] = {"date": c["date"], "result": "FAIL" if t["result"] == "FAIL" else "PASS", "type": t["inspection_type"],
                                   "source": "today", "advisory": t["result"] == "PASS_ADVISORY"}
    if result:
        rows = [r for r in rows if r["latest"] and r["latest"]["result"] == result]
    page_size = max(5, min(page_size, 100))
    pages = max(1, -(-len(rows) // page_size))
    page = max(1, min(page, pages))
    counts = {"total": len(rows), "pass": sum(1 for r in rows if r["latest"] and r["latest"]["result"] == "PASS"),
              "fail": sum(1 for r in rows if r["latest"] and r["latest"]["result"] == "FAIL"),
              "never": sum(1 for r in rows if not r["latest"])}
    return clean({"items": rows[(page - 1) * page_size: page * page_size], "page": page, "pages": pages,
                  "page_size": page_size, "counts": counts})


def facets() -> dict:
    with session_scope() as s:
        vt = sorted({v for (v,) in s.execute(select(Vehicle.vtype).distinct())})
        fu = sorted({v for (v,) in s.execute(select(Vehicle.fuel).distinct())})
        st = sorted({v for (v,) in s.execute(select(Vehicle.state).distinct()) if v})
    return {"vtypes": vt, "fuels": fu, "states": st}


def profile(plate: str) -> dict:
    plate = norm_plate(plate)
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
        if v is None:
            raise HTTPException(404, f"vehicle {plate} not found")
        vp = vehicle_public(v)
        fleet = s.get(Fleet, v.fleet_id) if v.fleet_id else None
        listing_row = s.execute(select(Listing).where(Listing.plate == plate)).scalars().first()
        books = [booking_svc.booking_dict(b) for b in s.execute(select(Booking).where(Booking.plate == plate)
                                                                .order_by(Booking.created_at.desc()).limit(10)).scalars()]
        live = [{"inspection_id": li.inspection_id, "status": li.status, "lane_id": li.lane_id, "inspection_type": li.inspection_type,
                 "started_at": li.started_at.isoformat(), "health": li.health_score, "verdict": li.verdict}
                for li in s.execute(select(LiveInspection).where(LiveInspection.plate == plate)
                                    .order_by(LiveInspection.started_at.desc()).limit(10)).scalars()]
    hist = pd.read_sql(text("select * from hist_inspections where vehicle_id = :v order by date"), engine(), params={"v": v.vehicle_id})
    claims = pd.read_sql(text("select claim_date, claim_type, amount_rm, ber_total_loss from hist_claims where vehicle_id = :v "
                              "order by claim_date"), engine(), params={"v": v.vehicle_id})
    inspections = [{"id": r["inspection_id"], "date": str(r["date"])[:10], "type": terms.label(r["inspection_type"]),
                    "result": r["result"], "odometer_km": r["odometer_km"], "branch_id": r["branch_id"],
                    "fail_reasons": [x for x in r["fail_reasons"].split(";") if x] if isinstance(r.get("fail_reasons"), str) else [],
                    "brake_efficiency_pct": r.get("brake_efficiency_pct"), "tyre_tread_min_mm": r.get("tyre_tread_min_mm"),
                    "corrosion": r.get("corrosion_score_0_10")} for r in hist.to_dict("records")]
    odo = [{"date": i["date"], "km": i["odometer_km"]} for i in inspections if i["odometer_km"] == i["odometer_km"]]
    top = max(odo, key=lambda p: p["km"]) if odo else None
    rollback = bool(top and vp["odometer_km"] < top["km"] - 1000)
    return clean({
        "vehicle": vp, "fleet": {"fleet_id": fleet.fleet_id, "name": fleet.name} if fleet else None,
        "inspections": inspections, "reports": for_plate(plate, 10), "live": live, "bookings": books,
        "claims": [{"date": str(c["claim_date"])[:10], "type": c["claim_type"].replace("_", " "), "amount_rm": c["amount_rm"],
                    "total_loss": bool(c["ber_total_loss"])} for c in claims.to_dict("records")],
        "odometer": {"points": odo, "rollback": rollback, "max": top},
        "today": hubday.item(plate),
        "main": showcase.BY_PLATE.get(plate), "fleet_health": bool(v.fleet_id), "photos": _photos(plate), "library": _library(plate),
        "links": {"health": f"/vehicles/{quote(plate)}?tab=health",
                  "sale": f"/oversight/sales?id={listing_row.listing_id}" if listing_row else None,
                  "flood": f"/oversight/flood?vehicle={quote(plate)}",
                  "passport": f"/mobile/vehicle?plate={quote(plate)}" if v.owner_type == "individual" else None,
                  "appointments": f"/appointments?plate={quote(plate)}"},
    })


def _photos(plate: str) -> dict | None:
    try:
        from . import images
        return images.vehicle_photos(plate)
    except Exception:  # noqa: BLE001
        return None


def _library(plate: str) -> list[dict]:
    """The sample inspection images that show this vehicle (the image library: AI boxes pre-drawn, SAMPLE)."""
    from . import library
    return [{**library.summary(e), "full_url": e["full_url"], "vehicle": e.get("vehicle"), "camera": e.get("camera"),
             "findings": e["findings"]} for e in library.for_vehicle(plate)]


def search(q: str) -> dict:
    q = q.strip()
    if len(q) < 2:
        return {"q": q, "groups": []}
    like, plate_like = f"%{q}%", f"%{norm_plate(q)}%"
    groups = []
    with session_scope() as s:
        vs = s.execute(select(Vehicle).where(Vehicle.plate.in_(showcase.MAIN_PLATES),
                                             or_(Vehicle.plate.ilike(plate_like), Vehicle.plate.ilike(like), Vehicle.owner_name.ilike(like),
                                                 Vehicle.usage.ilike(like), (Vehicle.make + " " + Vehicle.model).ilike(like)))
                       .order_by(Vehicle.plate).limit(6)).scalars().all()
        if vs:
            groups.append({"group": "Vehicles", "items": [{"title": v.plate, "sub": f"{v.make} {v.model} · {v.year}"
                                                           + (f" · {v.owner_name}" if v.owner_name else ""),
                                                           "href": f"/vehicles/{quote(v.plate)}", "kind": "vehicle"} for v in vs]})
        lis = s.execute(select(LiveInspection).where(or_(LiveInspection.inspection_id.ilike(like), LiveInspection.plate.ilike(plate_like)))
                        .order_by(LiveInspection.started_at.desc()).limit(4)).scalars().all()
        if lis:
            groups.append({"group": "Inspections", "items": [{"title": f"{li.plate} · {li.inspection_id}", "sub": f"{li.inspection_type} · {li.status.replace('_', ' ')}",
                                                              "href": f"/inspection/{li.inspection_id}", "kind": "inspection"} for li in lis]})
        reps = s.execute(select(Report).where(or_(Report.report_id.ilike(like), Report.plate.ilike(plate_like)))
                         .order_by(Report.created_at.desc()).limit(4)).scalars().all()
        if reps:
            groups.append({"group": "Reports", "items": [{"title": f"{r.plate} · {r.verdict}", "sub": f"{r.kind} · {r.report_id}",
                                                          "href": f"/report?id={r.report_id}", "kind": "report"} for r in reps]})
    sched = [x for x in hubday.schedule("BR00", hubday.clock()["date"]) if q.upper() in x["no"] or norm_plate(q) in x["plate"]][:4]
    if sched:
        groups.append({"group": "Today at the Central Inspection Hub", "items": [
            {"title": f"{x['plate']} · {x['no']}", "sub": f"{x['inspection_type']} · arrives {hubday.hhmm(x['arrival'])}",
             "href": f"/vehicles/{quote(x['plate'])}", "kind": "schedule"} for x in sched]})
    return {"q": q, "groups": groups}


def notifications(role: str) -> list[dict]:
    out = []
    with session_scope() as s:
        for a, li in s.execute(select(Alert, LiveInspection).join(LiveInspection, LiveInspection.inspection_id == Alert.inspection_id)
                               .where(Alert.severity == "high", Alert.status == "open")
                               .order_by(Alert.created_at.desc()).limit(6)).all():
            out.append({"id": a.alert_id, "kind": "alert", "title": f"Critical finding · {li.plate}", "sub": a.title,
                        "at": a.created_at.isoformat() + "Z", "href": f"/inspection/{li.inspection_id}/findings"})
        for r in s.execute(select(Report).order_by(Report.created_at.desc()).limit(5)).scalars():
            if r.data.get("synthetic"):
                continue
            out.append({"id": r.report_id, "kind": "report", "title": f"Report issued · {r.plate} · {r.verdict}", "sub": r.kind,
                        "at": r.created_at.isoformat() + "Z", "href": f"/report?id={r.report_id}"})
        for b in s.execute(select(Booking).where(Booking.status.in_(("confirmed", "checked_in")))
                           .order_by(Booking.created_at.desc()).limit(4)).scalars():
            out.append({"id": b.booking_id, "kind": "booking",
                        "title": f"{'Checked in' if b.status == 'checked_in' else 'New booking'} · {b.plate}",
                        "sub": f"{booking_svc.TYPES.get(b.inspection_type, {}).get('label', b.inspection_type)} · {b.date} {b.slot}",
                        "at": b.created_at.isoformat() + "Z", "href": f"/vehicles/{quote(b.plate)}"})
    if role in ("hq", "presenter", "viewer"):
        from ..runtime import rt
        from . import exceptions
        try:
            for x in exceptions.overview(rt().models)["items"]:
                if x["state"]["status"] == "open":
                    out.append({"id": x["key"], "kind": "exception", "title": "HQ exception", "sub": x["title"], "at": None,
                                "href": x["href"]})
        except Exception:  # noqa: BLE001 - the feed must never fail because one source does
            pass
    out.sort(key=lambda n: n["at"] or "9999", reverse=True)
    return out[:15]


_ = dt  # (dates arrive as strings from pandas)

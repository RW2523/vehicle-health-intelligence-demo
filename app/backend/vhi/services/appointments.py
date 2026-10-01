"""Appointments: the hub staff's calendar of the bookings of the ten main vehicles (vhi.services.showcase).

Every booking of those vehicles is listed, wherever it was made: the owner's phone (paid online), the fleet portal
and the fleet API (billed to the fleet's account), an examiner's re-inspection, and the hub staff themselves (this
module: confirmed at once, paid on the spot or at the counter on the day). Staff book, reschedule, cancel with a
reason, take a (mock) payment and check a vehicle in - the same state the lane's plate camera sets when it reads a
booked plate. A checked-in visit is linked to the lane inspection it produced and that inspection's report.

Slot rules, on top of vhi.services.booking.slots (which also holds the other customers' synthetic occupancy): the
hubs are closed on Sundays, a date or a time that has passed cannot be booked, a slot needs room, and the
heavy-vehicle gear is set up only at the gear times on a heavy-capable hub's lane - a heavy vehicle must take one of
those, the other vehicles leave them free (the day before, the owner app sells them as Express next-day slots).

"Today" is the hub's day (Malaysia time), the same day the inspector dashboard shows.

The bookings table has no column for the staff note, the cancel reason or who did what when: they are kept per booking
in the key/value table (key "appt:<booking_id>"), so the database schema is unchanged.
"""
from __future__ import annotations

import datetime as dt
import hashlib
from collections import Counter
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, select

from .. import auth
from ..config import get_settings
from ..db import session_scope
from ..tables import Booking, Branch, Fleet, LiveInspection, Report, Setting, Vehicle
from . import booking as booking_svc
from .showcase import MAIN_PLATES, is_main

STAFF = "staff"
OPEN = ("pending_payment", "confirmed")
STATUSES = ("pending_payment", "confirmed", "checked_in", "cancelled")
METHODS = {"CASH": "Cash", "CARD": "Card", "FPX": "FPX online banking", "EWALLET": "E-wallet"}
SOURCES = {"owner": "Owner app", "fleet": "Fleet portal", "api": "Fleet API", "examiner": "Re-inspection (examiner)",
           STAFF: "Hub staff"}
META = "appt:"
SEED_PREFIX = "AP"
_UTC = dt.timezone.utc


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def now() -> dt.datetime:
    return dt.datetime.now(_tz())


def today() -> dt.date:
    """The hub's day (Malaysia time), as on the inspector dashboard."""
    return now().date()


def _iso(d: dt.datetime | None) -> str | None:
    """A database time (naive UTC) as an ISO time with its offset."""
    return d.replace(tzinfo=_UTC).isoformat(timespec="seconds") if d else None


def _date(s: str | None, what: str = "date") -> dt.date:
    try:
        return dt.date.fromisoformat(str(s))
    except ValueError:
        raise HTTPException(400, f"{what} must be YYYY-MM-DD") from None


def _plate(p: str) -> str:
    from ..api.deps import norm_plate
    return norm_plate(p or "")


def _minutes(t: str) -> int:
    return int(t[:2]) * 60 + int(t[3:5])


def _hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def end_time(slot: str, itype: str) -> str:
    return _hhmm(_minutes(slot) + booking_svc.TYPES.get(itype, {}).get("minutes", 30))


def suggested_type(v: dict) -> str:
    if v.get("heavy") or v.get("usage") in ("lorry", "bus", "van", "ehailing", "taxi"):
        return "PERIODIC"
    return "EV" if v.get("fuel") == "ev" else "VOLUNTARY"


# ---- access: an examiner works at their own hub
def _hub_scope(branch_id: str | None) -> str | None:
    return auth.examiner_branch() or branch_id or None


def _check_hub(branch_id: str) -> None:
    b = auth.examiner_branch()
    if b and branch_id != b:
        raise HTTPException(403, "This appointment is at another hub.")


def _actor() -> str:
    a = auth.user()
    return a.name if a else "Hub staff"


# ---- the per-booking record (note, cancel reason, who did what when)
def _meta(s, booking_id: str) -> dict:
    row = s.get(Setting, META + booking_id)
    return dict(row.value) if row and isinstance(row.value, dict) else {}


def _put_meta(s, booking_id: str, meta: dict) -> None:
    s.merge(Setting(key=META + booking_id, value=meta))


def _event(meta: dict, kind: str, detail: str = "", at: str | None = None, by: str | None = None) -> dict:
    meta = dict(meta)
    meta["events"] = [*meta.get("events", []), {"kind": kind, "at": at or now().isoformat(timespec="seconds"),
                                                 "by": by or _actor(), "detail": detail}]
    return meta


# ---- reading
def _vehicles(s) -> dict[str, dict]:
    fleets = {f.fleet_id: f.name for f in s.execute(select(Fleet)).scalars()}
    out = {}
    for v in s.execute(select(Vehicle).where(Vehicle.plate.in_(MAIN_PLATES))).scalars():
        fleet = fleets.get(v.fleet_id) if v.fleet_id else None
        out[v.plate] = {"plate": v.plate, "make": v.make, "model": v.model, "year": v.year, "vtype": v.vtype, "fuel": v.fuel,
                        "usage": v.usage, "heavy": bool(v.heavy), "fleet_id": v.fleet_id, "fleet_name": fleet,
                        "owner_name": v.owner_name or fleet or "Company vehicle"}
    return out


def _payment(b: Booking, meta: dict) -> dict:
    if b.payment_ref:
        method = b.payment_ref.split("-")[0]
        if meta.get("refunded_at"):
            return {"state": "refunded", "label": "Refunded", "method": METHODS.get(method, method), "ref": b.payment_ref,
                    "at": meta.get("refunded_at")}
        return {"state": "paid", "label": "Paid", "method": METHODS.get(method, method), "ref": b.payment_ref,
                "at": meta.get("paid_at")}
    if b.status == "cancelled":
        return {"state": "none", "label": "Not paid", "method": None, "ref": None, "at": None}
    if b.source in ("fleet", "api"):
        return {"state": "account", "label": "Fleet account", "method": None, "ref": None, "at": None}
    if b.status == "pending_payment":
        return {"state": "online_pending", "label": "Online payment pending", "method": None, "ref": None, "at": None}
    return {"state": "counter", "label": "Pay at counter", "method": None, "ref": None, "at": None}


def _awaiting(b: Booking, pay: dict) -> bool:
    return b.status != "cancelled" and pay["state"] in ("online_pending", "counter")


def _myt_day(d: dt.datetime) -> str:
    return d.replace(tzinfo=_UTC).astimezone(_tz()).date().isoformat()


def _visits(s, rows: list[Booking], metas: dict[str, dict]) -> dict[str, dict]:
    """The lane inspection (and its report) of each checked-in visit: the one whose plate read checked the booking
    in, else the plate's first inspection that day after the counter check-in."""
    checked = [b for b in rows if b.status == "checked_in"]
    if not checked:
        return {}
    cols = (LiveInspection.inspection_id, LiveInspection.session_id, LiveInspection.plate, LiveInspection.lane_id,
            LiveInspection.status, LiveInspection.verdict, LiveInspection.started_at, LiveInspection.finished_at,
            LiveInspection.inspection_type, LiveInspection.results)
    lis = s.execute(select(*cols).where(LiveInspection.plate.in_({b.plate for b in checked}))).all()
    by_booking: dict[str, object] = {}
    by_day: dict[tuple[str, str], list] = {}
    for li in sorted(lis, key=lambda x: x.started_at):
        bk = ((((li.results or {}).get("anpr") or {}).get("booking")) or {}).get("booking_id")
        if bk:
            by_booking[bk] = li  # the latest wins
        else:
            by_day.setdefault((li.plate, _myt_day(li.started_at)), []).append(li)
    picked = {}
    for b in checked:
        li = by_booking.get(b.booking_id)
        if li is None:
            cands = by_day.get((b.plate, b.date), [])
            at = metas.get(b.booking_id, {}).get("checked_in_at")
            if at:
                t0 = dt.datetime.fromisoformat(at).astimezone(_UTC).replace(tzinfo=None) - dt.timedelta(minutes=10)
                cands = [c for c in cands if c.started_at >= t0]
            li = cands[0] if cands else None
        if li is not None:
            picked[b.booking_id] = li
    if not picked:
        return {}
    reports: dict[str, Report] = {}
    for r in s.execute(select(Report).where(Report.inspection_id.in_({li.inspection_id for li in picked.values()}))
                       .order_by(Report.created_at)).scalars():
        reports[r.inspection_id] = r
    out = {}
    for bid, li in picked.items():
        r = reports.get(li.inspection_id)
        out[bid] = {
            "inspection": {"inspection_id": li.inspection_id, "session_id": li.session_id, "lane_id": li.lane_id,
                           "status": li.status, "verdict": li.verdict, "inspection_type": li.inspection_type,
                           "started_at": _iso(li.started_at), "finished_at": _iso(li.finished_at)},
            "report": {"report_id": r.report_id, "verdict": r.verdict, "kind": r.kind, "verify_token": r.verify_token,
                       "created_at": _iso(r.created_at)} if r else None,
        }
    return out


def _stage(b: Booking, visit: dict | None, t: dt.date) -> str:
    if b.status == "cancelled":
        return "cancelled"
    if visit and visit["report"]:
        return "reported"
    if visit:
        return "in_lane" if visit["inspection"]["status"] == "in_lane" else "inspected"
    if b.status == "checked_in":
        return "checked_in"
    if b.date < t.isoformat():
        return "no_show"
    return b.status


def _timeline(b: Booking, meta: dict, pay: dict, visit: dict | None) -> list[dict]:
    ev = {}
    for e in meta.get("events", []):
        ev[e["kind"]] = e  # the latest of each kind
    booked = ev.get("booked") or {}
    li = (visit or {}).get("inspection")
    rep = (visit or {}).get("report")
    paid_done = pay["state"] in ("paid", "refunded", "account")
    paid_detail = (f"{pay['method']} · {pay['ref']}{' · refunded' if pay['state'] == 'refunded' else ''}" if pay["state"] in ("paid", "refunded") else
                   "Billed to the fleet's account" if pay["state"] == "account" else pay["label"])
    checked = b.status == "checked_in" or li is not None
    ci = ev.get("checked_in") or {}
    steps = [
        {"key": "booked", "label": "Booked", "done": True, "at": booked.get("at") or _iso(b.created_at),
         "detail": f"{SOURCES.get(b.source, b.source)}{' · ' + booked['by'] if booked.get('by') else ''}"},
        {"key": "paid", "label": "Paid", "done": paid_done, "at": pay.get("at"), "detail": paid_detail},
        {"key": "checked_in", "label": "Checked in", "done": checked,
         "at": ci.get("at") or (li["started_at"] if li else None),
         "detail": (f"At the counter · {ci['by']}" if ci else "Lane plate camera read the plate" if checked else "On the day, at the counter or the lane")},
        {"key": "inspected", "label": "Inspected", "done": bool(li and li["status"] != "in_lane"),
         "at": (li["finished_at"] or li["started_at"]) if li else None,
         "detail": (f"{li['lane_id'].replace('-L', ' · Lane ')}{' · ' + li['verdict'] if li['verdict'] else ''}" if li else "")
                   + (" · on the lane now" if li and li["status"] == "in_lane" else "")},
        {"key": "report", "label": "Report", "done": rep is not None, "at": rep["created_at"] if rep else None,
         "detail": f"{rep['verdict']} · {rep['kind']}" if rep else ""},
    ]
    if b.status == "cancelled":
        c = ev.get("cancelled") or {}
        steps = steps[:2] + [{"key": "cancelled", "label": "Cancelled", "done": True, "at": c.get("at") or meta.get("cancelled_at"),
                              "detail": meta.get("cancel_reason") or "Cancelled"}]
    return steps


def _item(b: Booking, veh: dict, meta: dict, visit: dict | None, t: dt.date, names: dict[str, str]) -> dict:
    pay = _payment(b, meta)
    stage = _stage(b, visit, t)
    is_open = b.status in OPEN
    # the fields of booking.booking_dict (built here: it would look the hub up again for every row), and more
    return {"booking_id": b.booking_id, "plate": b.plate, "branch_id": b.branch_id, "branch_name": names.get(b.branch_id, b.branch_id),
         "date": b.date, "slot": b.slot, "end": end_time(b.slot, b.inspection_type), "minutes": booking_svc.TYPES.get(b.inspection_type, {}).get("minutes", 30),
         "inspection_type": b.inspection_type,
         "type_label": booking_svc.TYPES.get(b.inspection_type, {}).get("label", b.inspection_type),
         "gear": b.gear, "gear_slot": b.slot in booking_svc.GEAR_TIMES, "price_rm": b.price_rm, "status": b.status, "stage": stage,
         "payment_ref": b.payment_ref, "payment": pay, "awaiting_payment": _awaiting(b, pay),
         "checkin_token": b.checkin_token, "checkin_url": f"{_base_url()}/checkin/{b.checkin_token}",
         "qr_url": f"/api/appointments/{b.booking_id}/qr.svg",
         "source": b.source, "source_label": SOURCES.get(b.source, b.source), "fleet_id": b.fleet_id,
         "created_at": _iso(b.created_at), "note": meta.get("note") or None, "cancel_reason": meta.get("cancel_reason"),
         "vehicle": veh.get(b.plate) or {"plate": b.plate},
         "inspection_id": visit["inspection"]["inspection_id"] if visit else None,
         "inspection": visit["inspection"] if visit else None, "report": visit["report"] if visit else None,
         "timeline": _timeline(b, meta, pay, visit), "events": meta.get("events", []),
         "can": {"checkin": is_open and b.date == t.isoformat(), "reschedule": is_open, "cancel": is_open,
                 "pay": b.status != "cancelled" and pay["state"] in ("online_pending", "counter")}}


def _base_url() -> str:
    from ..config import public_base_url
    return public_base_url()


def _items(s, rows: list[Booking]) -> list[dict]:
    if not rows:
        return []
    t = today()
    veh = _vehicles(s)
    names = {b.branch_id: b.name for b in s.execute(select(Branch)).scalars()}
    metas = {r.key[len(META):]: dict(r.value or {}) for r in s.execute(
        select(Setting).where(Setting.key.in_([META + b.booking_id for b in rows]))).scalars()}
    visits = _visits(s, rows, metas)
    return [_item(b, veh, metas.get(b.booking_id, {}), visits.get(b.booking_id), t, names) for b in rows]


def _matches(i: dict, status: str) -> bool:
    if status == "awaiting_payment":
        return i["awaiting_payment"]
    if status == "open":
        return i["status"] in OPEN
    if status in ("no_show", "reported", "inspected"):
        return i["stage"] == status
    return i["status"] == status


def listing(frm: str | None = None, to: str | None = None, status: str = "", plate: str = "", branch_id: str = "") -> dict:
    t = today()
    start = _date(frm, "from") if frm else t - dt.timedelta(days=t.weekday())
    end = _date(to, "to") if to else t + dt.timedelta(days=14)
    if end < start:
        raise HTTPException(400, "'to' is before 'from'")
    if (end - start).days > 400:
        raise HTTPException(400, "Ask for at most 400 days at a time.")
    hub = _hub_scope(branch_id)
    p = _plate(plate) if plate else ""
    with session_scope() as s:
        q = select(Booking).where(Booking.plate.in_(MAIN_PLATES), Booking.date >= start.isoformat(), Booking.date <= end.isoformat())
        if hub:
            q = q.where(Booking.branch_id == hub)
        if p:
            q = q.where(Booking.plate == p)
        items = _items(s, list(s.execute(q.order_by(Booking.date, Booking.slot, Booking.created_at)).scalars()))
    counts = {k: sum(1 for i in items if i["status"] == k) for k in STATUSES}
    counts["awaiting_payment"] = sum(1 for i in items if i["awaiting_payment"])
    counts["no_show"] = sum(1 for i in items if i["stage"] == "no_show")
    counts["total"] = len(items)
    if status:
        items = [i for i in items if _matches(i, status)]
    days = Counter(i["date"] for i in items if status == "cancelled" or i["status"] != "cancelled")
    return {"today": t.isoformat(), "now": now().strftime("%H:%M"), "from": start.isoformat(), "to": end.isoformat(),
            "branch_id": hub, "items": items, "counts": counts, "days": dict(sorted(days.items())), "stats": stats(hub)}


def stats(hub: str | None = None) -> dict:
    """The page's headline numbers (whatever the calendar shows): today, this week, awaiting payment, checked in
    today and cancelled (this week and later)."""
    t = today()
    w0, w1 = t - dt.timedelta(days=t.weekday()), t - dt.timedelta(days=t.weekday()) + dt.timedelta(days=6)
    with session_scope() as s:
        q = select(Booking).where(Booking.plate.in_(MAIN_PLATES), Booking.date >= min(w0, t).isoformat())
        if hub:
            q = q.where(Booking.branch_id == hub)
        rows = s.execute(q).scalars().all()
        metas = {r.key[len(META):]: dict(r.value or {}) for r in s.execute(
            select(Setting).where(Setting.key.in_([META + b.booking_id for b in rows]))).scalars()} if rows else {}
    ts, ws, we = t.isoformat(), w0.isoformat(), w1.isoformat()
    live = [b for b in rows if b.status != "cancelled"]
    return {
        "today": sum(1 for b in live if b.date == ts),
        "week": sum(1 for b in live if ws <= b.date <= we),
        "awaiting_payment": sum(1 for b in live if b.date >= ts and _awaiting(b, _payment(b, metas.get(b.booking_id, {})))),
        "awaiting_payment_rm": round(sum(b.price_rm for b in live if b.date >= ts and _awaiting(b, _payment(b, metas.get(b.booking_id, {})))), 2),
        "checked_in_today": sum(1 for b in live if b.date == ts and b.status == "checked_in"),
        "cancelled": sum(1 for b in rows if b.status == "cancelled" and b.date >= ws),
        "week_from": ws, "week_to": we,
    }


def get(booking_id: str) -> dict:
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        if b is None or not is_main(b.plate):
            raise HTTPException(404, "appointment not found")
        _check_hub(b.branch_id)
        return _items(s, [b])[0]


def options() -> dict:
    """What the New appointment form offers: the ten vehicles, the inspection types, the hubs and the gear times."""
    hub = auth.examiner_branch()
    with session_scope() as s:
        veh = _vehicles(s)
        branches = [{"branch_id": b.branch_id, "name": b.name, "state": b.state, "heavy_capable": b.heavy_capable, "lanes": b.lanes}
                    for b in s.execute(select(Branch).order_by(Branch.branch_id)).scalars() if not hub or b.branch_id == hub]
    vehicles = [{**veh[p], "suggested_type": suggested_type(veh[p])} for p in MAIN_PLATES if p in veh]
    return {"today": today().isoformat(), "now": now().strftime("%H:%M"), "vehicles": vehicles,
            "types": [{"code": k, **v} for k, v in booking_svc.TYPES.items()], "branches": branches,
            "default_branch": hub or "BR00", "slot_times": booking_svc.SLOT_TIMES, "gear_times": sorted(booking_svc.GEAR_TIMES),
            "methods": [{"code": k, "label": v} for k, v in METHODS.items()], "sources": SOURCES}


# ---- slots
def _reason_text(reason: str, br_name: str = "", past_day: bool = False) -> str:
    return {"closed": "The hubs are closed on Sundays.", "past": "That day has passed." if past_day else "That time has passed today.",
            "full": "That slot is full.",
            "gear_only": "A heavy vehicle needs a gear slot (the heavy-vehicle gear is set up only at those times).",
            "gear_reserved": "Gear slots are held for heavy vehicles and Express bookings.",
            "no_heavy_lane": f"{br_name or 'This hub'} has no heavy-vehicle lane: pick a heavy-capable hub."}[reason]


def slot_view(branch_id: str, day: str, plate: str | None = None, exclude: str | None = None) -> dict:
    """Every slot of a hub's day for the staff: room left, the gear slots, and whether the chosen vehicle can take it."""
    d = _date(day)
    with session_scope() as s:
        br = s.get(Branch, branch_id)
        if br is None:
            raise HTTPException(404, "hub not found")
        bname, heavy_ok, lanes = br.name, br.heavy_capable, br.lanes
        v = None
        if plate:
            p = _plate(plate)
            if not is_main(p):
                raise HTTPException(400, f"{p} is not one of the ten vehicles booked here.")
            row = s.execute(select(Vehicle).where(Vehicle.plate == p)).scalar_one_or_none()
            v = {"plate": p, "heavy": bool(row.heavy) if row else False}
        ours: dict[str, list] = {}
        for b in s.execute(select(Booking).where(Booking.branch_id == branch_id, Booking.date == d.isoformat(),
                                                 Booking.status != "cancelled")).scalars():
            if is_main(b.plate):
                ours.setdefault(b.slot, []).append({"booking_id": b.booking_id, "plate": b.plate, "status": b.status})
    t, n = today(), now()
    base = booking_svc.slots(branch_id, d.isoformat())
    heavy = bool(v and v["heavy"])
    out = []
    for x in base:
        gear = x["time"] in booking_svc.GEAR_TIMES
        cap = 1 if gear else lanes
        reason = None
        if d.weekday() == 6:
            reason = "closed"
        elif d < t or (d == t and _minutes(x["time"]) <= n.hour * 60 + n.minute):
            reason = "past"
        elif heavy and not heavy_ok:
            reason = "no_heavy_lane"
        elif heavy and not gear:
            reason = "gear_only"
        elif v and not heavy and gear:
            reason = "gear_reserved"
        elif x["free"] <= 0:
            reason = "full"
        out.append({"time": x["time"], "free": x["free"], "capacity": cap, "taken": max(0, cap - x["free"]), "gear": gear,
                    "express": bool(x["gear"]), "available": reason is None, "reason": reason,
                    "reason_text": _reason_text(reason, bname, d < t) if reason else None, "booked": ours.get(x["time"], [])})
    same_day = None
    if v:
        with session_scope() as s:
            c = s.execute(select(Booking).where(Booking.plate == v["plate"], Booking.date == d.isoformat(),
                                                Booking.status.in_((*OPEN, "checked_in")), Booking.booking_id != (exclude or ""))).scalars().first()
            if c:
                same_day = {"booking_id": c.booking_id, "slot": c.slot, "branch_id": c.branch_id, "branch_name": booking_svc.branch_name(c.branch_id)}
    return {"branch": {"branch_id": branch_id, "name": bname, "heavy_capable": heavy_ok, "lanes": lanes},
            "date": d.isoformat(), "weekday": d.strftime("%A"), "closed": d.weekday() == 6, "past": d < t,
            "vehicle": v, "vehicle_same_day": same_day, "gear_times": sorted(booking_svc.GEAR_TIMES), "slots": out,
            "available": sum(1 for x in out if x["available"])}


def _validate(plate: str, heavy: bool, branch_id: str, d: dt.date, slot: str, skip: str | None = None) -> None:
    if slot not in booking_svc.SLOT_TIMES:
        raise HTTPException(400, "Pick one of the hub's slots (every 20 minutes from 08:00 to 16:40).")
    view = slot_view(branch_id, d.isoformat(), plate)
    x = next(x for x in view["slots"] if x["time"] == slot)
    if not x["available"]:
        raise HTTPException(409 if x["reason"] == "full" else 400, x["reason_text"])
    with session_scope() as s:
        clash = s.execute(select(Booking).where(Booking.plate == plate, Booking.date == d.isoformat(),
                                                Booking.status.in_((*OPEN, "checked_in")), Booking.booking_id != (skip or ""))).scalars().first()
        if clash:
            raise HTTPException(409, f"{plate} already has an appointment that day ({clash.slot} at {booking_svc.branch_name(clash.branch_id)}).")


def _ref(method: str, booking_id: str) -> str:
    return f"{method}-{hashlib.sha1(f'{booking_id}{method}{now().isoformat()}'.encode()).hexdigest()[:10].upper()}"


def _method(method: str | None) -> str:
    m = (method or "").strip().upper()
    if m not in METHODS:
        raise HTTPException(400, f"Payment method must be one of {', '.join(METHODS)}.")
    return m


# ---- changes
def create(plate: str, branch_id: str, day: str, slot: str, itype: str, note: str | None = None, paid: bool = False,
           method: str | None = None) -> dict:
    p = _plate(plate)
    if not p:
        raise HTTPException(400, "Pick a vehicle.")
    if not is_main(p):
        raise HTTPException(400, f"{p} is not one of the ten vehicles booked here.")
    if itype not in booking_svc.TYPES:
        raise HTTPException(400, f"Unknown inspection type {itype}.")
    note = (note or "").strip()
    if len(note) > 500:
        raise HTTPException(400, "Keep the note under 500 characters.")
    m = _method(method or "CARD") if paid else None
    _check_hub(branch_id)
    d = _date(day)
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == p)).scalar_one_or_none()
        if v is None:
            raise HTTPException(404, f"vehicle {p} not found")
        heavy = bool(v.heavy)
    _validate(p, heavy, branch_id, d, slot)
    with session_scope() as s:
        b = Booking(plate=p, branch_id=branch_id, date=d.isoformat(), slot=slot, inspection_type=itype, gear=False,
                    price_rm=booking_svc.TYPES[itype]["price"], source=STAFF, status="confirmed")
        s.add(b)
        s.flush()
        meta = _event({"note": note or None}, "booked", f"{d.isoformat()} {slot}")
        if m:
            b.payment_ref = _ref(m, b.booking_id)
            meta = _event({**meta, "paid_at": now().isoformat(timespec="seconds"), "method": m}, "paid",
                          f"RM {b.price_rm:.2f} · {METHODS[m]} · {b.payment_ref}")
        _put_meta(s, b.booking_id, meta)
        s.flush()
        bid = b.booking_id
    return get(bid)


def _load(s, booking_id: str) -> Booking:
    b = s.get(Booking, booking_id)
    if b is None or not is_main(b.plate):
        raise HTTPException(404, "appointment not found")
    _check_hub(b.branch_id)
    return b


def reschedule(booking_id: str, day: str, slot: str) -> dict:
    d = _date(day)
    with session_scope() as s:
        b = _load(s, booking_id)
        if b.status not in OPEN:
            raise HTTPException(409, "Only an appointment that is not checked in or cancelled can be moved.")
        if (b.date, b.slot) == (d.isoformat(), slot):
            raise HTTPException(400, "That is already the appointment's time: pick another date or slot.")
        plate, branch = b.plate, b.branch_id
        v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
        heavy = bool(v and v.heavy)
    _validate(plate, heavy, branch, d, slot, skip=booking_id)
    with session_scope() as s:
        b = _load(s, booking_id)
        old = f"{b.date} {b.slot}"
        b.date, b.slot = d.isoformat(), slot
        _put_meta(s, b.booking_id, _event(_meta(s, b.booking_id), "rescheduled", f"{old} → {b.date} {b.slot}"))
    return get(booking_id)


def cancel(booking_id: str, reason: str) -> dict:
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(400, "Give the reason for the cancellation.")
    if len(reason) > 300:
        raise HTTPException(400, "Keep the reason under 300 characters.")
    with session_scope() as s:
        b = _load(s, booking_id)
        if b.status == "checked_in":
            raise HTTPException(409, "The vehicle has already checked in.")
        if b.status == "cancelled":
            raise HTTPException(409, "This appointment is already cancelled.")
        b.status = "cancelled"
        at = now().isoformat(timespec="seconds")
        meta = {**_meta(s, b.booking_id), "cancel_reason": reason, "cancelled_at": at, "cancelled_by": _actor()}
        if b.payment_ref:
            meta["refunded_at"] = at
            reason = f"{reason} · RM {b.price_rm:.2f} refunded (mock)"
        _put_meta(s, b.booking_id, _event(meta, "cancelled", reason, at=at))
    return get(booking_id)


def checkin(booking_id: str) -> dict:
    """The counter checks the vehicle in: the same state the lane's plate camera sets when it reads a booked plate."""
    with session_scope() as s:
        b = _load(s, booking_id)
        if b.status == "checked_in":
            raise HTTPException(409, "Already checked in.")
        if b.status == "cancelled":
            raise HTTPException(409, "This appointment is cancelled.")
        t = today().isoformat()
        if b.date != t:
            raise HTTPException(409, f"Check-in opens on the day of the appointment ({b.date}); move it to today first.")
        b.status = "checked_in"
        at = now().isoformat(timespec="seconds")
        _put_meta(s, b.booking_id, _event({**_meta(s, b.booking_id), "checked_in_at": at}, "checked_in", "At the counter", at=at))
    return get(booking_id)


def pay(booking_id: str, method: str | None) -> dict:
    """Mock payment at the counter (or on the phone link): always approved."""
    m = _method(method)
    with session_scope() as s:
        b = _load(s, booking_id)
        if b.status == "cancelled":
            raise HTTPException(409, "This appointment is cancelled.")
        if b.payment_ref:
            raise HTTPException(409, f"Already paid ({b.payment_ref}).")
        if b.source in ("fleet", "api"):
            raise HTTPException(409, "This visit is billed to the fleet's account.")
        b.payment_ref = _ref(m, b.booking_id)
        if b.status == "pending_payment":
            b.status = "confirmed"
        at = now().isoformat(timespec="seconds")
        meta = {**_meta(s, b.booking_id), "paid_at": at, "method": m}
        _put_meta(s, b.booking_id, _event(meta, "paid", f"RM {b.price_rm:.2f} · {METHODS[m]} · {b.payment_ref} (mock gateway)", at=at))
    return get(booking_id)


# ---- seed
# (days from today, plate, hub, slot, type, status, paid with, source, note or cancel reason)
SEED = [  # today's three follow the demo hub's day plan (vhi.services.hubday.PLAN): same vehicles, types and order -
    # the first two are through the lane when the dashboard is first looked at, the third is still to come
    (0, "BHY 7783", "BR00", "08:40", "PERIODIC", "checked_in", "FPX", STAFF, "Driver reports smoke from the exhaust on cold starts"),
    (0, "WXD 2291", "BR00", "09:20", "PERIODIC", "checked_in", None, STAFF, "Fleet asked for a tyre check: sidewall bulge on the front right"),
    (0, "VJM 7412", "BR00", "11:00", "TRANSFER", "confirmed", "CARD", STAFF, "Rental car sold on: transfer inspection before the handover"),
    (1, "VKR 3128", "BR00", "09:20", "PERIODIC", "confirmed", "CARD", STAFF, "E-hailing permit renewal; brake discs were scored at the last check"),
    (2, "DMO 9003", "BR00", "10:00", "TRANSFER", "cancelled", None, "owner", "Owner cancelled: the sale fell through"),
    (2, "PKE 4410", "BR05", "11:00", "VOLUNTARY", "confirmed", None, STAFF, "Windscreen replaced: check the ADAS camera mount"),
    (3, "DMO 9002", "BR00", "15:00", "EV", "pending_payment", None, "owner", None),
    (4, "JTR 5510", "BR00", "08:40", "PERIODIC", "confirmed", "CASH", STAFF, "Tail lamp replaced; re-check the oil-wet rear shock absorber"),
    (7, "BHY 7783", "BR00", "10:20", "VOLUNTARY", "cancelled", "CARD", STAFF, "Van off the road for bodywork: the fleet will rebook"),
    (9, "PKE 4410", "BR00", "09:40", "PERIODIC", "confirmed", "FPX", STAFF, None),
    (11, "DMO 9003", "BR00", "14:20", "TRANSFER+FINANCING", "pending_payment", None, "owner", None),
    (12, "WXD 2291", "BR00", "15:20", "PERIODIC", "confirmed", None, STAFF, "Tread follow-up after the tyre change"),
]


def seed_appointments() -> int:
    """About a dozen appointments over the coming two weeks for eight of the ten vehicles (not DMO 9001 and DMO 9006:
    their use cases make and check in their own bookings). Deterministic for a day and idempotent: it runs again only
    when no seeded appointment is left from today on (a new demo fortnight, or after a runtime reset). The lane
    vehicles DMO 9002/9003 get no confirmed booking, because the lane checks in and inspects a plate's confirmed
    booking."""
    t = today()
    tz = _tz()
    with session_scope() as s:
        # notes of bookings that no longer exist (a runtime reset deletes the bookings)
        keys = s.execute(select(Setting.key).where(Setting.key.like(META + "%"))).scalars().all()
        if keys:
            have = set(s.execute(select(Booking.booking_id).where(Booking.booking_id.in_([k[len(META):] for k in keys]))).scalars())
            gone = [k for k in keys if k[len(META):] not in have]
            if gone:
                s.execute(delete(Setting).where(Setting.key.in_(gone)))
        if s.execute(select(Booking.booking_id).where(Booking.booking_id.like(SEED_PREFIX + "%"),
                                                      Booking.date >= t.isoformat())).first():
            return 0
        if not s.execute(select(Branch.branch_id).where(Branch.branch_id == "BR00")).first():
            return 0
        owners = {v.plate: v.owner_name for v in s.execute(select(Vehicle).where(Vehicle.plate.in_(MAIN_PLATES))).scalars()}
        plates = set(owners)
    made = 0
    for i, (off, plate, hub, slot, itype, status, paid, source, text_) in enumerate(SEED):
        if plate not in plates:
            continue
        d = t + dt.timedelta(days=off)
        while d.weekday() == 6:
            d += dt.timedelta(days=1)
        if status == "checked_in" and d != t:
            status = "confirmed"  # today is a Sunday: the visit is tomorrow, not checked in yet
        bid = f"{SEED_PREFIX}{t:%y%m%d}{i + 1:02d}"
        booked = dt.datetime.combine(t - dt.timedelta(days=3 + i % 4), dt.time(9 + i % 7, 10 * (i % 6)), tz)
        with session_scope() as s:
            if s.get(Booking, bid):
                continue
            b = Booking(booking_id=bid, plate=plate, branch_id=hub, date=d.isoformat(), slot=slot, inspection_type=itype, gear=False,
                        price_rm=booking_svc.TYPES[itype]["price"], source=source, status=status,
                        created_at=booked.astimezone(_UTC).replace(tzinfo=None))
            by = (owners.get(plate) or "the owner") if source == "owner" else "Counter desk"
            meta: dict = {"note": text_ if status != "cancelled" else None, "seeded": True}
            meta = _event(meta, "booked", f"{d.isoformat()} {slot}", at=booked.isoformat(timespec="seconds"), by=by)
            if paid:
                b.payment_ref = f"{paid}-{hashlib.sha1(bid.encode()).hexdigest()[:10].upper()}"
                at = (booked + dt.timedelta(minutes=4)).isoformat(timespec="seconds")
                meta = _event({**meta, "paid_at": at, "method": paid}, "paid",
                              f"RM {b.price_rm:.2f} · {METHODS[paid]} · {b.payment_ref}", at=at, by=by)
            if status == "checked_in":
                at = dt.datetime.combine(d, dt.time(*divmod(_minutes(slot) - 6, 60)), tz).isoformat(timespec="seconds")
                meta = _event({**meta, "checked_in_at": at}, "checked_in", "At the counter", at=at, by="Counter desk")
            if status == "cancelled":
                at = (booked + dt.timedelta(days=1, hours=2)).isoformat(timespec="seconds")
                meta = {**meta, "cancel_reason": text_, "cancelled_at": at, "cancelled_by": by}
                if paid:
                    meta["refunded_at"] = at
                meta = _event(meta, "cancelled", text_ + (f" · RM {b.price_rm:.2f} refunded (mock)" if paid else ""), at=at, by=by)
            s.add(b)
            _put_meta(s, bid, meta)
        made += 1
    return made

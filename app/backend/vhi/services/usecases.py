"""Guided demo: nine end-to-end use cases. Each is a journey through the apps whose progress is read from the live
system (the lane inspection, the examiner's decisions, the report, a booking, an invitation, an HQ action), plus the
screens the presenter has shown, so the demo control and every page can say where the journey is and what comes next.

Starting a use case records its start time (progress counts only what happens after it) and resets the scenario state
it owns (open bookings of its vehicle, its flood invitation, the HQ exception states) - never the seeded data.
"""
from __future__ import annotations

import datetime as dt
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import select

from ..db import session_scope
from ..tables import Alert, Booking, FloodInvitation, Listing, LiveInspection, Report, SelfCheck, Setting, Vehicle

ACTIVE = "usecase:active"
# the flood of the synthetic insurance claims that includes DMO 9002's (UC-08 opens flood watch on it)
FLOOD_EVENT = "event%3A2025-12-10"


def _q(plate: str) -> str:
    return quote(plate)


def _lane(session: str, lane: str, plate: str, report_step: str = "Issue the report") -> list[dict]:
    """The inspection stages every lane journey shares."""
    return [
        {"id": "checkin", "stage": "Check-in", "label": f"{plate} checks in at the lane", "kind": "checkin",
         "href": f"/inspection/{session}", "cta": "Watch the inspection"},
        {"id": "inspect", "stage": "Inspect", "label": "Sensors, cameras and AI modules run", "kind": "lane_done",
         "href": f"/inspection/{session}", "cta": "Watch the inspection"},
        {"id": "review", "stage": "Review findings", "label": "Examiner reviews every critical finding", "kind": "reviewed",
         "href": f"/inspection/{session}/findings", "cta": "Review AI findings"},
        {"id": "decide", "stage": "Decide", "label": "Every finding decided", "kind": "decided",
         "href": f"/inspection/{session}/findings", "cta": "Decide the findings"},
        {"id": "report", "stage": "Report", "label": report_step, "kind": "report",
         "href": f"/inspection/{session}/review", "cta": "Issue the report"},
    ]


def _visit(id_: str, stage: str, label: str, href: str, cta: str, match: str | None = None) -> dict:
    return {"id": id_, "stage": stage, "label": label, "kind": "visit", "href": href, "cta": cta, "match": match or href}


USECASES: list[dict] = [
    {
        "id": "UC-01", "title": "Commercial vehicle: emissions and brake failure", "session": "S1", "lane": "BR00-L3",
        "plate": "DMO 9001", "vehicle": "Scania P-Series prime mover", "vtype": "Commercial · diesel",
        "scenario": "A prime mover comes in for its periodic inspection. The particle counter, brake roller, thermal "
                    "camera and Tyre AI find what the smoke test misses.",
        "outcome": "The examiner confirms the failures: FAIL report, and the fleet's vehicle record shows it.",
        "minutes": 6, "provenance": ["simulated", "live_model", "live_logic"], "autostart": True,
        "steps": _lane("S1", "BR00-L3", "DMO 9001") + [
            _visit("downstream", "Downstream update", "Fleet vehicle record shows the result",
                   f"/vehicles/{_q('DMO 9001')}?tab=health", "Open the vehicle record", f"/vehicles/{_q('DMO 9001')}")],
    },
    {
        "id": "UC-02", "title": "EV flood-risk inspection", "session": "S2", "lane": "BR00-L2",
        "plate": "DMO 9002", "vehicle": "BYD Atto 3", "vtype": "Passenger · electric",
        "scenario": "An EV comes in for an ownership transfer. Cabin corrosion, a weak high-voltage isolation reading, "
                    "battery health and an earlier flood claim point to flood damage.",
        "outcome": "The examiner reviews the evidence: CONDITIONAL EV Health Certificate, recorded in the vehicle history.",
        "minutes": 6, "provenance": ["simulated", "live_model", "synthetic"], "autostart": True,
        "steps": _lane("S2", "BR00-L2", "DMO 9002") + [
            _visit("downstream", "Downstream update", "Vehicle history lists the certificate",
                   f"/mobile/vehicle?plate={_q('DMO 9002')}", "Open the owner's passport", "/mobile")],
    },
    {
        "id": "UC-03", "title": "Odometer rollback and senior review", "session": "S3", "lane": "BR00-L1",
        "plate": "DMO 9003", "vehicle": "Honda Civic", "vtype": "Passenger · petrol",
        "scenario": "A Civic comes in for an ownership transfer. Its odometer reads 86,500 km less than two years ago, "
                    "the engine sound does not match earlier visits and a rear panel was repaired.",
        "outcome": "Identity checks disagree, so the case goes to a senior examiner, whose decision and reasons are in "
                   "the report and the history.",
        "minutes": 7, "provenance": ["simulated", "live_model", "synthetic"], "autostart": True,
        "steps": _lane("S3", "BR00-L1", "DMO 9003", "Senior examiner signs off the report")[:4] + [
            {"id": "refer", "stage": "Senior review", "label": "Referred to the senior examiner", "kind": "referred",
             "href": "/inspection/S3/review", "cta": "Refer to the senior examiner"},
            {"id": "report", "stage": "Report", "label": "Senior examiner signs off the report", "kind": "report",
             "href": "/inspection/S3/review", "cta": "Sign off as senior examiner"},
            _visit("downstream", "Downstream update", "Vehicle history shows the decision",
                   f"/mobile/vehicle?plate={_q('DMO 9003')}", "Open the owner's passport", "/mobile")],
    },
    {
        "id": "UC-04", "title": "Clean inspection, no anomalies", "session": "S7", "lane": "BR00-L4",
        "plate": "DMO 9006", "vehicle": "Perodua Myvi", "vtype": "Passenger · petrol",
        "scenario": "A well-kept hatchback goes through every lane step. Every reading is within its limit and the AI "
                    "modules find nothing.",
        "outcome": "Nothing to decide: the examiner issues a PASS and the health passport updates.",
        "minutes": 4, "provenance": ["simulated", "live_model", "live_logic"], "autostart": True,
        "steps": _lane("S7", "BR00-L4", "DMO 9006") + [
            _visit("downstream", "Downstream update", "Health passport shows the PASS",
                   f"/mobile/vehicle?plate={_q('DMO 9006')}", "Open the health passport", "/mobile")],
    },
    {
        "id": "UC-05", "title": "Owner self-check, booking and inspection", "session": "S7", "lane": "BR00-L4",
        "plate": "DMO 9006", "vehicle": "Perodua Myvi", "vtype": "Passenger · petrol",
        "scenario": "The owner runs the phone self-check, fixes what it finds, books a slot and pays (mock), then checks "
                    "in at the lane with the booking code.",
        "outcome": "The inspection passes and the certificate appears in the owner's passport and timeline.",
        "minutes": 8, "provenance": ["live_model", "simulated", "mock"], "autostart": False,
        "steps": [
            {"id": "selfcheck", "stage": "Self-check", "label": "Self-check says the car is ready", "kind": "selfcheck",
             "href": f"/mobile/check?plate={_q('DMO 9006')}", "cta": "Run the self-check"},
            {"id": "book", "stage": "Book", "label": "Slot booked and paid (mock)", "kind": "booked",
             "href": f"/mobile/book?plate={_q('DMO 9006')}", "cta": "Book an inspection"},
            {"id": "checkin", "stage": "Check-in", "label": "Booking code checked in at the lane", "kind": "booking_checked_in",
             "href": "/inspection/S7", "cta": "Start the inspection"},
        ] + _lane("S7", "BR00-L4", "DMO 9006")[1:] + [
            _visit("downstream", "Downstream update", "Passport and timeline show the certificate",
                   f"/mobile/vehicle?plate={_q('DMO 9006')}", "Open the passport", "/mobile")],
    },
    {
        "id": "UC-06", "title": "Fleet predictive maintenance", "session": "S1", "lane": "BR00-L3",
        "plate": "DMO 9001", "vehicle": "Scania P-Series prime mover", "vtype": "Commercial · diesel",
        "scenario": "The fleet manager opens the vehicles needing attention, drills into a truck whose brakes are "
                    "wearing towards the limit, and books it in before it fails on the road.",
        "outcome": "The truck is inspected, and the fleet view and its vehicle record show the new result.",
        "minutes": 8, "provenance": ["synthetic", "live_logic", "live_model", "simulated"], "autostart": False,
        "steps": [
            _visit("fleet", "Attention list", "Vehicles needing attention", "/vehicles?fleet=FLEET07", "Open the vehicle records", "/vehicles"),
            _visit("history", "Vehicle history", "Tyre trend and forecast of DMO 9001",
                   f"/vehicles/{_q('DMO 9001')}?tab=health", "Open the health trends", f"/vehicles/{_q('DMO 9001')}"),
            {"id": "book", "stage": "Action", "label": "Inspection booked", "kind": "fleet_booked",
             "href": f"/vehicles/{_q('DMO 9001')}?tab=health", "cta": "Book the inspection"},
        ] + _lane("S1", "BR00-L3", "DMO 9001") + [
            _visit("downstream", "Downstream update", "The vehicle record shows the new result",
                   f"/vehicles/{_q('DMO 9001')}?tab=health", "Back to the vehicle record", f"/vehicles/{_q('DMO 9001')}")],
    },
    {
        "id": "UC-07", "title": "HQ exception investigation", "session": None, "lane": None,
        "plate": None, "vehicle": "Operations", "vtype": "All hubs",
        "scenario": "HQ sees its open exceptions: an examiner passing far more vehicles than peers, a brake tester close "
                    "to failure and a hub short of lane capacity. It drills into one and acts.",
        "outcome": "The action is recorded (and hash-chained) and HQ shows the exception as handled.",
        "minutes": 4, "provenance": ["synthetic", "simulated", "live_model", "mock"], "autostart": False,
        "steps": [
            _visit("hq", "Exceptions", "Open exceptions at HQ", "/oversight/hq", "Open HQ operations"),
            _visit("drill", "Evidence", "The evidence behind an exception", "/oversight/hq?", "Open an exception", "/oversight/hq?"),
            {"id": "act", "stage": "Resolution", "label": "Action recorded", "kind": "exception_action", "href": "/oversight/hq",
             "cta": "Record an action"},
            _visit("back", "Updated", "HQ shows the exception as handled", "/oversight/hq", "Back to HQ"),
        ],
    },
    {
        "id": "UC-08", "title": "Flood watch to inspection invitation", "session": "S2", "lane": "BR00-L2",
        "plate": "DMO 9002", "vehicle": "BYD Atto 3", "vtype": "Passenger · electric",
        "scenario": "Flood watch sets river levels and flood events against the registered vehicles. In the view of the "
                    "December 2025 floods it ranks an EV at high risk; HQ invites its owner for a flood-damage inspection.",
        "outcome": "The invitation is recorded (mock), the EV is inspected, and flood watch shows the result.",
        "minutes": 8, "provenance": ["synthetic", "live_logic", "live_model", "mock", "simulated"], "autostart": False,
        "steps": [
            _visit("flood", "Risk view", "Districts and vehicles at risk in the December 2025 floods", f"/oversight/flood?scope={FLOOD_EVENT}",
                   "Open flood watch", "/oversight/flood"),
            _visit("vehicle", "At-risk vehicle", "Why DMO 9002 is at risk", f"/oversight/flood?scope={FLOOD_EVENT}&vehicle={_q('DMO 9002')}",
                   "Open the vehicle", "*vehicle=DMO"),
            {"id": "invite", "stage": "Invitation", "label": "Owner invited (mock)", "kind": "invited",
             "href": f"/oversight/flood?scope={FLOOD_EVENT}&vehicle={_q('DMO 9002')}", "cta": "Invite for inspection"},
        ] + _lane("S2", "BR00-L2", "DMO 9002") + [
            _visit("downstream", "Result", "Flood watch shows the inspection result", f"/oversight/flood?scope={FLOOD_EVENT}&vehicle={_q('DMO 9002')}",
                   "Back to flood watch", "*vehicle=DMO")],
    },
    {
        "id": "UC-09", "title": "Used-vehicle buyer trust and verification", "session": None, "lane": None,
        "plate": "DMO 9003", "vehicle": "Honda Civic", "vtype": "Passenger · petrol",
        "scenario": "A buyer searches the listings, opens a Civic's full record, sees its red flags and the latest "
                    "inspection report, then scans the report's QR code.",
        "outcome": "The public verification page says Genuine, unaltered report, without a login.",
        "minutes": 3, "provenance": ["synthetic", "live_logic"], "autostart": False,
        "steps": [
            _visit("listings", "Search", "Search the listings", "/oversight/sales", "Open the listings"),
            _visit("record", "Vehicle record", "Full record and red flags", "/oversight/sales?id={listing}", "Open the vehicle record",
                   "/oversight/sales?id="),
            _visit("report", "Latest report", "Latest inspection report", "/oversight/sales?id={listing}#report", "See the latest report",
                   "/oversight/sales?id={listing}#report"),
            _visit("verify", "Verification", "Public verification: genuine, unaltered", "/verify/{token}", "Verify the report",
                   "/verify/"),
        ],
    },
]
BY_ID = {u["id"]: u for u in USECASES}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def _get(key: str) -> dict | None:
    with session_scope() as s:
        row = s.get(Setting, key)
        return dict(row.value) if row else None


def _put(key: str, value: dict | None) -> None:
    with session_scope() as s:
        row = s.get(Setting, key)
        if value is None:
            if row:
                s.delete(row)
        elif row:
            row.value = value
        else:
            s.add(Setting(key=key, value=value))


def _since(run: dict) -> dt.datetime:
    return dt.datetime.fromisoformat(run["started_at"])


def _inspection(uc: dict, since: dt.datetime) -> dict | None:
    if not uc.get("session"):
        return None
    with session_scope() as s:
        li = s.execute(select(LiveInspection).where(LiveInspection.session_id == uc["session"], LiveInspection.started_at >= since)
                       .order_by(LiveInspection.started_at.desc())).scalars().first()
        if li is None:
            return None
        alerts = s.execute(select(Alert).where(Alert.inspection_id == li.inspection_id)).scalars().all()
        rep = s.execute(select(Report).where(Report.inspection_id == li.inspection_id)).scalars().first()
        return {"inspection_id": li.inspection_id, "status": li.status, "route": li.route, "examiner_id": li.examiner_id,
                "plate": li.plate, "anpr": bool((li.results or {}).get("anpr")), "health": li.health_score, "verdict": li.verdict,
                "alerts": len(alerts), "open": sum(a.status == "open" for a in alerts),
                "open_required": sum(a.status == "open" and a.severity == "high" for a in alerts),
                "report": {"report_id": rep.report_id, "verdict": rep.verdict, "verify_token": rep.verify_token,
                           "senior": bool((rep.data.get("examiner") or {}).get("senior"))} if rep else None}


def _latest_report(plate: str) -> dict | None:
    with session_scope() as s:
        r = s.execute(select(Report).where(Report.plate == plate).order_by(Report.created_at.desc())).scalars().first()
        return {"report_id": r.report_id, "verify_token": r.verify_token, "verdict": r.verdict} if r else None


def _listing(plate: str) -> str | None:
    with session_scope() as s:
        row = s.execute(select(Listing).where(Listing.plate == plate)).scalars().first()
        return row.listing_id if row else None


def _check(step: dict, uc: dict, run: dict, insp: dict | None, done_before: bool) -> bool:
    kind, since = step["kind"], _since(run)
    plate = uc.get("plate")
    if kind == "visit":
        return step["id"] in run.get("visits", {})
    if kind == "checkin":
        return bool(insp and (insp["anpr"] or insp["status"] != "in_lane"))
    if kind == "lane_done":
        return bool(insp and insp["status"] != "in_lane")
    if kind == "reviewed":
        return bool(insp and insp["status"] != "in_lane" and insp["open_required"] == 0)
    if kind == "decided":
        return bool(insp and insp["status"] != "in_lane" and (insp["open"] == 0 or insp["report"]))
    if kind == "referred":
        return bool(insp and (insp["examiner_id"] == "VE001" or (insp["report"] or {}).get("senior")))
    if kind == "report":
        return bool(insp and insp["report"])
    with session_scope() as s:
        if kind == "selfcheck":
            return s.execute(select(SelfCheck).where(SelfCheck.plate == plate, SelfCheck.created_at >= since,
                                                     SelfCheck.verdict.in_(("Ready for inspection", "Likely to pass"))
                                                     )).first() is not None
        if kind == "booked":
            return s.execute(select(Booking).where(Booking.plate == plate, Booking.created_at >= since,
                                                   Booking.status.in_(("confirmed", "checked_in")))).first() is not None
        if kind == "booking_checked_in":
            return s.execute(select(Booking).where(Booking.plate == plate, Booking.created_at >= since,
                                                   Booking.status == "checked_in")).first() is not None
        if kind == "fleet_booked":
            return s.execute(select(Booking).where(Booking.plate == plate, Booking.created_at >= since,
                                                   Booking.source == "fleet")).first() is not None
        if kind == "invited":
            v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
            return v is not None and s.execute(select(FloodInvitation).where(FloodInvitation.vehicle_id == v.vehicle_id,
                                                                             FloodInvitation.created_at >= since)).first() is not None
    if kind == "exception_action":
        return any(dt.datetime.fromisoformat(x["at"]).replace(tzinfo=None) >= since
                   for x in (_get("hq_exceptions") or {}).values())
    return False


def _fill(href: str, uc: dict) -> str:
    if "{listing}" in href:
        href = href.replace("{listing}", _listing(uc["plate"]) or "")
    if "{token}" in href:
        rep = _latest_report(uc["plate"])
        href = href.replace("{token}", rep["verify_token"] if rep else "")
    return href


def public(uc: dict) -> dict:
    return {k: v for k, v in uc.items() if k != "steps"} | {
        "stages": [s["stage"] for s in uc["steps"]], "n_steps": len(uc["steps"])}


def progress(uc: dict, run: dict | None) -> dict:
    """Every step with done / current, and the next thing to do."""
    insp = _inspection(uc, _since(run)) if run else None
    steps, prev_done = [], True
    for st in uc["steps"]:
        done = bool(run) and prev_done and _check(st, uc, run, insp, prev_done)
        steps.append({k: v for k, v in st.items() if k != "match"} | {"href": _fill(st["href"], uc), "done": done})
        prev_done = prev_done and done
    nxt = next((s for s in steps if not s["done"]), None)
    if nxt:
        nxt["current"] = True
    return {**public(uc), "steps": steps, "done": sum(s["done"] for s in steps), "complete": nxt is None and bool(run),
            "next": nxt, "inspection": insp, "run": run,
            "latest_report": _latest_report(uc["plate"]) if uc.get("plate") else None}


def catalogue() -> dict:
    active = _get(ACTIVE)
    return {"active": active, "items": [progress(u, active if active and active["id"] == u["id"] else None) for u in USECASES]}


def active() -> dict | None:
    run = _get(ACTIVE)
    if not run or run["id"] not in BY_ID:
        return None
    return progress(BY_ID[run["id"]], run)


def start(uc_id: str, actor: str = "presenter") -> dict:
    uc = BY_ID.get(uc_id)
    if uc is None:
        raise HTTPException(404, "unknown use case")
    run = {"id": uc_id, "started_at": _now().isoformat(timespec="seconds"), "visits": {}}
    _reset(uc, actor)
    _put(ACTIVE, run)
    return progress(uc, run)


def _reset(uc: dict, actor: str) -> None:
    """The scenario state this use case owns, so it can run again from the start."""
    plate = uc.get("plate")
    with session_scope() as s:
        if uc["id"] in ("UC-05", "UC-06") and plate:
            # open bookings, and visits checked in at a lane whose inspection never got a report (an earlier run
            # stopped half-way): either would make the use case's own booking or check-in step look done already
            last = s.execute(select(Report.created_at).where(Report.plate == plate).order_by(Report.created_at.desc())).scalars().first()
            for b in s.execute(select(Booking).where(Booking.plate == plate, Booking.status.in_(("pending_payment", "confirmed", "checked_in")))).scalars():
                if b.status != "checked_in" or last is None or b.created_at > last:
                    b.status = "cancelled"
        if uc["id"] == "UC-08" and plate:
            v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
            if v is not None:
                for inv in s.execute(select(FloodInvitation).where(FloodInvitation.vehicle_id == v.vehicle_id)).scalars():
                    s.delete(inv)
    if uc["id"] == "UC-07":
        from . import exceptions
        exceptions.reopen(actor)


def stop() -> None:
    _put(ACTIVE, None)


def visit(path: str) -> dict | None:
    """The presenter opened a page: record it against the active use case's next visit step, if it is that one."""
    run = _get(ACTIVE)
    if not run or run["id"] not in BY_ID:
        return None
    uc = BY_ID[run["id"]]
    p = progress(uc, run)
    nxt = p["next"]
    if nxt and nxt["kind"] == "visit":
        step = next(s for s in uc["steps"] if s["id"] == nxt["id"])
        match = _fill(step["match"], uc)
        # "*text" matches anywhere in the address (query parameters come in any order), otherwise it is a prefix
        hit = match[1:] in path if match.startswith("*") else path.startswith(match)
        if hit and (step["id"] != "drill" or len(path) > len("/oversight/hq?")):
            run.setdefault("visits", {})[step["id"]] = _now().isoformat(timespec="seconds")
            _put(ACTIVE, run)
            p = progress(uc, run)
    return p

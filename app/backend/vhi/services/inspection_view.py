"""What the inspection screens show about one live inspection, derived from what the lane and the examiner recorded:
the inspection checklist (each item's status from the lane steps, the results and the decisions on its findings), the
verdict the rules give right now, the photos per camera view, and the examiner's own captures and remarks.

Nothing here decides anything new: a checklist item passes when the lane has measured it and nothing was flagged,
and its findings' decisions say the rest (vhi.services.reports holds the verdict rules).
"""
from __future__ import annotations

import datetime as dt
import uuid
from pathlib import Path

from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select

from .. import lane
from ..db import session_scope
from ..ml.vision import annotate
from ..pipeline.processor import alert_dict
from ..tables import Alert, Booking, LiveInspection, Vehicle
from . import booking as booking_svc
from . import evidence
from . import inspection_systems as systems

STEPS = lane.STEPS

# The checklist follows the lane's ten stations in order (vhi/lane.py): id, label, icon, the lane steps that measure
# it, the finding codes that belong to it. An EV has "EV battery & high voltage" in place of Emission.
ITEMS = [
    ("identification", "Identification", "car", ["check_in_anpr", "identity_ocr"], ("anpr:", "identity:", "route:")),
    ("above_carriage", "Above-carriage", "car", ["above_carriage_ai"],
     ("body:", "capture:front", "capture:rear", "capture:left", "capture:right", "capture:interior", "corrosion:cabin", "flood")),
    ("tinted_glass", "Tinted glass", "cam", ["tinted_glass"], ("tint",)),
    ("emission", "Emission", "smoke", ["emission_idle_rev"], ("pn:", "emissions:", "dtc:", "acoustic:")),
    ("ev", "EV battery & high voltage", "batt", ["emission_idle_rev"], ("ev:", "thermal:pack")),
    ("side_slip", "Side slip", "steering", ["side_slip"], ("side_slip",)),
    ("suspension", "Suspension", "spring", ["suspension"], ("suspension", "acoustic:wheel_bearing")),
    ("brake", "Brake", "brake", ["brake_roller"], ("brake:", "thermal:A")),
    ("undercarriage", "Undercarriage", "rust", ["undercarriage_ai"], ("corrosion:undercarriage", "capture:underbody", "tyre:", "capture:tyre")),
    ("speedometer", "Speedometer", "gauge", ["speedometer"], ("speedo",)),
    ("headlight", "Headlight alignment", "lamp", ["headlight_alignment"], ("headlamp",)),
    ("final", "Final review", "check", ["examiner_review"], ()),
]
VIEWS = {  # camera view -> AI module and model task
    "front": ("above", "damage"), "rear": ("above", "damage"), "left": ("above", "damage"), "right": ("above", "damage"),
    "underbody": ("undercarriage", "corrosion"), "interior": ("above", "corrosion"), "tyre": ("tyre", "tyre"),
}
CAMERA_VIEW = {"Rear-left camera": "left", "Rear camera": "rear", "Cabin camera": "interior", "Tyre scanner": "tyre"}


def _item_of(code: str, ev: bool) -> str:
    if code == "flood" and ev:
        return "ev"
    if code.startswith("acoustic:") and "wheel_bearing" in code:
        return "suspension"
    for iid, _, _, _, codes in ITEMS:
        if any(code.startswith(c) for c in codes):
            return "ev" if iid == "emission" and ev else iid  # an EV's fault codes belong with its battery checks
    return "ev" if ev else "emission"


def checklist(li: dict, alerts: list[dict]) -> dict:
    ev = (li.get("vehicle") or {}).get("fuel") == "ev"
    step = li.get("step") or ""
    cur = len(STEPS) if li["status"] != "in_lane" or step == "done" else (STEPS.index(step) if step in STEPS else -1)
    by_item: dict[str, list] = {}
    for a in alerts:
        by_item.setdefault(_item_of(a["code"], ev), []).append(a)
    items = []
    for iid, label, icon, steps, _ in ITEMS:
        if iid == "ev" and not ev:
            continue
        if iid == "emission" and ev:
            continue
        found = by_item.get(iid, [])
        first, last = min(STEPS.index(s) for s in steps), max(STEPS.index(s) for s in steps)
        if iid == "final":
            st = ("pass" if li.get("report") else "review" if li["status"] != "in_lane" else "not_started")
        elif any(a["status"] == "open" for a in found):
            st = "review"
        elif found and any(a["status"] == "confirmed" and a["fail_item"] for a in found):
            st = "fail"
        elif found and any(a["status"] in ("confirmed", "advisory", "deferred") for a in found):
            st = "advisory"
        elif cur > last:
            st = "pass"
        elif cur >= first:
            st = "in_progress"
        else:
            st = "not_started"
        items.append({"id": iid, "label": label, "icon": icon, "status": st, "findings": len(found),
                      "open": sum(a["status"] == "open" for a in found)})
    done = sum(1 for i in items if i["status"] in ("pass", "advisory", "fail"))
    return {"items": items, "done": done, "total": len(items)}


def verdict_preview(li: LiveInspection, alerts: list[Alert], senior: bool) -> dict:
    from .reports import _verdict
    verdict, reasons = _verdict(li, alerts, senior)
    open_high = sum(1 for a in alerts if a.status == "open" and a.severity == "high")
    return {"verdict": verdict, "reasons": reasons, "open_required": open_high,
            "can_issue": li.status in ("review", "decided") and open_high == 0}


def captures(li: dict) -> list[dict]:
    """The photos per camera view: the lane's frames, then the examiner's own captures (newest wins)."""
    out = {}
    for im in (li.get("results") or {}).get("images", []):
        view = im.get("view") or ("underbody" if im.get("kind") == "undercarriage" else CAMERA_VIEW.get(im.get("camera") or "", None))
        if view is None:
            view = "rear" if im.get("kind") == "body" else im.get("kind")
        result = (f"Corrosion {im['corrosion_score']}/10" if im.get("corrosion_score") is not None
                  else f"{im.get('label', '')} ({round((im.get('p') or 0) * 100)}%)")
        out[view] = {"view": view, "image": im.get("annotated"), "source_image": im.get("source_image"), "camera": im.get("camera"),
                     "module": systems.label(im.get("system", "above")) if im.get("system") in systems.SYSTEMS else im.get("system"),
                     "result": result, "flag": bool(im.get("flag")), "at": im.get("at"), "by": im.get("by"),
                     "source": "examiner" if im.get("by") else "lane"}
    return [out.get(v) or {"view": v, "image": None} for v in ("front", "rear", "left", "right", "underbody", "interior", "tyre")]


def add_capture(iid: str, view: str, data: bytes, filename: str, actor: str, evdir: Path, models, media_url) -> tuple[dict, dict | None]:
    """An examiner's photo for one camera view: stored with the inspection's evidence, run through the view's AI module,
    and raised as a finding when the module flags it. Returns the image entry and the new finding (if any)."""
    if view not in VIEWS:
        raise HTTPException(400, f"view must be one of {', '.join(VIEWS)}")
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        if li.status == "reported":
            raise HTTPException(409, "report already issued; the record is closed")
    folder = evdir / iid
    folder.mkdir(parents=True, exist_ok=True)
    src = folder / f"capture_{view}_{uuid.uuid4().hex[:6]}.jpg"
    try:  # always stored as a re-encoded JPEG: never the uploaded bytes or name as they came
        from io import BytesIO
        Image.open(BytesIO(data)).convert("RGB").save(src, quality=90)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "that file is not an image") from e
    system, task = VIEWS[view]
    if task == "corrosion":
        r = models.vision.corrosion.analyse(src)
        flag = r["corrosion_score"] >= 4
        banner = f"Corrosion {r['corrosion_score']}/10 ({r['level']}) - examiner capture"
        boxes = r["boxes"]
    else:
        r = models.vision.classify(task, src)
        flag = bool(r.get("available")) and ((task == "tyre" and r["class"] == "defective" and r["p"] >= 0.6)
                                            or (task == "damage" and r["class"] != "normal" and r["p"] >= 0.5))
        banner = f"{r.get('label', 'model unavailable')} ({r.get('p', 0):.0%}) - examiner capture"
        boxes = []
    out = folder / f"{src.stem}_ai.jpg"
    annotate(src, out, boxes, banner)
    at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    item = {"kind": view, "view": view, "camera": "Examiner capture", "system": system, "source_image": media_url(str(src)),
            "annotated": media_url(str(out)), "model": "corrosion segmentation" if task == "corrosion" else f"{task} classifier",
            "flag": flag, "by": actor, "at": at, **{k: v for k, v in r.items() if k != "boxes"}, "boxes": boxes}
    ev = evidence.append("image_capture", {"view": view, "flag": flag, "by": actor, "image_sha256": evidence.file_sha256(src)}, iid, actor=actor)
    new_alert = None
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        res = dict(li.results or {})
        res["images"] = [*res.get("images", []), item]
        li.results = res
        if flag:
            label = systems.label(system)
            what = {"tyre": "Tyre defect", "damage": "Body damage", "corrosion": "Corrosion"}[task]
            a = Alert(inspection_id=iid, code=f"capture:{view}:{ev['seq']}", title=f"{what} on the {view} capture ({label})",
                      detail=f"{label} flagged the examiner's {view} photo: {banner.split(' - ')[0]}. Added after the lane: it is not "
                             "in the health score.", system={"tyre": "Tyres", "damage": "Lights & body", "corrosion": "Lights & body"}[task],
                      severity="medium", confidence=float(r.get("p") or min(0.97, 0.6 + r.get("corrosion_score", 0) / 25)),
                      source="live_model" if task != "corrosion" else "live_logic", evidence={"image": item},
                      rank=1 + max([x.rank for x in s.execute(select(Alert).where(Alert.inspection_id == iid)).scalars()] or [0]))
            s.add(a)
            s.flush()
            new_alert = alert_dict(a)
    return item, new_alert


def add_remark(iid: str, text: str, actor: str) -> list[dict]:
    text = text.strip()
    if len(text) < 2:
        raise HTTPException(400, "write a remark first")
    at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    ev = evidence.append("remark", {"text": text, "by": actor}, iid, actor=actor)
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        res = dict(li.results or {})
        res["remarks"] = [*res.get("remarks", []), {"text": text[:500], "by": actor, "at": at, "chain_seq": ev["seq"]}]
        li.results = res
        return res["remarks"]


def booking_for(li: dict) -> dict | None:
    b = ((li.get("results") or {}).get("anpr") or {}).get("booking")
    if not b:
        return None
    with session_scope() as s:
        row = s.get(Booking, b["booking_id"])
        return booking_svc.booking_dict(row) if row else None


def owner_of(plate: str) -> dict:
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
        if v is None:
            return {}
        return {"name": v.owner_name or ("Fleet vehicle" if v.fleet_id else "Company vehicle"), "type": v.owner_type,
                "state": v.state, "vtype": v.vtype, "year": v.year, "fuel": v.fuel, "odometer_km": v.odometer_km,
                "mvl_expiry": v.mvl_expiry, "fleet_id": v.fleet_id}


TYPE_CODE = {"Commercial Periodic Inspection": "PERIODIC", "Ownership Transfer Inspection": "TRANSFER", "Voluntary Inspection": "VOLUNTARY"}


def reinspection(iid: str, actor: str) -> dict:
    """Book the re-inspection of a failed vehicle: the first free slot at its hub from tomorrow."""
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        if li.verdict not in ("FAIL", "REFERRED"):
            raise HTTPException(409, "only a failed or referred inspection is booked for a re-inspection")
        plate, branch, itype = li.plate, li.branch_id, li.inspection_type
    code = "EV" if "EV" in itype else next((c for k, c in TYPE_CODE.items() if itype.startswith(k.split(" Inspection")[0])), "VOLUNTARY")
    d = booking_svc.today() + dt.timedelta(days=1)
    for _ in range(30):
        if d.weekday() != 6:
            free = [x for x in booking_svc.slots(branch, d.isoformat()) if x["available"] and not x["gear"]]
            if free:
                b = booking_svc.create(plate, branch, d.isoformat(), free[0]["time"], code, source="examiner")
                evidence.append("reinspection_booked", {"booking_id": b["booking_id"], "date": b["date"], "slot": b["slot"]}, iid, actor=actor)
                return b
        d += dt.timedelta(days=1)
    raise HTTPException(409, "no free slot in the next 30 days")


SEV_ORDER = {"high": 0, "medium": 1, "low": 2}


def findings_summary(s, iids: list[str]) -> dict[str, dict]:
    """Per inspection: how many findings, how many still open, how many of those are critical (high severity or a fail
    item: the ones that block the report), and the most serious open one (or the most serious overall when all are
    decided). One query for any number of inspections."""
    from ..tables import Alert
    out: dict[str, dict] = {i: {"findings": 0, "open": 0, "open_required": 0, "decided": 0, "top": None} for i in iids}
    if not iids:
        return out
    rows = s.execute(select(Alert).where(Alert.inspection_id.in_(iids))).scalars().all()
    best: dict[str, tuple] = {}
    for a in rows:
        o = out[a.inspection_id]
        o["findings"] += 1
        is_open = a.status == "open"
        o["open"] += is_open
        o["decided"] += not is_open
        o["open_required"] += is_open and (a.severity == "high" or bool(a.fail_item))
        rank = (not is_open, SEV_ORDER.get(a.severity, 3), not a.fail_item, a.rank or 99)
        if a.inspection_id not in best or rank < best[a.inspection_id][0]:
            best[a.inspection_id] = (rank, {"alert_id": a.alert_id, "title": a.title, "severity": a.severity, "open": is_open,
                                            "fail_item": bool(a.fail_item)})
    for i, (_, top) in best.items():
        out[i]["top"] = top
    return out

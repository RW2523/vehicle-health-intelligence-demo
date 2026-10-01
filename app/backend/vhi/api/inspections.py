"""Live inspections: state, readings, alerts and examiner decisions."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, text

from .. import auth
from ..db import engine, session_scope
from ..pipeline.processor import alert_dict
from ..runtime import rt
from ..services import reports as report_svc
from ..tables import Alert, Branch, Examiner, LiveInspection, Report
from .deps import clean

router = APIRouter(prefix="/api/inspections", tags=["inspections"])


class DecisionReq(BaseModel):
    action: str
    reason: str = ""
    examiner_id: str = "VE012"
    recommendation: str = ""


class RemarkReq(BaseModel):
    text: str


class RouteReq(BaseModel):
    examiner_id: str = "VE012"
    senior_id: str = "VE001"
    note: str = ""


class IssueReq(BaseModel):
    examiner_id: str = "VE012"
    senior_signed: bool = False


class AskReq(BaseModel):
    question: str
    alert_id: str | None = None


def _li_dict(li: LiveInspection) -> dict:
    return {"inspection_id": li.inspection_id, "session_id": li.session_id, "lane_id": li.lane_id, "branch_id": li.branch_id,
            "vehicle_id": li.vehicle_id, "plate": li.plate, "inspection_type": li.inspection_type, "status": li.status,
            "step": li.step, "started_at": li.started_at.isoformat() if li.started_at else None,
            "finished_at": li.finished_at.isoformat() if li.finished_at else None, "examiner_id": li.examiner_id,
            "route": li.route, "health_score": li.health_score, "next_fail_risk": li.next_fail_risk, "verdict": li.verdict,
            "measurements": li.measurements, "results": li.results, "fusion": li.fusion}


@router.get("")
def list_inspections(status: str | None = None, lane_id: str | None = None, limit: int = 30):
    with session_scope() as s:
        q = select(LiveInspection).order_by(LiveInspection.started_at.desc())
        if auth.examiner_branch():
            q = q.where(LiveInspection.branch_id == auth.examiner_branch())
        if status:
            q = q.where(LiveInspection.status == status)
        if lane_id:
            q = q.where(LiveInspection.lane_id == lane_id)
        rows = s.execute(q.limit(limit)).scalars().all()
        return [{k: v for k, v in _li_dict(li).items() if k not in ("results", "measurements")} for li in rows]


@router.get("/latest")
def latest(lane_id: str | None = None, session_id: str | None = None):
    """The newest inspection on a lane or for a session; null before the first run (not an error for the apps)."""
    with session_scope() as s:
        q = select(LiveInspection).order_by(LiveInspection.started_at.desc())
        if auth.examiner_branch():
            q = q.where(LiveInspection.branch_id == auth.examiner_branch())
        if lane_id:
            q = q.where(LiveInspection.lane_id == lane_id)
        if session_id:
            q = q.where(LiveInspection.session_id == session_id.upper())
        li = s.execute(q.limit(1)).scalar_one_or_none()
        if li is None:
            return None
        return get_inspection(li.inspection_id)


def registry_photo(plate: str) -> dict | None:
    from ..services.registry import _photo
    return _photo(plate)


@router.get("/{iid}")
def get_inspection(iid: str):
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        auth.check_branch(li.branch_id)
        d = _li_dict(li)
        alerts = s.execute(select(Alert).where(Alert.inspection_id == iid).order_by(Alert.rank, Alert.created_at)).scalars().all()
        d["alerts"] = [alert_dict(a) for a in alerts]
        br, ex = s.get(Branch, li.branch_id), s.get(Examiner, li.examiner_id)
        d["branch_name"] = br.name if br else li.branch_id
        d["examiner"] = {"id": li.examiner_id, "name": ex.name if ex else li.examiner_id, "senior": bool(ex and ex.senior)}
        rep = s.execute(select(Report).where(Report.inspection_id == iid)).scalar_one_or_none()
        d["report"] = report_svc.report_dict(rep) if rep else None
    ctx = rt().processor.ctx.get(iid) if rt().processor else None
    d["live"] = ctx is not None
    from ..services import inspection_view as view
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        alerts_rows = s.execute(select(Alert).where(Alert.inspection_id == iid)).scalars().all()
        ex = s.get(Examiner, li.examiner_id)
        d["verdict_preview"] = view.verdict_preview(li, alerts_rows, bool(ex and ex.senior))
    d["owner"] = view.owner_of(d["plate"])
    d["photo"] = registry_photo(d["plate"])
    d["booking"] = view.booking_for(d)
    d["remarks"] = (d.get("results") or {}).get("remarks", [])
    if ctx:
        d["timeline"] = ctx.timeline
        d["vehicle"] = ctx.vehicle
    else:
        import json as _json

        sid = (d.get("session_id") or "").upper()
        f = rt().settings.sessions_dir / f"{sid}.json"
        d["timeline"] = _json.loads(f.read_text())["lane_timeline"] if sid and f.exists() else []
        from ..tables import Vehicle
        with session_scope() as s:
            v = s.execute(select(Vehicle).where(Vehicle.plate == d["plate"])).scalar_one_or_none()
            d["vehicle"] = {"plate": v.plate, "make": v.make, "model": v.model, "year": v.year, "fuel": v.fuel,
                            "vehicle_id": v.vehicle_id} if v else {"plate": d["plate"]}
    d["checklist"] = view.checklist(d, d["alerts"])
    d["captures"] = view.captures(d)
    return clean(d)


@router.get("/{iid}/readings")
def readings(iid: str, sensor: str = Query(...), limit: int = 2000):
    _in_my_branch(iid)
    df = pd.read_sql(text("select t_s, payload from readings where inspection_id = :i and sensor = :s order by t_s limit :n"),
                     engine(), params={"i": iid, "s": sensor, "n": limit})
    import json as _json
    return [{"t_s": r.t_s, **(_json.loads(r.payload) if isinstance(r.payload, str) else r.payload)} for r in df.itertuples()]


def _in_my_branch(iid: str) -> None:
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        auth.check_branch(li.branch_id)


def _examiner(requested: str) -> str:
    """An examiner acts as themselves; the presenter may act as any examiner."""
    a = auth.user()
    return a.examiner_id if a and a.examiner_id else requested


@router.post("/alerts/{alert_id}/decision")
async def decision(alert_id: str, req: DecisionReq):
    with session_scope() as s:
        a = s.get(Alert, alert_id)
        if a is None:
            raise HTTPException(404, "alert not found")
        iid = a.inspection_id
    _in_my_branch(iid)
    out = report_svc.decide(alert_id, req.action, req.reason, _examiner(req.examiner_id), req.recommendation)
    await rt().hub.broadcast(f"inspection:{out['inspection_id']}", "decision", out, remember=False)
    rt().hub.patch_remembered("alert", "alert_id", out)
    return out


@router.post("/{iid}/route-senior")
async def route_senior(iid: str, req: RouteReq):
    _in_my_branch(iid)
    out = report_svc.route_senior(iid, _examiner(req.examiner_id), req.senior_id, req.note)
    await rt().hub.broadcast(f"inspection:{iid}", "route", out, remember=False)
    return out


@router.post("/{iid}/report")
async def issue_report(iid: str, req: IssueReq):
    import asyncio

    _in_my_branch(iid)
    a = auth.user()
    senior = a.senior if a and a.examiner_id else req.senior_signed  # a senior examiner signs as themselves
    out = await asyncio.to_thread(report_svc.issue, iid, _examiner(req.examiner_id), rt().llm, senior)
    await rt().hub.broadcast(f"inspection:{iid}", "report", out, remember=False)
    await rt().hub.broadcast("inspections", "reported", {"inspection_id": iid, "verdict": out["verdict"]}, remember=False)
    return out


@router.post("/{iid}/ask")
async def ask(iid: str, req: AskReq):
    """Context-aware assistant: answers about this inspection from the facts on record (asking changes nothing)."""
    import asyncio

    from ..services import inspection_assistant

    _in_my_branch(iid)
    return await asyncio.to_thread(inspection_assistant.ask, iid, req.question[:300], req.alert_id, rt().llm)


def _actor() -> str:
    a = auth.user()
    return (a.examiner_id or a.username) if a else "examiner"


@router.post("/{iid}/remark")
def remark(iid: str, req: RemarkReq):
    """An examiner's remark on the inspection, kept with it and in the evidence chain."""
    from ..services import inspection_view as view
    _in_my_branch(iid)
    return {"remarks": view.add_remark(iid, req.text, _actor())}


@router.post("/{iid}/capture")
async def capture(iid: str, view: str, file: UploadFile = File(...)):
    """The examiner's photo for one camera view (front, rear, left, right, underbody, interior, tyre): stored with the
    inspection, run through the view's AI module, and raised as a finding when it is flagged."""
    import asyncio

    from ..services import inspection_view as iv
    _in_my_branch(iid)
    data = await file.read()
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(413, "photo larger than 12 MB")
    item, alert = await asyncio.to_thread(iv.add_capture, iid, view, data, file.filename or "", _actor(),
                                          rt().settings.evidence_dir, rt().models, rt().processor._media_url)
    if alert:
        await rt().hub.broadcast(f"inspection:{iid}", "alert", alert, remember=False)
    return {"image": item, "finding": alert}


@router.post("/{iid}/send-report")
def send_report(iid: str):
    """MOCK: record that the report was sent to the owner. No e-mail or SMS leaves the demo."""
    from ..services import evidence
    _in_my_branch(iid)
    with session_scope() as s:
        rep = s.execute(select(Report).where(Report.inspection_id == iid)).scalar_one_or_none()
        if rep is None:
            raise HTTPException(409, "issue the report first")
        plate = rep.plate
    e = evidence.append("report_sent", {"channel": "mock", "plate": plate}, iid, actor=_actor())
    return {"sent": True, "channel": "mock", "chain_seq": e["seq"], "note": "Recorded only: no message is sent in the demo."}


@router.post("/{iid}/reinspection")
def book_reinspection(iid: str):
    from ..services import inspection_view as view
    _in_my_branch(iid)
    return view.reinspection(iid, _actor())

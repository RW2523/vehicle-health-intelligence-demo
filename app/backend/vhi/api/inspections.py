"""Live inspections: state, readings, alerts and examiner decisions."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text

from ..db import engine, session_scope
from ..pipeline.processor import alert_dict
from ..runtime import rt
from ..services import reports as report_svc
from ..tables import Alert, LiveInspection, Report
from .deps import clean

router = APIRouter(prefix="/api/inspections", tags=["inspections"])


class DecisionReq(BaseModel):
    action: str
    reason: str = ""
    examiner_id: str = "VE012"


class RouteReq(BaseModel):
    examiner_id: str = "VE012"
    senior_id: str = "VE001"
    note: str = ""


class IssueReq(BaseModel):
    examiner_id: str = "VE012"
    senior_signed: bool = False


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
        if status:
            q = q.where(LiveInspection.status == status)
        if lane_id:
            q = q.where(LiveInspection.lane_id == lane_id)
        rows = s.execute(q.limit(limit)).scalars().all()
        return [{k: v for k, v in _li_dict(li).items() if k not in ("results", "measurements")} for li in rows]


@router.get("/latest")
def latest(lane_id: str | None = None, session_id: str | None = None):
    with session_scope() as s:
        q = select(LiveInspection).order_by(LiveInspection.started_at.desc())
        if lane_id:
            q = q.where(LiveInspection.lane_id == lane_id)
        if session_id:
            q = q.where(LiveInspection.session_id == session_id.upper())
        li = s.execute(q.limit(1)).scalar_one_or_none()
        if li is None:
            raise HTTPException(404, "no inspections yet - start a session from Demo control")
        return get_inspection(li.inspection_id)


@router.get("/{iid}")
def get_inspection(iid: str):
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        d = _li_dict(li)
        alerts = s.execute(select(Alert).where(Alert.inspection_id == iid).order_by(Alert.rank, Alert.created_at)).scalars().all()
        d["alerts"] = [alert_dict(a) for a in alerts]
        rep = s.execute(select(Report).where(Report.inspection_id == iid)).scalar_one_or_none()
        d["report"] = report_svc.report_dict(rep) if rep else None
    ctx = rt().processor.ctx.get(iid) if rt().processor else None
    d["live"] = ctx is not None
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
    return clean(d)


@router.get("/{iid}/readings")
def readings(iid: str, sensor: str = Query(...), limit: int = 2000):
    df = pd.read_sql(text("select t_s, payload from readings where inspection_id = :i and sensor = :s order by t_s limit :n"),
                     engine(), params={"i": iid, "s": sensor, "n": limit})
    import json as _json
    return [{"t_s": r.t_s, **(_json.loads(r.payload) if isinstance(r.payload, str) else r.payload)} for r in df.itertuples()]


@router.post("/alerts/{alert_id}/decision")
async def decision(alert_id: str, req: DecisionReq):
    out = report_svc.decide(alert_id, req.action, req.reason, req.examiner_id)
    await rt().hub.broadcast(f"inspection:{out['inspection_id']}", "decision", out, remember=False)
    rt().hub.patch_remembered("alert", "alert_id", out)
    return out


@router.post("/{iid}/route-senior")
async def route_senior(iid: str, req: RouteReq):
    out = report_svc.route_senior(iid, req.examiner_id, req.senior_id, req.note)
    await rt().hub.broadcast(f"inspection:{iid}", "route", out, remember=False)
    return out


@router.post("/{iid}/report")
async def issue_report(iid: str, req: IssueReq):
    import asyncio

    out = await asyncio.to_thread(report_svc.issue, iid, req.examiner_id, rt().llm, req.senior_signed)
    await rt().hub.broadcast(f"inspection:{iid}", "report", out, remember=False)
    await rt().hub.broadcast("inspections", "reported", {"inspection_id": iid, "verdict": out["verdict"]}, remember=False)
    return out

"""Examiner decisions (feature 21) and QR-verifiable reports (feature 24)."""
from __future__ import annotations

import datetime as dt
import secrets

from fastapi import HTTPException
from sqlalchemy import select

from ..config import get_settings
from ..db import session_scope
from ..pipeline.processor import alert_dict
from ..tables import Alert, Branch, Examiner, LiveInspection, Report
from . import evidence
from .llm import LLM

ACTIONS = {"confirm": "confirmed", "dismiss": "dismissed", "defer": "deferred"}


def decide(alert_id: str, action: str, reason: str, examiner_id: str) -> dict:
    if action not in ACTIONS:
        raise HTTPException(400, "action must be confirm, dismiss or defer")
    if action in ("dismiss", "defer") and len(reason.strip()) < 3:
        raise HTTPException(400, "a reason is required to dismiss or defer an alert")
    with session_scope() as s:
        a = s.get(Alert, alert_id)
        if a is None:
            raise HTTPException(404, "alert not found")
        li = s.get(LiveInspection, a.inspection_id)
        if li and li.status == "reported":
            raise HTTPException(409, "report already issued; decisions are locked")
        a.status, a.reason, a.decided_by = ACTIONS[action], reason.strip(), examiner_id
        a.decided_at = dt.datetime.utcnow()
        out = alert_dict(a)
    ev = evidence.append("decision", {"alert_id": alert_id, "code": out["code"], "action": action, "reason": reason.strip(),
                                      "examiner": examiner_id, "model_confidence": out["confidence"]},
                         out["inspection_id"], actor=examiner_id)
    out["evidence"] = {**out["evidence"], "chain_seq": ev["seq"]}
    return out


def route_senior(inspection_id: str, examiner_id: str, senior_id: str, note: str) -> dict:
    with session_scope() as s:
        li = s.get(LiveInspection, inspection_id)
        if li is None:
            raise HTTPException(404, "inspection not found")
        li.route = "senior"
        li.examiner_id = senior_id
    evidence.append("routed_to_senior", {"from": examiner_id, "to": senior_id, "note": note}, inspection_id, actor=examiner_id)
    return {"inspection_id": inspection_id, "route": "senior", "examiner_id": senior_id}


def _verdict(li: LiveInspection, alerts: list[Alert], senior_signed: bool) -> tuple[str, list[str]]:
    fails = [a for a in alerts if a.status == "confirmed" and a.fail_item]
    notes = []
    identity_open = [a for a in alerts if a.code.startswith("identity:") and a.status == "confirmed"]
    if li.route == "senior" and identity_open and not senior_signed:
        return "REFERRED", ["Identity checks need a senior examiner's sign-off before a certificate is issued."]
    if fails:
        return "FAIL", [a.title for a in fails]
    advis = [a for a in alerts if a.status == "confirmed"]
    if "EV" in li.inspection_type and any(a.code.startswith(("ev:", "flood")) for a in advis):
        return "CONDITIONAL", [a.title for a in advis]
    return "PASS", notes + [a.title for a in advis]


def _template_summary(li: LiveInspection, data: dict) -> str:
    v = data["vehicle"]
    name = f"{v.get('make', '')} {v.get('model', '')} ({li.plate})".strip()
    verdict = data["verdict"]
    lead = {"PASS": f"The {name} passed its inspection.",
            "FAIL": f"The {name} did not pass its inspection.",
            "CONDITIONAL": f"The {name} received a conditional EV Health Certificate.",
            "REFERRED": f"The {name} has been referred to a senior examiner."}[verdict]
    parts = [lead]
    fails = [f["title"] for f in data["findings"] if f["fail_item"] and f["status"] == "confirmed"]
    advis = [f["title"] for f in data["findings"] if not f["fail_item"] and f["status"] == "confirmed"]
    if fails:
        parts.append(f"{len(fails)} item{'s' if len(fails) > 1 else ''} must be fixed: " + "; ".join(fails[:4]) + ".")
    if advis:
        parts.append("Also noted: " + "; ".join(advis[:4]) + ".")
    if data.get("ev"):
        e = data["ev"]
        parts.append(f"The battery is at {e['pack_soh_pct']}% of its original capacity, roughly {e['km_to_70']:,} km before it reaches 70%.")
    if data.get("flood") and data["flood"]["p"] >= 0.5:
        parts.append(f"Several signs point to past flood damage ({data['flood']['p']:.0%} likelihood).")
    h = data.get("health")
    if h:
        parts.append(f"Vehicle Health Score {h['score']}/100.")
    nf = data.get("next_fail")
    if nf:
        parts.append(f"Without repairs there is a {nf['p_fail_next']:.0%} chance of failing the next inspection.")
    dismissed = [f for f in data["findings"] if f["status"] == "dismissed"]
    if dismissed:
        parts.append(f"The examiner reviewed and dismissed {len(dismissed)} AI alert{'s' if len(dismissed) > 1 else ''}, with reasons recorded.")
    return " ".join(parts)


def issue(inspection_id: str, examiner_id: str, llm: LLM, senior_signed: bool = False) -> dict:
    with session_scope() as s:
        li = s.get(LiveInspection, inspection_id)
        if li is None:
            raise HTTPException(404, "inspection not found")
        if li.status not in ("review", "decided"):
            raise HTTPException(409, f"inspection is '{li.status}' - wait for examiner review")
        alerts = s.execute(select(Alert).where(Alert.inspection_id == inspection_id).order_by(Alert.rank)).scalars().all()
        open_high = [a for a in alerts if a.status == "open" and a.severity == "high"]
        if open_high:
            raise HTTPException(409, f"{len(open_high)} high-severity alert(s) still need a decision")
        ex = s.get(Examiner, examiner_id)
        # only an examiner who is senior in the register can sign off identity flags
        verdict, reasons = _verdict(li, alerts, bool(senior_signed and ex and ex.senior))
        br = s.get(Branch, li.branch_id)
        res, fus = li.results or {}, li.fusion or {}
        data = {
            "vehicle": {**(res.get("anpr") or {}).get("mysikap", {}), "plate": li.plate},
            "verdict": verdict, "verdict_reasons": reasons,
            "branch": br.name if br else li.branch_id, "lane": li.lane_id, "inspection_type": li.inspection_type,
            "examiner": {"id": examiner_id, "name": ex.name if ex else examiner_id, "senior": bool(ex and ex.senior)},
            "health": (fus.get("health") or {}), "next_fail": fus.get("next_fail"), "flood": fus.get("flood"),
            "ev": res.get("ev"), "measurements": li.measurements, "route": li.route,
            "identity": {"anpr": res.get("anpr"), "chassis": res.get("chassis"), "odometer": res.get("odometer"),
                         "engine": next((a.get("fingerprint") for a in res.get("acoustic", []) if a.get("fingerprint")), None)},
            "findings": [{"title": a.title, "detail": a.detail, "system": a.system, "severity": a.severity,
                          "confidence": a.confidence, "source": a.source, "status": a.status, "reason": a.reason,
                          "fail_item": a.fail_item, "decided_by": a.decided_by} for a in alerts],
            "issued_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        }
        from ..tables import Vehicle  # local import to avoid cycles
        veh = s.execute(select(Vehicle).where(Vehicle.plate == li.plate)).scalar_one_or_none()
        if veh:
            data["vehicle"].update(make=veh.make, model=veh.model, year=veh.year, fuel=veh.fuel)
        kind = (li.fusion or {}).get("report_kind") or li.inspection_type
    summary_t = _template_summary(li, data)
    source = "template"
    text = llm.chat("You write short, plain-language inspection summaries for vehicle owners and buyers in Malaysia. "
                    "Use only the facts given. 90 words max. No jargon.",
                    [{"role": "user", "content": f"FACTS: {summary_t}\nWrite the summary."}], max_tokens=220)
    if text:
        summary_t, source = text, llm.status()["backend"]
    token = secrets.token_urlsafe(9)
    head = evidence.append("report_issued", {"verdict": verdict, "kind": kind, "summary_sha256": evidence.sha256_text(summary_t),
                                             "verify_token": token, "examiner": examiner_id}, inspection_id, actor=examiner_id)
    with session_scope() as s:
        r = Report(inspection_id=inspection_id, plate=li.plate, kind=kind, verdict=verdict, summary=summary_t,
                   narrative_source=source, verify_token=token, chain_hash=head["hash"], data=data)
        s.add(r)
        li2 = s.get(LiveInspection, inspection_id)
        li2.status, li2.verdict, li2.finished_at = "reported", verdict, dt.datetime.utcnow()
        s.flush()
        return report_dict(r)


def report_dict(r: Report) -> dict:
    s = get_settings()
    return {"report_id": r.report_id, "inspection_id": r.inspection_id, "plate": r.plate, "kind": r.kind, "verdict": r.verdict,
            "summary": r.summary, "summary_source": r.narrative_source, "verify_token": r.verify_token,
            "verify_url": f"{s.public_base_url}/verify/{r.verify_token}", "chain_hash": r.chain_hash, "data": r.data,
            "created_at": r.created_at.isoformat() if r.created_at else None}


def verify_public(token: str) -> dict:
    """What a buyer sees after scanning the QR code: the result, and proof the record was not altered."""
    with session_scope() as s:
        r = s.execute(select(Report).where(Report.verify_token == token)).scalar_one_or_none()
        if r is None:
            raise HTTPException(404, "no report for this code")
        d = report_dict(r)
    chain = evidence.verify()
    anchored = any(e["hash"] == d["chain_hash"] for e in evidence.entries(d["inspection_id"], limit=500))
    data = d["data"]
    return {"valid": chain["intact"] and anchored, "report_id": d["report_id"], "plate": d["plate"], "kind": d["kind"],
            "verdict": d["verdict"], "issued_at": data.get("issued_at"), "branch": data.get("branch"),
            "summary": d["summary"], "health_score": (data.get("health") or {}).get("score"),
            "ev": {k: data["ev"][k] for k in ("pack_soh_pct", "km_to_70")} if data.get("ev") else None,
            "flood_probability": (data.get("flood") or {}).get("p"),
            "findings": [{"title": f["title"], "status": f["status"]} for f in data.get("findings", []) if f["status"] == "confirmed"],
            "chain": {"intact": chain["intact"], "entries_checked": chain["checked"], "report_anchor": d["chain_hash"],
                      "anchored": anchored}}

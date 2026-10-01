"""Context-aware assistant for one inspection: answers from the facts the application holds about it (its findings,
decisions, measurements, health score and the vehicle's earlier inspections), keeps those retrieved facts separate
from the generated explanation, and says plainly when something is not on record. The local LLM only rephrases the
facts; without it the answer is assembled from the same facts by a template."""
from __future__ import annotations

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import select, text

from .. import terms
from ..db import engine, session_scope
from ..tables import Alert, LiveInspection, Report
from .llm import LLM

QUICK = {
    "why": "Why was this vehicle flagged?",
    "unresolved": "Summarise the unresolved findings",
    "trend": "Show the previous inspection trend",
    "evidence": "What evidence supports this finding?",
    "next": "What should the examiner verify next?",
}
SEV = {"high": "Critical", "medium": "Attention", "low": "Normal"}
SYSTEM = ("You explain a vehicle inspection to an examiner. Use ONLY the numbered FACTS. Refer to facts as [1], [2]. "
          "If the question needs something that is not in the FACTS, say it is not on record. Never invent readings, "
          "limits, claims, history or confidence. At most 90 words, plain language.")


def _intent(q: str) -> str:
    s = q.lower()
    for k, v in QUICK.items():
        if s.strip() == v.lower():
            return k
    if any(w in s for w in ("trend", "history", "previous", "earlier", "past", "before")):
        return "trend"
    if any(w in s for w in ("unresolved", "open", "pending", "outstanding", "left", "remaining")):
        return "unresolved"
    if any(w in s for w in ("evidence", "support", "proof", "why this finding")):
        return "evidence"
    if any(w in s for w in ("verify", "next", "check")):
        return "next"
    return "why"


def _fact(facts: list, text_: str, ref: str | None = None, kind: str = "finding") -> None:
    facts.append({"n": len(facts) + 1, "text": text_, "ref": ref, "kind": kind})


def ask(iid: str, question: str, alert_id: str | None, llm: LLM) -> dict:
    with session_scope() as s:
        li = s.get(LiveInspection, iid)
        if li is None:
            raise HTTPException(404, "inspection not found")
        alerts = s.execute(select(Alert).where(Alert.inspection_id == iid).order_by(Alert.rank, Alert.created_at)).scalars().all()
        al = [{"id": a.alert_id, "title": a.title, "detail": a.detail, "system": a.system, "sev": a.severity, "status": a.status,
               "reason": a.reason, "source": a.source, "conf": a.confidence, "fail": a.fail_item, "code": a.code} for a in alerts]
        rep = s.execute(select(Report).where(Report.inspection_id == iid)).scalar_one_or_none()
        info = {"plate": li.plate, "vehicle_id": li.vehicle_id, "status": li.status, "route": li.route,
                "health": (li.fusion or {}).get("health"), "type": li.inspection_type, "verdict": rep.verdict if rep else None}
    intent = _intent(question)
    facts: list[dict] = []
    missing: list[str] = []
    open_ = [a for a in al if a["status"] == "open"]
    if intent in ("why", "unresolved", "next"):
        pool = open_ if intent != "why" else al
        pool = sorted(pool, key=lambda a: (a["sev"] != "high", not a["fail"]))
        for a in pool[:6]:
            extra = f" Model confidence {a['conf']:.0%}." if a["source"] == "live_model" else ""
            _fact(facts, f"{SEV.get(a['sev'], a['sev'])} · {a['title']} ({a['system']}): {a['detail']}{extra}", a["id"])
        if intent == "why" and info["health"]:
            h = info["health"]
            rules = sorted(h.get("rules", []), key=lambda r: -r["points"])[:2]
            _fact(facts, f"Vehicle Health / Risk Score {h['score']} (model {h['model_score']}"
                  + (", rule deductions: " + "; ".join(f"{r['rule']} −{r['points']}" for r in rules) if rules else "") + ").", None, "score")
        if info["route"] == "senior":
            _fact(facts, "Identity checks disagree, so a senior examiner must sign the report off.", None, "rule")
        if not pool:
            missing.append("No unresolved findings: every finding has a decision." if intent != "why" else "The inspection raised no findings.")
    if intent == "evidence":
        a = next((x for x in al if x["id"] == alert_id), None) or (sorted(open_ or al, key=lambda x: x["sev"] != "high") or [None])[0]
        if a is None:
            missing.append("There is no finding to explain.")
        else:
            _fact(facts, f"{a['title']}: {a['detail']}", a["id"])
            _fact(facts, f"Source: {a['system']}, {a['source'].replace('_', ' ')}"
                  + (f", model confidence {a['conf']:.0%}" if a["source"] == "live_model" else " (a measurement or rule, no model confidence)") + ".",
                  a["id"], "source")
            if a["status"] != "open":
                _fact(facts, f"Examiner decision: {a['status']}" + (f", reason: {a['reason']}" if a["reason"] else "") + ".", a["id"], "decision")
    if intent == "trend":
        if info["vehicle_id"]:
            h = pd.read_sql(text("select date, inspection_type, result, odometer_km, fail_reasons from hist_inspections "
                                 "where vehicle_id = :v order by date"), engine(), params={"v": info["vehicle_id"]})
            for r in h.tail(5).itertuples():
                _fact(facts, f"{str(r.date)[:10]}: {terms.label(r.inspection_type)} · {r.result} · {int(r.odometer_km):,} km"
                      + (f" · failed on {r.fail_reasons}" if r.fail_reasons else ""), None, "history")
            if not len(h):
                missing.append("No earlier inspections are on record for this vehicle.")
        else:
            missing.append("This vehicle is not in the registry, so no earlier inspections are on record.")
    answer, source = _template(intent, facts, missing, info), "template"
    if facts:
        body = "\n".join(f"[{f['n']}] {f['text']}" for f in facts)
        out = llm.chat(SYSTEM, [{"role": "user", "content": f"FACTS:\n{body}\n\nQUESTION: {question}"}], max_tokens=220)
        if out:
            answer, source = out, llm.status()["backend"]
    return {"question": question, "intent": intent, "facts": facts, "missing": missing, "answer": answer, "source": source,
            "quick": [{"id": k, "text": v} for k, v in QUICK.items()]}


def _template(intent: str, facts: list, missing: list, info: dict) -> str:
    if not facts:
        return " ".join(missing) or "Nothing on record answers this."
    n = len([f for f in facts if f["kind"] == "finding"])
    if intent == "why":
        return (f"{info['plate']} was flagged by {n} finding{'s' if n != 1 else ''}; the most serious are listed first "
                f"[1]{'-[' + str(min(3, n)) + ']' if n > 1 else ''}." + (" The score explains the overall risk." if any(f["kind"] == "score" for f in facts) else ""))
    if intent == "unresolved":
        return f"{n} finding{'s' if n != 1 else ''} still need a decision; critical ones come first [1]."
    if intent == "next":
        return f"Verify the open findings in this order, starting with [1]: each one says what to check."
    if intent == "evidence":
        return "The finding, where it came from and how it was decided are listed as facts [1]-[{}].".format(len(facts))
    return f"The vehicle's last {len(facts)} inspections on record are listed, oldest first."

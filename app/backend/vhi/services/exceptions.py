"""HQ exceptions: what needs an operations decision now, each with its reason, the evidence behind it, where to look,
and the actions HQ can record. Built from the live analytics (examiner integrity, lane-equipment health, the demand
forecast and the evidence chain); an action is stored and hash-chained, so who decided what stays auditable.

Actions that would reach another system (a maintenance work order, a roster change) are MOCK: recorded only.
"""
from __future__ import annotations

import datetime as dt

from fastapi import HTTPException

from ..db import session_scope
from ..tables import Branch, Setting
from . import evidence, insights

KEY = "hq_exceptions"
ACTIONS = {
    "integrity": [("open_review", "Open an integrity review", False), ("acknowledge", "Acknowledge", False)],
    "equipment": [("work_order", "Raise a maintenance work order", True), ("acknowledge", "Acknowledge", False)],
    "capacity": [("add_shifts", "Schedule extra lane shifts", True), ("acknowledge", "Acknowledge", False)],
    "chain": [("acknowledge", "Acknowledge", False)],
}
DONE = {"open_review": "Integrity review opened", "work_order": "Work order raised (mock)",
        "add_shifts": "Extra lane shifts scheduled (mock)", "acknowledge": "Acknowledged"}


def _state() -> dict:
    with session_scope() as s:
        row = s.get(Setting, KEY)
        return dict(row.value) if row else {}


def _branch_names() -> dict[str, str]:
    with session_scope() as s:
        return {b.branch_id: b.name for b in s.query(Branch).all()}


def _device(d: str) -> str:
    return d.replace("_", " ")


def build(models) -> list[dict]:
    names = _branch_names()
    items: list[dict] = []
    integ = insights.integrity()
    for ex_id in integ.get("flagged", []):
        rows = [e for e in integ["examiners"] if e["examiner_id"] == ex_id]
        if not rows:
            continue
        w = max(rows, key=lambda r: r["z_pass"])
        ev = [e for e in integ.get("evidence", []) if e["examiner_id"] == ex_id]
        items.append({
            "key": f"integrity:{ex_id}", "kind": "integrity", "severity": "critical",
            "title": f"Examiner {w.get('name', ex_id)} ({ex_id}) passes far more vehicles than peers",
            "reason": (f"Pass rate {w['pass_rate']:.0%} on {w['vehicle_class']} vehicles, {w['z_pass']:.1f} standard deviations "
                       f"above other examiners; measurements contradict the result in {w['conflict_rate']:.0%} of cases and "
                       f"{w['override_rate']:.0%} of results were overridden."),
            "evidence": [f"{e['date']} · {e['inspection_id']}: PASS with brake efficiency {e['brake_efficiency_pct']}%"
                         f", tread {e['tyre_tread_min_mm']} mm" for e in ev[:4]],
            "evidence_count": len(ev), "where": "Examiner integrity", "href": f"/oversight/hq?examiner={ex_id}#integrity",
            "provenance": [["synthetic", "Inspection history"], ["live_model", "z-score + Isolation Forest"]],
        })
    for d in sorted(insights.equipment().get("devices", []), key=lambda x: x["health"]):
        if d["health"] >= 50:
            continue
        where = f"{names.get(d['branch_id'], d['branch_id'])} lane {d['lane']}"
        items.append({
            "key": f"equipment:{d['branch_id']}-L{d['lane']}-{d['device']}", "kind": "equipment",
            "severity": "critical" if d["days_to_limit"] <= 7 else "attention",
            "title": f"{where}: {_device(d['device'])} at {d['health']}/100 health",
            "reason": (f"Vibration {d['vibration_now_g']:.2f} g against a limit of {d['vibration_limit_g']:.2f} g, rising "
                       f"{d['trend_g_per_day']:+.3f} g a day" + (f"; service by {d['service_by']}." if d.get("service_by") else ".")),
            "evidence": [f"Anomaly score {d['anomaly_score']:.2f} (Isolation Forest per device type)",
                         "at the limit now" if d["days_to_limit"] <= 0 else f"about {d['days_to_limit']:.0f} days to the limit"],
            "where": "Lane equipment health", "href": f"/oversight/hq?device={d['branch_id']}-{d['lane']}-{d['device']}#equipment",
            "provenance": [["simulated", "Device telemetry"], ["live_model", "Isolation Forest + trend"]],
        })
    if models is not None:
        dem = insights.demand("BR00", models)
        sm = dem["summary"]
        if sm["days_over_capacity"]:
            shifts = sum(r["extra_lane_shifts"] for r in sm["roster"])
            items.append({
                "key": "capacity:BR00", "kind": "capacity", "severity": "attention",
                "title": f"{dem['branch']}: demand above capacity on {sm['days_over_capacity']} of the next 14 days",
                "reason": f"{sm['extra_slots_needed']} more slots needed than the lanes offer: about {shifts} extra lane shifts.",
                "evidence": [f"{r['date']}: {r['extra_slots']} slots over capacity" for r in sm["roster"][:4]],
                "where": "Demand vs lane capacity", "href": "/oversight/hq?branch=BR00#demand",
                "provenance": [["synthetic", "Booking history"], ["live_model", "LightGBM forecast"]],
            })
    chain = evidence.verify()
    if not chain["intact"]:
        items.append({
            "key": "chain", "kind": "chain", "severity": "critical", "title": "The evidence chain does not verify",
            "reason": f"Entry {chain['broken_at_seq']}: {chain['reason']}.", "evidence": [], "where": "Evidence audit",
            "href": "/oversight/hq#audit", "provenance": [["live_logic", "SHA-256 hash chain"]],
        })
    state = _state()
    for it in items:
        it["actions"] = [{"id": a, "label": label, "mock": mock} for a, label, mock in ACTIONS[it["kind"]]]
        st = state.get(it["key"])
        it["state"] = st or {"status": "open"}
    return items


def overview(models) -> dict:
    items = build(models)
    order = {"open": 0, "acknowledged": 1, "actioned": 2}
    sev = {"critical": 0, "attention": 1}
    items.sort(key=lambda i: (order.get(i["state"]["status"], 0), sev.get(i["severity"], 2)))
    return {"items": items, "open": sum(1 for i in items if i["state"]["status"] == "open"),
            "note": "Actions are recorded and hash-chained. Work orders and roster changes are mock: nothing is sent."}


def act(key: str, action: str, note: str, actor: str, models) -> dict:
    item = next((i for i in build(models) if i["key"] == key), None)
    if item is None:
        raise HTTPException(404, "no such exception (it may have cleared)")
    if action not in {a["id"] for a in item["actions"]}:
        raise HTTPException(400, f"action must be one of {', '.join(a['id'] for a in item['actions'])}")
    rec = {"status": "acknowledged" if action == "acknowledge" else "actioned", "action": action, "label": DONE[action],
           "note": note.strip(), "by": actor, "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "mock": any(a["mock"] for a in item["actions"] if a["id"] == action)}
    ev = evidence.append("exception_action", {"key": key, "action": action, "note": rec["note"], "mock": rec["mock"]}, actor=actor)
    rec["chain_seq"] = ev["seq"]
    with session_scope() as s:
        row = s.get(Setting, KEY)
        value = dict(row.value) if row else {}
        value[key] = rec
        if row:
            row.value = value
        else:
            s.add(Setting(key=KEY, value=value))
    return {**item, "state": rec}


def reopen(actor: str = "presenter") -> int:
    """Demo restart: every exception is open again (recorded in the chain, the earlier actions stay in it)."""
    with session_scope() as s:
        row = s.get(Setting, KEY)
        n = len(row.value) if row else 0
        if row:
            s.delete(row)
    if n:
        evidence.append("exceptions_reopened", {"count": n, "reason": "demo use case restarted"}, actor=actor)
    return n

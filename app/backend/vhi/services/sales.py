"""Used-vehicle sales: every car and motorcycle advertised for sale, with its whole inspection record "end to end" -
inspections (history and live lane reports), odometer timeline with rollback detection, OBD read-outs, insurance
claims and policy, photos, the latest verifiable report and a plain-words trust summary for the buyer.

The listings are synthetic (vhi.seed.sales). A health score comes only with a lane report (the lane computes it at the
inspection). Past inspections show their result and measurements: in the synthetic history the result follows the
measurement limits exactly, so the health model on them would only echo PASS (~100) or FAIL (~0).
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sqlalchemy import bindparam, select, text

from .. import terms
from ..api.deps import vehicle_public
from ..config import get_settings
from ..db import engine, session_scope
from ..runtime import rt
from ..tables import Branch, LiveInspection, Listing, Report, Vehicle
from . import dtc, library
from .reports import report_dict

ODO_TOLERANCE_KM = 1000  # the same tolerance as the lane's odometer check
TYPE_LABEL = terms.INSPECTION_TYPES
REASON_LABEL = {"tyre": "Tyres", "brake_drag": "Brake drag", "brake_efficiency": "Brake efficiency", "structural": "Structure",
                "headlamp": "Headlamp aim", "tint_vlt": "Window tint", "brake_imbalance": "Brake imbalance",
                "side_slip": "Wheel alignment (side slip)", "smoke_opacity": "Smoke opacity",
                "corrosion_structural": "Structural corrosion", "suspension": "Suspension"}
CLAIM_LABEL = {"accident_own_damage": "Accident (own damage)", "third_party_property": "Third-party property damage",
               "windscreen": "Windscreen", "flood_natural_disaster": "Flood / natural disaster", "theft": "Theft"}
MEASURES = [  # what the lane measured, in the order a buyer reads it
    ("brake_efficiency_pct", "Brake efficiency", "%"), ("brake_imbalance_pct", "Brake imbalance", "%"),
    ("brake_drag_pct", "Brake drag", "%"), ("suspension_efficiency_pct", "Suspension efficiency", "%"),
    ("side_slip_m_per_km", "Side slip", "m/km"), ("tyre_tread_min_mm", "Tyre tread (worst)", "mm"),
    ("headlamp_aim_dev_pct", "Headlamp aim deviation", "%"), ("speedo_error_pct", "Speedometer error", "%"),
    ("tint_vlt_front_pct", "Front window tint (VLT)", "%"), ("co_pct", "CO", "%"), ("hc_ppm", "HC", "ppm"),
    ("smoke_opacity_pct", "Smoke opacity", "%"), ("pn_per_cm3", "Particle number", "/cm³"),
    ("ev_soh_pct", "Battery state of health", "%"), ("hv_isolation_mohm", "HV isolation", "MΩ"),
    ("corrosion_score_0_10", "Corrosion", "/10"),
]
FLAGS = ("rollback", "flood", "rebuilt", "accident", "failed", "obd", "clean")
HEALTH_MODEL = "lane health score (fusion model and rules, computed at the inspection)"
HEALTH_NOTE = ("A health score comes with a lane report; past inspections show their result and measurements. "
               "The next-inspection risk looks ahead.")
_next_fail: dict[str, dict] = {}  # inspection id -> next-fail risk (records do not change)


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(f) else f


def _frame(sql: str, ids: list[str]) -> pd.DataFrame:
    if not ids:
        return pd.DataFrame()
    q = text(sql).bindparams(bindparam("ids", expanding=True))
    return pd.read_sql(q, engine(), params={"ids": ids})


def _obd(dtcs, mil) -> dict:
    """read=False when there was no OBD read-out (carburettor motorcycles have no diagnostic port)."""
    if dtcs is None or (isinstance(dtcs, float) and np.isnan(dtcs)):
        return {"read": False, "dtcs": [], "mil_on": False}
    codes = [c.strip() for c in str(dtcs).split(",") if c.strip()]
    return {"read": True, "dtcs": [dtc.describe(c) for c in codes], "mil_on": bool(mil) and bool(codes)}


def _measures(m: dict) -> list[dict]:
    return [{"key": k, "label": label, "value": v, "unit": unit} for k, label, unit in MEASURES
            if (v := _num(m.get(k))) is not None]


def _lane_images(li: LiveInspection | None) -> list[dict]:
    if li is None:
        return []
    res = li.results or {}
    out = []
    anpr = res.get("anpr") or {}
    if anpr.get("image"):
        out.append({"url": anpr["image"], "title": f"Plate read at check-in: {anpr.get('plate', '')}",
                    "camera": anpr.get("camera"), "model": "plate OCR"})
    for im in res.get("images", []):
        label = im.get("label") or (f"corrosion score {im['corrosion_score']}" if "corrosion_score" in im else "")
        out.append({"url": im.get("annotated") or im.get("source_image"), "original": im.get("source_image"),
                    "title": f"{(im.get('kind') or 'image').capitalize()} · {label}".strip(" ·"),
                    "camera": im.get("camera"), "model": im.get("model")})
    return out


def _records(listings: list[Listing]) -> list[dict]:
    """Everything on record for each listed vehicle, loaded in a handful of queries."""
    plates = [x.plate for x in listings]
    with session_scope() as s:
        vehicles = {v.plate: v for v in s.execute(select(Vehicle).where(Vehicle.plate.in_(plates))).scalars()}
        branches = {b.branch_id: b.name for b in s.execute(select(Branch)).scalars()}
        reports = s.execute(select(Report).where(Report.plate.in_(plates)).order_by(Report.created_at)).scalars().all()
        lis = s.execute(select(LiveInspection).where(LiveInspection.plate.in_(plates))).scalars().all()
        reps = [(report_dict(r), r.created_at) for r in reports]
    live = {li.inspection_id: li for li in lis}
    reported = {r["inspection_id"] for r, _ in reps}
    ids = [v.vehicle_id for v in vehicles.values()]
    hist = _frame("select * from hist_inspections where vehicle_id in :ids order by date", ids)
    claims = _frame("select * from hist_claims where vehicle_id in :ids order by claim_date", ids)
    policies = _frame("select * from hist_policies where vehicle_id in :ids", ids)
    out = []
    for x in listings:
        v = vehicles.get(x.plate)
        if v is None:
            continue
        h = hist[hist.vehicle_id == v.vehicle_id].to_dict("records") if len(hist) else []
        ins, raw = [], {r["inspection_id"]: r for r in h}
        for r in h:
            ins.append({"id": r["inspection_id"], "date": str(r["date"])[:10], "source": "history",
                        "type": r["inspection_type"], "type_label": terms.label(r["inspection_type"]),
                        "branch": branches.get(r["branch_id"], r["branch_id"]), "examiner_id": r["examiner_id"],
                        "result": r["result"],
                        "reasons": [REASON_LABEL.get(k, k) for k in (r.get("fail_reasons") or "").split(";") if k],
                        "odometer_km": int(r["odometer_km"]) if _num(r["odometer_km"]) is not None else None,
                        "health": None, "obd": _obd(r.get("obd_dtcs"), r.get("obd_mil_on")), "measures": _measures(r),
                        "report": None, "images": []})
        for rep, created in reps:
            if rep["plate"] != v.plate:
                continue
            d, li = rep["data"], live.get(rep["inspection_id"])
            m = d.get("measurements") or {}
            odo = d.get("odometer_km") or m.get("odometer_km") or ((d.get("identity") or {}).get("odometer") or {}).get("reading_km")
            compact = {**{k: rep[k] for k in ("report_id", "verdict", "kind", "summary", "summary_source", "verify_url",
                                              "verify_token", "created_at")},
                       "issued_at": d.get("issued_at"), "branch": d.get("branch"), "synthetic": bool(d.get("synthetic")),
                       "examiner": {"name": (d.get("examiner") or {}).get("name"), "senior": bool((d.get("examiner") or {}).get("senior"))},
                       "odometer_km": int(odo) if _num(odo) is not None else None,
                       "findings": [f["title"] for f in d.get("findings", []) if f.get("status") == "confirmed"]}
            if d.get("synthetic"):
                # a seeded report mirrors an inspection already in the history: attach it there instead of listing it twice
                same = next((i for i in ins if i["source"] == "history" and i["date"] == created.date().isoformat()), None)
                if same is not None:
                    same["report"] = compact
                    continue
            raw[rep["inspection_id"]] = m
            ins.append({"id": rep["inspection_id"], "date": created.date().isoformat(), "source": "lane",
                        "type": rep["kind"], "type_label": rep["kind"], "branch": d.get("branch"),
                        "examiner_id": (d.get("examiner") or {}).get("id"), "result": rep["verdict"],
                        "reasons": d.get("verdict_reasons") or [],
                        "odometer_km": int(m["odometer_km"]) if _num(m.get("odometer_km")) is not None else None,
                        "health": (d.get("health") or {}).get("score"), "obd": _obd(m.get("obd_dtcs", ""), m.get("obd_mil_on")),
                        "measures": _measures(m),
                        "report": compact, "images": _lane_images(li)})
        ins.sort(key=lambda r: (r["date"], r["source"] == "lane"))
        pending = [li for li in lis if li.plate == v.plate and li.inspection_id not in reported and li.status in ("review", "decided")]
        out.append({"listing": x, "vehicle": v, "inspections": ins,
                    "claims": claims[claims.vehicle_id == v.vehicle_id].to_dict("records") if len(claims) else [],
                    "policy": (policies[policies.vehicle_id == v.vehicle_id].to_dict("records") or [None])[-1] if len(policies) else None,
                    "pending": pending[-1].started_at.date().isoformat() if pending else None,
                    "next_fail": _risk(ins[-1], raw.get(ins[-1]["id"], {}), v) if ins else None})
    return out


def _risk(last: dict, m: dict, v: Vehicle) -> dict | None:
    """Chance of failing the next inspection, from the next-fail model on the latest measurements (cars only)."""
    models = rt().models
    if v.vtype == "Motorcycle" or models is None:
        return None
    if last["id"] not in _next_fail:
        vd = {"year": v.year, "heavy": v.heavy, "fuel": v.fuel, "odometer_km": v.odometer_km}
        _next_fail[last["id"]] = {**models.fusion.next_fail(m, vd, last["result"] == "FAIL"), "date": last["date"],
                                  "model": "LightGBM next-fail + Weibull AFT (fusion model)"}
    return _next_fail[last["id"]]


def _odometer(ins: list[dict], v: Vehicle) -> dict:
    """Readings in time order; a reading more than 1,000 km below an earlier one is a rollback."""
    pts = [{"date": r["date"], "km": r["odometer_km"], "source": "Lane report" if r["source"] == "lane" else "Inspection record"}
           for r in ins if r["odometer_km"] is not None]
    pts.append({"date": get_settings().demo_today, "km": v.odometer_km, "source": "Seller's advert"})
    pts.sort(key=lambda p: p["date"])  # stable: on the same day the inspection comes before the advert
    events, top = [], None
    for p in pts:
        if top and p["km"] < top["km"] - ODO_TOLERANCE_KM:
            events.append({"date": p["date"], "km": p["km"], "source": p["source"], "max_km": top["km"],
                           "max_date": top["date"], "drop_km": top["km"] - p["km"]})
        if top is None or p["km"] > top["km"]:
            top = p
    return {"points": pts, "advertised_km": v.odometer_km, "max_recorded_km": top["km"] if top else None,
            "max_recorded_date": top["date"] if top else None, "rollbacks": events, "consistent": not events,
            "tolerance_km": ODO_TOLERANCE_KM}


def _money(x: float) -> str:
    return f"RM {x:,.0f}"


def _day(iso: str) -> str:
    d = dt.date.fromisoformat(iso[:10])
    return f"{d.day} {d:%b %Y}"


def _trust(v: Vehicle, ins: list[dict], odo: dict, claims: list[dict], obd: dict, pending: str | None) -> dict:
    """Plain-words summary for a buyer: every point says what the record shows and how serious it is."""
    pts: list[dict] = []
    flags: set[str] = set()
    bike = v.vtype == "Motorcycle"
    if ins:
        span = f"from {_day(ins[0]['date'])} to {_day(ins[-1]['date'])}" if len(ins) > 1 else f"on {_day(ins[0]['date'])}"
        pts.append({"level": "ok", "text": f"{len(ins)} inspection{'s' if len(ins) > 1 else ''} on record, {span}."})
        last = ins[-1]
        what = f"The latest inspection ({_day(last['date'])}, {last['type_label']})"
        why = ""
        if last["reasons"]:
            more = len(last["reasons"]) - 3
            why = ": " + "; ".join(last["reasons"][:3]) + (f" and {more} more" if more > 0 else "")
        if last["result"] == "PASS":
            pts.append({"level": "ok", "text": f"{what} passed."})
        elif last["result"] == "FAIL":
            flags.add("failed")
            pts.append({"level": "bad", "text": f"{what} failed{why}. Ask the seller for proof of repair and a re-test."})
        elif last["result"] == "REFERRED":
            flags.add("failed")
            pts.append({"level": "bad", "text": f"{what} was referred to a senior examiner{why}."})
        else:
            pts.append({"level": "warn", "text": f"{what} ended {last['result'].lower()}{why}."})
    else:
        pts.append({"level": "warn", "text": "No inspection on record for this vehicle."})
    readings = [e for e in odo["rollbacks"] if e["source"] != "Seller's advert"]
    for e in readings:
        flags.add("rollback")
        pts.append({"level": "bad", "text": f"Odometer rollback: {e['km']:,} km on {_day(e['date'])} is {e['drop_km']:,} km "
                                            f"lower than the {e['max_km']:,} km recorded on {_day(e['max_date'])}."})
    for e in odo["rollbacks"]:
        if e["source"] != "Seller's advert":
            continue
        flags.add("rollback")
        if readings:  # the advert repeats a rolled-back reading
            pts[-1]["text"] += f" The {e['km']:,} km in the advert cannot be trusted."
        else:
            pts.append({"level": "bad", "text": f"The advert says {e['km']:,} km, {e['drop_km']:,} km less than the "
                                                f"{e['max_km']:,} km recorded on {_day(e['max_date'])}."})
    if odo["consistent"] and len(odo["points"]) > 1:
        pts.append({"level": "ok", "text": f"The odometer readings rise steadily, up to {odo['advertised_km']:,} km in the advert."})
    rebuilt = [r for r in ins if r["type"] == "special_total_loss"]
    if rebuilt:
        flags.add("rebuilt")
        pts.append({"level": "bad", "text": f"Rebuilt after being written off: special inspection on {_day(rebuilt[0]['date'])}."})
    for c in claims:
        if c["claim_type"] == "flood_natural_disaster":
            flags.add("flood")
            loss = ", declared beyond economic repair" if c.get("ber_total_loss") else ""
            pts.append({"level": "bad", "text": f"Flood claim on {_day(str(c['claim_date']))} ({_money(c['amount_rm'])}{loss})."})
    acc = [c for c in claims if c["claim_type"].startswith("accident")]
    if acc:
        flags.add("accident")
        total = sum(c["amount_rm"] for c in acc)
        loss = any(c.get("ber_total_loss") for c in acc)
        pts.append({"level": "bad" if loss else "warn",
                    "text": f"{len(acc)} accident claim{'s' if len(acc) > 1 else ''}, {_money(total)} in total"
                            + (", one declared beyond economic repair." if loss else ".")})
    for c in claims:
        if c["claim_type"] == "theft":
            pts.append({"level": "warn", "text": f"Theft claim on {_day(str(c['claim_date']))}; the vehicle was recovered."})
    if not [c for c in claims if c["claim_type"] in ("flood_natural_disaster", "theft") or c["claim_type"].startswith("accident")]:
        pts.append({"level": "ok", "text": "No flood, accident or theft claims on record."})
    if obd["latest"] and obd["latest"]["dtcs"]:
        flags.add("obd")
        codes = "; ".join(f"{d['code']} ({d['description']})" for d in obd["latest"]["dtcs"])
        lamp = " The check-engine lamp was on." if obd["latest"]["mil_on"] else ""
        pts.append({"level": "warn", "text": f"Fault codes at the latest OBD read-out: {codes}.{lamp}"})
    elif obd["latest"]:
        pts.append({"level": "ok", "text": "No fault codes at the latest OBD read-out."})
    elif bike:
        pts.append({"level": "info", "text": "No OBD read-out: this model has a carburettor and no diagnostic port."})
    health = next((r["health"] for r in reversed(ins) if r["health"] is not None), None)
    if health is not None and health < 50:
        pts.append({"level": "warn", "text": f"Health score {health}/100 at the latest scored inspection."})
    if pending:
        pts.append({"level": "info", "text": f"A lane inspection on {_day(pending)} is waiting for the examiner's decision."})
    level = "bad" if any(p["level"] == "bad" for p in pts) else "warn" if any(p["level"] == "warn" for p in pts) else "ok"
    if level == "ok":
        flags.add("clean")
    label = {"ok": "No red flags on record", "warn": "Check before you buy", "bad": "Serious red flags"}[level]
    return {"level": level, "label": label, "points": pts, "flags": sorted(flags)}


def _dossier(rec: dict) -> dict:
    x, v, ins = rec["listing"], rec["vehicle"], rec["inspections"]
    odo = _odometer(ins, v)
    reads = [{"date": r["date"], "source": r["source"], **r["obd"]} for r in ins if r["obd"]["read"]]
    obd = {"supported": bool(reads) or v.vtype != "Motorcycle", "latest": reads[-1] if reads else None,
           "history": [{"date": r["date"], "codes": [d["code"] for d in r["dtcs"]], "mil_on": r["mil_on"]} for r in reads],
           "note": None if reads else ("Carburettor model: no diagnostic port, so no OBD read-out."
                                       if v.vtype == "Motorcycle" else "No OBD read-out on record.")}
    claims = [{"date": str(c["claim_date"])[:10], "type": c["claim_type"], "label": CLAIM_LABEL.get(c["claim_type"], c["claim_type"]),
               "amount_rm": float(c["amount_rm"]), "ber_total_loss": bool(c["ber_total_loss"])} for c in rec["claims"]]
    trust = _trust(v, ins, odo, rec["claims"], obd, rec["pending"])
    p = rec["policy"]
    policy = p and {"insurer": p["insurer"], "type": str(p["policy_type"]).replace("_", " "), "sum_insured_rm": _num(p["sum_insured_rm"]),
                    "ncd_pct": _num(p["ncd_pct"]), "flood_cover": bool(p["flood_cover_addon"]), "renewal_due": p["renewal_due"]}
    lib = library.for_vehicle(v.plate)
    lane = [{**im, "date": r["date"]} for r in ins for im in r["images"]]
    scored = [r for r in ins if r["health"] is not None]
    latest_report = next((r["report"] for r in reversed(ins) if r["report"]), None)
    vp = vehicle_public(v)
    for k in ("owner_name", "fleet_id", "vehicle_id"):  # a buyer sees the car, not who owns it
        vp.pop(k, None)
    return {
        "listing": {"listing_id": x.listing_id, "plate": x.plate, "kind": x.kind, "asking_price_rm": x.asking_price_rm,
                    "listed_at": x.listed_at, "seller": x.seller, "state": x.state, "status": x.status,
                    "description": x.description},
        "vehicle": vp,
        "inspections": ins,
        "health": {"latest": scored[-1]["health"] if scored else None, "date": scored[-1]["date"] if scored else None,
                   "model": None if v.vtype == "Motorcycle" else HEALTH_MODEL,
                   "note": "Not scored: the health model was trained on car, van, lorry and bus inspections only."
                   if v.vtype == "Motorcycle" else HEALTH_NOTE, "next_fail": rec["next_fail"]},
        "odometer": odo, "obd": obd, "claims": claims, "insurance": policy,
        "images": {"photo": f"/media/assets/{v.photo}" if v.photo else None, "library": lib, "lane": lane,
                   "count": len(lib) + len(lane) + (1 if v.photo else 0)},
        "report": latest_report, "pending_lane_inspection": rec["pending"], "trust": trust,
        "sources": {"listing": "synthetic", "history": "synthetic", "lane": "live", "health": "live_model",
                    "images": "sample", "claims": "synthetic"},
    }


def _summary(d: dict) -> dict:
    ins, v = d["inspections"], d["vehicle"]
    last = ins[-1] if ins else None
    img = d["images"]
    thumb = img["photo"] or (img["library"][0]["web_url"] if img["library"] else None) or (img["lane"][0]["url"] if img["lane"] else None)
    return {
        **d["listing"], "make": v["make"], "model": v["model"], "vtype": v["vtype"], "year": v["year"], "fuel": v["fuel"],
        "odometer_km": v["odometer_km"], "photo": thumb, "images": img["count"],
        "badges": {"inspections": len(ins), "last_result": last and last["result"], "last_date": last and last["date"],
                   "health": d["health"]["latest"], "next_fail": (d["health"]["next_fail"] or {}).get("p_fail_next"),
                   "odometer_ok": d["odometer"]["consistent"],
                   "rollback_km": max((e["drop_km"] for e in d["odometer"]["rollbacks"]), default=None),
                   "flood_claims": sum(1 for c in d["claims"] if c["type"] == "flood_natural_disaster"),
                   "accident_claims": sum(1 for c in d["claims"] if c["type"].startswith("accident")),
                   "open_obd": [x["code"] for x in (d["obd"]["latest"] or {}).get("dtcs", [])],
                   "report": bool(d["report"])},
        "trust": {k: d["trust"][k] for k in ("level", "label", "flags")},
        "headline": next((p["text"] for p in d["trust"]["points"] if p["level"] == d["trust"]["level"]), ""),
    }


def listings(kind: str | None = None, q: str = "", state: str | None = None, max_price: float | None = None,
             flag: str | None = None) -> dict:
    if flag and flag not in FLAGS:
        raise HTTPException(400, f"flag must be one of {', '.join(FLAGS)}")
    with session_scope() as s:
        rows = s.execute(select(Listing).where(Listing.status == "active").order_by(Listing.listed_at.desc(), Listing.listing_id)).scalars().all()
    every = [_summary(_dossier(r)) for r in _records(list(rows))]
    needle = q.strip().lower()
    out = [r for r in every
           if (not kind or r["kind"] == kind) and (not state or r["state"] == state)
           and (max_price is None or r["asking_price_rm"] <= max_price) and (not flag or flag in r["trust"]["flags"])
           and (not needle or needle in f"{r['plate']} {r['make']} {r['model']} {r['vtype']}".lower())]
    return {
        "listings": out, "total": len(every),
        "counts": {"car": sum(r["kind"] == "car" for r in every), "motorcycle": sum(r["kind"] == "motorcycle" for r in every),
                   "flagged": sum(r["trust"]["level"] == "bad" for r in every),
                   **{f: sum(f in r["trust"]["flags"] for r in every) for f in FLAGS}},
        "states": sorted({r["state"] for r in every if r["state"]}),
        "sources": {"listings": "synthetic marketplace (asking prices, sellers, descriptions)",
                    "records": "synthetic inspection history and claims, plus live lane reports",
                    "health": "live model (" + HEALTH_MODEL + ")"},
    }


def dossier(listing_id: str) -> dict:
    with session_scope() as s:
        x = s.get(Listing, listing_id.upper())
    recs = _records([x]) if x else []
    if not recs:
        raise HTTPException(404, f"listing {listing_id} not found")
    return _dossier(recs[0])

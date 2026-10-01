"""A synthetic, hash-chained report for a past inspection, so the buyer journey (use case UC-09) can verify a report
on a fresh system. It mirrors a record of the synthetic history - the Honda Civic DMO 9003's voluntary inspection of
2 June 2025 at 182,900 km - and every screen that shows it says it is a synthetic record. It is issued again after
a runtime reset (which clears the evidence chain), because the API seeds on every start."""
from __future__ import annotations

import datetime as dt
import secrets

import pandas as pd
from sqlalchemy import select, text

from .. import terms
from ..db import engine, session_scope
from ..tables import Branch, Examiner, Report, Vehicle

SYNTHETIC = [{"inspection_id": "SYN90031", "hist_id": "I90031", "plate": "DMO 9003"}]


def seed_demo_reports() -> int:
    from ..services import evidence

    made = 0
    for spec in SYNTHETIC:
        with session_scope() as s:
            if s.execute(select(Report).where(Report.inspection_id == spec["inspection_id"])).first():
                continue
            v = s.execute(select(Vehicle).where(Vehicle.plate == spec["plate"])).scalar_one_or_none()
            if v is None:
                continue
            veh = {"plate": v.plate, "make": v.make, "model": v.model, "year": v.year, "fuel": v.fuel}
        h = pd.read_sql(text("select * from hist_inspections where inspection_id = :i"), engine(), params={"i": spec["hist_id"]})
        if not len(h):
            continue
        r = h.iloc[0].to_dict()
        with session_scope() as s:
            br, ex = s.get(Branch, r["branch_id"]), s.get(Examiner, r["examiner_id"])
            branch, examiner = (br.name if br else r["branch_id"]), (ex.name if ex else r["examiner_id"])
        kind = terms.label(r["inspection_type"])
        day = str(r["date"])[:10]
        issued = dt.datetime.fromisoformat(day + "T10:30:00")
        verdict = str(r["result"])
        summary = (f"The {veh['make']} {veh['model']} ({veh['plate']}) {'passed' if verdict == 'PASS' else 'did not pass'} its "
                   f"{kind.lower()} on {issued:%d %B %Y}, with the odometer at {int(r['odometer_km']):,} km. "
                   "Synthetic record, seeded for the demo.")
        data = {"vehicle": veh, "verdict": verdict, "verdict_reasons": [], "branch": branch, "lane": None,
                "inspection_type": kind, "examiner": {"id": r["examiner_id"], "name": examiner, "senior": False},
                "health": {}, "next_fail": None, "flood": None, "ev": None, "route": "normal", "findings": [],
                "odometer_km": int(r["odometer_km"]), "measurements": {k: r[k] for k in ("brake_efficiency_pct", "tyre_tread_min_mm")
                                                                         if pd.notna(r.get(k))},
                "issued_at": issued.isoformat() + "+08:00", "synthetic": True,
                "provenance": "synthetic: mirrors a record of the synthetic inspection history"}
        token = secrets.token_urlsafe(9)
        head = evidence.append("report_issued", {"verdict": verdict, "kind": kind, "summary_sha256": evidence.sha256_text(summary),
                                                 "verify_token": token, "examiner": r["examiner_id"], "synthetic": True},
                               spec["inspection_id"], actor="seed")
        with session_scope() as s:
            s.add(Report(inspection_id=spec["inspection_id"], plate=veh["plate"], kind=kind, verdict=verdict, summary=summary,
                         narrative_source="template", verify_token=token, chain_hash=head["hash"], data=data,
                         created_at=issued - dt.timedelta(hours=8)))
        made += 1
    return made

"""The six fleet vehicles among the ten main vehicles (services/showcase.py) came from the showcase fleets, which have
sensor readings but no inspection record. Give each two earlier periodic inspections that agree with its readings and
its sample images, and a road-tax date in the future, so its record reads like a vehicle that comes to the hub every
year. Idempotent: runs on every start and after a runtime reset, and only adds what is missing."""
from __future__ import annotations

import pandas as pd
from sqlalchemy import select, text

from ..db import engine, session_scope
from ..tables import Vehicle, VehicleLocation
from .core import with_lambda

# plate: (road tax until, [(date, branch, result, fail reasons, brake eff %, brake imbalance %, tread mm, corrosion 0-10)])
HISTORY = {
    "VJM 7412": ("2027-03-14", [("2025-03-11", "BR00", "PASS", "", 71.0, 7.0, 6.1, 1.0), ("2025-09-16", "BR00", "PASS", "", 69.0, 8.0, 5.2, 1.5)]),
    "WXD 2291": ("2027-02-02", [("2025-02-05", "BR01", "PASS", "", 66.0, 9.0, 5.8, 1.0), ("2025-08-12", "BR00", "PASS", "", 64.0, 11.0, 3.9, 1.5)]),
    "BHY 7783": ("2026-12-20", [("2024-12-17", "BR00", "PASS", "", 63.0, 10.0, 6.4, 2.5), ("2025-12-16", "BR00", "PASS", "", 61.0, 12.0, 5.1, 3.5)]),
    "VKR 3128": ("2027-01-25", [("2025-01-21", "BR00", "PASS", "", 70.0, 12.0, 6.0, 1.0),
                                ("2025-07-22", "BR00", "FAIL", "brake_imbalance", 64.0, 31.0, 4.4, 2.0),
                                ("2025-07-29", "BR00", "PASS", "", 69.0, 9.0, 4.4, 2.0)]),
    "PKE 4410": ("2027-04-30", [("2025-04-24", "BR02", "PASS", "", 72.0, 6.0, 6.6, 0.5), ("2025-10-23", "BR00", "PASS", "", 71.0, 7.0, 5.7, 0.5)]),
    "JTR 5510": ("2027-06-08", [("2025-06-03", "BR00", "PASS", "", 62.0, 9.0, 6.2, 1.5), ("2025-12-02", "BR00", "PASS", "", 60.0, 14.0, 4.9, 2.0)]),
}


def seed_main_vehicles() -> int:
    with session_scope() as s:
        vs = {v.plate: v for v in s.execute(select(Vehicle).where(Vehicle.plate.in_(list(HISTORY)))).scalars()}
        for plate, (mvl, _) in HISTORY.items():
            if plate in vs and vs[plate].mvl_expiry != mvl:
                vs[plate].mvl_expiry = mvl
            if plate in vs and not vs[plate].state:  # where flood watch placed it (its fleet's home hub)
                loc = s.get(VehicleLocation, vs[plate].vehicle_id)
                vs[plate].state = loc.state if loc else None
        info = {p: (v.vehicle_id, v.odometer_km, v.km_per_month or 3000, v.heavy) for p, v in vs.items()}
    have = {r[0] for r in engine().connect().execute(text("select inspection_id from hist_inspections where inspection_id like 'IM%'"))}
    rows = []
    for plate, (_, visits) in HISTORY.items():
        if plate not in info:
            continue
        vid, odo, per_month, heavy = info[plate]
        for k, (date, branch, result, fails, eff, imb, tread, corr) in enumerate(visits):
            iid = f"IM{vid[2:]}{k}"
            if iid in have:
                continue
            months = (2026 - int(date[:4])) * 12 + (10 - int(date[5:7]))
            rows.append({"inspection_id": iid, "vehicle_id": vid, "date": date, "branch_id": branch, "examiner_id": "VE011",
                         "inspection_type": "periodic_ride_hailing" if plate in ("VKR 3128", "PKE 4410") else
                         "periodic_commercial" if heavy or plate in ("BHY 7783", "JTR 5510", "WXD 2291") else "voluntary",
                         "odometer_km": max(1000, int(odo - months * per_month)), "duration_min": 34.0,
                         "brake_efficiency_pct": eff, "brake_imbalance_pct": imb, "brake_drag_pct": 2.0,
                         "suspension_efficiency_pct": 68.0, "side_slip_m_per_km": 1.2, "headlamp_aim_dev_pct": 0.7,
                         "speedo_error_pct": 3.0, "tint_vlt_front_pct": 70.0, "tyre_tread_min_mm": tread, "tyre_pressure_low": False,
                         "smoke_opacity_pct": 24.0 if plate in ("BHY 7783", "JTR 5510") else None, "pn_per_cm3": None,
                         "co_pct": None if plate == "JTR 5510" else 0.2, "hc_ppm": None if plate == "JTR 5510" else 140.0,
                         "obd_dtcs": "", "obd_mil_on": False, "ev_soh_pct": None, "hv_isolation_mohm": None,
                         "corrosion_score_0_10": corr, "structural_anomaly": False, "fail_reasons": fails, "result": result,
                         "examiner_override_flag": False})
    if rows:
        with_lambda(pd.DataFrame(rows)).to_sql("hist_inspections", engine(), if_exists="append", index=False)
    return len(rows)

"""The scripted demo vehicles (S1, S2, S3, S6) and their prior history."""
from __future__ import annotations

import json

import pandas as pd
from sqlalchemy import delete

from ..config import get_settings
from ..db import engine, session_scope
from ..tables import Setting, Vehicle

SESSION_VEHICLES = {
    "S1": dict(vehicle_id="SV9001", vtype="Prime mover", owner_type="company", owner_name="Alam Megah Haulage",
               chassis_no="YS2P6X20005391140", engine_no="DC13-148-0077215", state="Selangor",
               heavy=True, fleet_id="FLEET07", km_per_month=11800, mvl_expiry="2026-11-02"),
    "S2": dict(vehicle_id="SV9002", vtype="SUV", owner_type="individual", owner_name="Daniel Wong",
               chassis_no="LGXCE4CB6N0028811", engine_no="TZ200XSQ-0331822", state="W.P. Kuala Lumpur",
               heavy=False, fleet_id=None, km_per_month=1300, mvl_expiry="2027-01-15"),
    "S3": dict(vehicle_id="SV9003", vtype="Sedan", owner_type="individual", owner_name="Faizal Omar",
               chassis_no="MRHFC1650GP030117", engine_no="R18Z1-5500321", state="Selangor",
               heavy=False, fleet_id=None, km_per_month=900, mvl_expiry="2026-12-09"),
    "S6": dict(vehicle_id="SV9006", vtype="Hatchback", owner_type="individual", owner_name="Nurul Aina",
               chassis_no="PM2M602S0K1049921", engine_no="1NR-K027788", state="Selangor",
               heavy=False, fleet_id=None, km_per_month=1500, mvl_expiry="2026-10-18"),
}

PRIOR_AUDIO = {
    # The engine sound recorded at DMO 9003's earlier visits (engine fingerprint FP-A).
    "DMO 9003": ["audio/engine_normal_idle/car_engine_sou_00207.wav"],
    # S1 truck: earlier visits recorded a healthy engine; same engine today.
    "DMO 9001": ["audio/engine_normal_idle/car_engine_sou_00047.wav"],
}


def load_session(sid: str) -> dict:
    return json.loads((get_settings().sessions_dir / f"{sid}.json").read_text())


def seed_session_vehicles() -> None:
    hist_rows, claims = [], []
    with session_scope() as s:
        s.execute(delete(Vehicle).where(Vehicle.vehicle_id.like("SV%")))
        for sid, extra in SESSION_VEHICLES.items():
            v = load_session(sid)["vehicle"]
            s.add(Vehicle(plate=v["plate"], make=v["make"], model=v["model"], usage=v["usage"], fuel=v["fuel"],
                          year=v["year"], euro_class=v.get("euro_class", ""), dpf_fitted=v.get("dpf_fitted", False),
                          scr_fitted=v.get("scr_fitted", False), odometer_km=v["odometer_km"],
                          ground_truth={"session": sid}, **extra))
        s.merge(Setting(key="prior_audio", value=PRIOR_AUDIO))

    base = dict(branch_id="BR02", examiner_id="VE012", duration_min=35.0, brake_efficiency_pct=68.0,
                brake_imbalance_pct=6.0, brake_drag_pct=2.0, suspension_efficiency_pct=70.0, side_slip_m_per_km=1.1,
                headlamp_aim_dev_pct=0.6, speedo_error_pct=3.0, tint_vlt_front_pct=70.0, tyre_tread_min_mm=5.2,
                tyre_pressure_low=False, smoke_opacity_pct=None, pn_per_cm3=None, co_pct=0.2, hc_ppm=120.0,
                obd_dtcs="", obd_mil_on=False, ev_soh_pct=None, hv_isolation_mohm=None, corrosion_score_0_10=1.0,
                structural_anomaly=False, fail_reasons="", result="PASS", examiner_override_flag=False)
    s3 = load_session("S3")
    for k, p in enumerate(s3["prior_inspections"]):
        hist_rows.append({**base, "inspection_id": f"I9003{k}", "vehicle_id": "SV9003", "date": p["date"],
                          "inspection_type": p["type"], "odometer_km": p["odometer_km"]})
    s1 = load_session("S1")
    for k, (d, odo) in enumerate([("2024-11-04", 188400), ("2025-11-03", 301900)]):
        hist_rows.append({**base, "inspection_id": f"I9001{k}", "vehicle_id": "SV9001", "date": d, "branch_id": "BR00",
                          "inspection_type": "berkala_B2", "odometer_km": odo, "smoke_opacity_pct": 21.0,
                          "pn_per_cm3": 38000.0, "brake_efficiency_pct": 58.0, "co_pct": None, "hc_ppm": None})
    _ = s1
    s2 = load_session("S2")
    hist_rows.append({**base, "inspection_id": "I90020", "vehicle_id": "SV9002", "date": "2024-08-19", "branch_id": "BR01",
                      "inspection_type": "voluntary", "odometer_km": 31800, "ev_soh_pct": 91.0, "hv_isolation_mohm": 8.5,
                      "co_pct": None, "hc_ppm": None})
    for c in s2.get("prior_claims", []):
        claims.append({"vehicle_id": "SV9002", "claim_date": c["date"], "claim_type": c["type"],
                       "amount_rm": c["amount_rm"], "ber_total_loss": c["ber"]})
    for k, (d, odo) in enumerate([("2024-10-02", 52100), ("2025-10-06", 63900)]):
        hist_rows.append({**base, "inspection_id": f"I9006{k}", "vehicle_id": "SV9006", "date": d, "branch_id": "BR01",
                          "inspection_type": "voluntary", "odometer_km": odo, "tyre_tread_min_mm": 4.8 - k})

    eng = engine()
    pd.DataFrame(hist_rows).to_sql("hist_inspections", eng, if_exists="append", index=False)
    if claims:
        pd.DataFrame(claims).to_sql("hist_claims", eng, if_exists="append", index=False)

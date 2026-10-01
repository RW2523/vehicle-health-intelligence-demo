"""Build lane replay S7: a clean inspection (a well-kept 2019 Perodua Myvi, the owner app's car DMO 9006).

Healthy simulated readings (brakes, suspension, side slip, headlamp, tint, exhaust gas, OBD with no fault codes,
normal hub temperatures, a baseline e-nose trace) and sample media the vision and acoustic models score as normal.
Nothing is injected: the replay shows what the lane and the examiner see when a vehicle has no findings.

    .venv/bin/python data/curated/scripts/gen_s7.py      (from the repository root; deterministic)
"""
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SES = os.path.join(HERE, "..", "sessions")
OUT = os.path.join(SES, "streams", "S7")
rng = np.random.default_rng(2607)

LANE = [("check_in_anpr", 0, 20), ("identity_ocr", 20, 40), ("emission_idle_rev", 40, 130), ("brake_roller", 130, 190),
        ("suspension", 190, 230), ("side_slip", 230, 245), ("headlamp_tint", 245, 280), ("undercarriage_ai", 280, 340),
        ("above_carriage_ai", 340, 380), ("examiner_review", 380, 460), ("report", 460, 480)]


def brake_roller(axles=2, eff=71.0, imb=3.0, drag=1.5):
    out = []
    for a in range(1, axles + 1):
        for side in ("L", "R"):
            k = 1 - (imb / 100 if side == "R" and a == 1 else 0)
            for s in np.arange(0, 12, 0.1):
                force = (eff / 100) * 9.5 * min(1, max(0, (s - 2) / 5)) * k + (drag / 100) * 1.2
                out.append(dict(axle=a, side=side, t_s=round(float(s), 1), brake_force_kn=round(float(force + rng.normal(0, 0.05)), 3)))
    return pd.DataFrame(out)


def obd_stream(seconds=480, idle_rpm=720, rev_at=70):
    t = np.arange(seconds)
    rpm = idle_rpm + rng.normal(0, 12, seconds)
    rpm[rev_at:rev_at + 8] = np.linspace(idle_rpm, 2600, 8)
    coolant = np.where(t % 2 == 1, np.clip(82 + t / 60 + rng.normal(0, 0.4, seconds), 80, 92), np.nan)
    iat = np.where(t % 2 == 1, np.round(29 + rng.normal(0, 0.6, seconds)), np.nan)
    return pd.DataFrame({"t_s": t, "engine_rpm": rpm.round(0), "coolant_temp_c": np.round(coolant, 0),
                         "intake_air_temp_c": iat, "maf_g_s": np.clip(rpm / 250 + rng.normal(0, 0.3, seconds), 1, 60).round(2),
                         "dtcs": "", "mil_on": False})


def enose_baseline(seconds=480, hz=2, humidity=0.8):
    n = seconds * hz
    t = np.arange(n) / hz
    x = rng.normal(0, 0.015, (n, 16)).cumsum(0) * 0.05 + humidity * 0.03
    df = pd.DataFrame(x.round(4), columns=[f"ch{i:02d}" for i in range(16)])
    df.insert(0, "t_s", t)
    return df


def main():
    os.makedirs(OUT, exist_ok=True)
    streams = {
        "brake_roller": brake_roller(),
        "obd": obd_stream(),
        "enose": enose_baseline(),
        "instruments": {"co_pct": 0.2, "hc_ppm": 85, "lambda": 1.0, "suspension_eff_pct": [68, 66],
                        "side_slip_m_per_km": 1.2, "headlamp_dev_pct": 0.6, "tint_vlt_pct": 72},
        "thermal": {"wheel_hub_max_c": {"A1L": 57.4, "A1R": 56.1, "A2L": 49.8, "A2R": 50.6}},
    }
    for k, v in streams.items():
        if isinstance(v, pd.DataFrame):
            v.to_parquet(os.path.join(OUT, f"{k}.parquet"), index=False)
        else:
            with open(os.path.join(OUT, f"{k}.json"), "w") as f:
                json.dump(v, f, indent=1)
    meta = dict(
        session="S7", title="Perodua Myvi · Voluntary Inspection", branch_id="BR00",
        vehicle=dict(plate="DMO 9006", make="Perodua", model="Myvi", year=2019, usage="private", fuel="petrol",
                     odometer_km=74100, axles=2),
        injected_faults=[],
        expected=dict(alerts=0, verdict="PASS", health="normal (70 or more)"),
        media=dict(tyre_images=["images/tyre/perfect/tyre_helath_qualit_00355.jpg", "images/tyre/perfect/tyre_helath_qualit_00324.jpg"],
                   body_images=["images/vehicle_damage/r_normal/car_damage_evaluat_00000.jpg",
                                "images/vehicle_damage/r_normal/car_damage_evaluat_00007.jpg"],
                   audio=["audio/engine_normal_idle/car_engine_sou_00010.wav"]),
        streams=sorted(os.listdir(OUT)),
        lane_timeline=[dict(step=s, start_s=a, end_s=b) for s, a, b in LANE],
    )
    with open(os.path.join(SES, "S7.json"), "w") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()

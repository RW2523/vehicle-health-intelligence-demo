"""Re-time the recorded lane replays S1-S3 into the lane's station order (app/backend/vhi/lane.py).

gen_sessions.py recorded the sessions in the earlier lane order (check-in, identity, emission, brake, suspension, side
slip, headlamps and tint, undercarriage, above-carriage). This moves each recorded stretch of the continuous streams
(OBD at 1 Hz, the e-nose at 2 Hz) to its station's place in the new order, scaled to the new length, and writes the new
``lane_timeline``. The readings themselves are unchanged. Step-relative streams (particle number, brake roller) and the
instruments are placed by the player from the timeline. The speedometer is new: its stretch takes the 20 quiet seconds the
recording had at the start of the examiner's review, and its reading (the speedometer at a true 40 km/h) is added to
instruments.json. S7 is generated directly in the new order by gen_s7.py.

    .venv/bin/python data/curated/scripts/relane_sessions.py      (from the repository root; running it again does nothing)
"""
import json
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SES = os.path.join(HERE, "..", "sessions")
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "app", "backend"))
from vhi.lane import TIMELINE  # noqa: E402

# where each step's stretch sits in the recordings (the earlier order; headlamps and tint split at 262 s)
RECORDED = {
    "check_in_anpr": (0, 20), "identity_ocr": (20, 40), "emission_idle_rev": (40, 130), "brake_roller": (130, 190),
    "suspension": (190, 230), "side_slip": (230, 245), "tinted_glass": (245, 262), "headlight_alignment": (262, 280),
    "undercarriage_ai": (280, 340), "above_carriage_ai": (340, 380), "speedometer": (380, 400),
    "examiner_review": (400, 460), "report": (460, 480),
}
# the speedometer at a true 40 km/h (simulated, like the other instruments; all within 40-48 km/h)
SPEEDO = {"S1": 43, "S2": 41, "S3": 44}


def retime(df: pd.DataFrame) -> pd.DataFrame:
    """Each row moved from its recorded stretch to the same point of its step's new stretch."""
    parts = []
    for step, a, b in TIMELINE:
        ra, rb = RECORDED[step]
        seg = df[(df.t_s >= ra) & (df.t_s < rb)].copy()
        seg["t_s"] = (a + (seg.t_s - ra) * (b - a) / (rb - ra)).round(2)
        parts.append(seg)
    return pd.concat(parts).sort_values("t_s", kind="stable").reset_index(drop=True)


def main():
    new_tl = [dict(step=s, start_s=a, end_s=b) for s, a, b in TIMELINE]
    for sid in ("S1", "S2", "S3"):
        path = os.path.join(SES, f"{sid}.json")
        meta = json.load(open(path))
        if meta["lane_timeline"] == new_tl:
            print(sid, "already in the lane order")
            continue
        sdir = os.path.join(SES, "streams", sid)
        for name in ("obd.parquet", "enose.parquet"):
            p = os.path.join(sdir, name)
            if os.path.exists(p):
                retime(pd.read_parquet(p)).to_parquet(p, index=False)
        ip = os.path.join(sdir, "instruments.json")
        inst = json.load(open(ip))
        inst["speedo_kmh_at_40"] = SPEEDO[sid]
        with open(ip, "w") as f:
            json.dump(inst, f, indent=1)
        meta["lane_timeline"] = new_tl
        with open(path, "w") as f:
            json.dump(meta, f, indent=1, default=str, ensure_ascii=False)
            f.write("\n")
        print(sid, "re-timed")


if __name__ == "__main__":
    main()

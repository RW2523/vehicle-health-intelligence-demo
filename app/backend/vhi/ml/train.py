"""Train every CPU model from data/curated. ``python -m vhi.ml.train [--only enose,acoustic,...]``.

The YOLO11 image classifiers are trained separately with ``python -m vhi.ml.train_vision`` (needs PyTorch).
"""
from __future__ import annotations

import argparse
import json
import logging
import time

import pandas as pd

from ..config import get_settings
from . import acoustic, demand, enose, fusion, soh, vision

log = logging.getLogger("vhi.train")

ARTIFACTS = {
    "enose": ["enose.joblib"],
    "acoustic": ["acoustic.joblib"],
    "soh": ["soh.joblib"],
    "fusion": ["health_lgbm.txt", "nextfail_lgbm.txt", "flood_lgbm.txt", "survival_aft.joblib"],
    "demand": ["demand_lgbm.txt"],
    "corrosion": ["corrosion_calibration.json"],
}


def missing(names=None) -> list[str]:
    out = get_settings().models_dir
    return [k for k, files in ARTIFACTS.items() if (names is None or k in names) and not all((out / f).exists() for f in files)]


def train_one(name: str) -> dict:
    s = get_settings()
    data, out = s.data_dir, s.models_dir
    t = time.time()
    if name == "enose":
        m = enose.train(data, out)
    elif name == "acoustic":
        m = acoustic.train(data, out)
    elif name == "soh":
        m = soh.train(data, out)
    elif name == "fusion":
        ins = pd.read_parquet(data / "synthetic/inspections.parquet")
        veh = pd.read_parquet(data / "synthetic/vehicles.parquet").rename(columns={"odometer_km_now": "odometer_km"})
        claims = pd.read_parquet(data / "synthetic/insurance_claims.parquet")
        m = fusion.train(ins, veh, claims, out)
    elif name == "demand":
        m = demand.train(pd.read_parquet(data / "synthetic/bookings_daily.parquet"), out)
    elif name == "corrosion":
        m = vision.calibrate_corrosion(data, out)
    else:
        raise ValueError(name)
    log.info("trained %s in %.1fs: %s", name, time.time() - t, json.dumps(m)[:300])
    return m


def train_all(names=None, only_missing: bool = False) -> dict:
    todo = missing(names) if only_missing else (names or list(ARTIFACTS))
    return {n: train_one(n) for n in todo}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma list of: " + ",".join(ARTIFACTS))
    ap.add_argument("--missing", action="store_true", help="train only models whose files are absent")
    a = ap.parse_args()
    res = train_all([x for x in a.only.split(",") if x] or None, only_missing=a.missing)
    print(json.dumps(res, indent=1, default=str))

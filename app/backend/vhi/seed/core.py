"""Load the curated synthetic world (data/curated/synthetic) into the database."""
from __future__ import annotations

import json
import logging
import random

import numpy as np
import pandas as pd
from sqlalchemy import delete

from ..config import get_settings
from ..db import engine, session_scope
from ..tables import Branch, Examiner, Fleet, Vehicle

log = logging.getLogger("vhi.seed")

BRANCH_COORDS = {
    "BR00": (3.0400, 101.5480), "BR01": (3.0880, 101.5580), "BR02": (3.2380, 101.6840), "BR03": (3.0850, 101.7440),
    "BR04": (2.9930, 101.7880), "BR05": (3.0440, 101.4480), "BR06": (2.7300, 101.9380), "BR07": (2.1960, 102.2480),
    "BR08": (1.4930, 103.7410), "BR09": (2.0300, 103.3190), "BR10": (4.5970, 101.0900), "BR11": (5.3830, 100.3890),
    "BR12": (6.1200, 100.3680), "BR13": (3.8150, 103.3260), "BR14": (6.1250, 102.2380), "BR15": (5.3300, 103.1370),
    "BR16": (1.5530, 110.3590), "BR17": (4.3990, 113.9910), "BR18": (5.9800, 116.0730), "BR19": (3.1390, 101.6870),
}

FIRST = ["Aiman", "Siti", "Wei Jie", "Kumar", "Nurul", "Hafiz", "Mei Ling", "Arjun", "Farah", "Zul", "Priya", "Chong",
         "Aisyah", "Rizal", "Kavitha", "Jun Hao", "Hakim", "Liyana", "Suresh", "Amirah"]
LAST = ["Rahman", "Ismail", "Tan", "Raj", "Hassan", "Lim", "Abdullah", "Wong", "Yusof", "Pillai", "Ng", "Ahmad",
        "Chandran", "Omar", "Lee", "Aziz"]

VTYPE = {
    "Bezza": "Sedan", "Saga": "Sedan", "City": "Sedan", "Vios": "Sedan", "Persona": "Sedan", "Civic": "Sedan",
    "Mazda3": "Sedan", "Model 3": "Sedan", "Myvi": "Hatchback", "Axia": "Hatchback", "Alza": "MPV", "Serena": "MPV",
    "Innova": "MPV", "Staria": "MPV", "Atto 3": "SUV", "X50": "SUV", "CX-5": "SUV", "Hiace": "Van", "NV350": "Van",
}
HEAVY_TYPE = {"lorry": "Lorry", "bus": "Bus"}

HIST_TABLES = {
    "hist_inspections": "synthetic/inspections.parquet",
    "hist_bookings": "synthetic/bookings_daily.parquet",
    "hist_equipment": "synthetic/lane_equipment_telemetry.parquet",
    "hist_remote_sensing": "synthetic/remote_sensing_roadside.parquet",
    "hist_claims": "synthetic/insurance_claims.parquet",
    "hist_policies": "synthetic/insurance_policies.parquet",
    "hist_fingerprints": "synthetic/acoustic_fingerprints.parquet",
}


def person_name(rng: random.Random) -> str:
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def vtype_for(model: str, usage: str) -> str:
    if usage in HEAVY_TYPE:
        return HEAVY_TYPE[usage]
    if usage == "van":
        return "Van"
    return VTYPE.get(model, "Sedan")


def seed_reference() -> None:
    data = get_settings().data_dir
    rng = random.Random(7)
    br = pd.read_csv(data / "synthetic/branches.csv")
    ex = pd.read_csv(data / "synthetic/examiners.csv")
    with session_scope() as s:
        s.execute(delete(Branch))
        s.execute(delete(Examiner))
        for r in br.itertuples():
            lat, lon = BRANCH_COORDS.get(r.branch_id, (None, None))
            s.add(Branch(branch_id=r.branch_id, name=r.branch, state=r.state, heavy_capable=bool(r.heavy_vehicle_capable),
                         lanes=int(r.lanes), lat=lat, lon=lon))
        for i, r in enumerate(ex.itertuples()):
            s.add(Examiner(examiner_id=r.examiner_id, name=person_name(rng), home_branch=r.home_branch,
                           senior=(i % 9 == 0)))


def seed_vehicles() -> None:
    data = get_settings().data_dir
    v = pd.read_parquet(data / "synthetic/vehicles.parquet")
    rng = random.Random(11)
    gt_cols = [c for c in v.columns if c.startswith("gt_")]
    rows = []
    for r in v.to_dict("records"):
        gt = {c[3:]: (None if pd.isna(r[c]) else (r[c].item() if hasattr(r[c], "item") else r[c])) for c in gt_cols}
        month = rng.randint(1, 12)
        rows.append(dict(
            vehicle_id=r["vehicle_id"], plate=r["plate"], chassis_no=r["chassis_no"], engine_no=r["engine_no"],
            make=r["make"], model=r["model"], vtype=vtype_for(r["model"], r["usage"]), usage=r["usage"], fuel=r["fuel"],
            heavy=bool(r["heavy"]), year=int(r["year"]), state=r["state"], euro_class=r["euro_class"] or "",
            dpf_fitted=bool(r["dpf_fitted"]), scr_fitted=bool(r["scr_fitted"]), odometer_km=int(r["odometer_km_now"]),
            fleet_id=r["fleet_id"], owner_type=r["owner_type"],
            owner_name=person_name(rng) if r["owner_type"] == "individual" else "",
            km_per_month=int(max(600, min(14000, r["odometer_km_now"] / max(1, (2026 - r["year"]) * 12)))),
            mvl_expiry=f"{2026 if month >= 10 else 2027}-{month:02d}-{rng.randint(1, 28):02d}",
            ground_truth=json.loads(json.dumps(gt, default=str)),
        ))
    with session_scope() as s:
        s.execute(delete(Vehicle))
        s.bulk_insert_mappings(Vehicle, rows)
    log.info("vehicles: %d", len(rows))


def seed_history() -> None:
    data = get_settings().data_dir
    eng = engine()
    for table, rel in HIST_TABLES.items():
        df = pd.read_parquet(data / rel)
        for c in df.columns:
            if df[c].dtype == object:
                df[c] = df[c].where(df[c].notna(), None)
        # stay under PostgreSQL's 65,535 bind-parameter limit per statement
        df.to_sql(table, eng, if_exists="replace", index=False, chunksize=max(100, 60000 // max(1, len(df.columns))),
                  method="multi")
        log.info("%s: %d rows", table, len(df))


FLEET_NAMES = ["Borneo", "Cahaya", "Delima", "Emas", "Gemilang", "Harapan", "Intan", "Jaya", "Kenanga", "Lestari",
               "Mawar", "Nusa", "Perdana", "Rimba", "Sentosa", "Teratai", "Utama", "Wawasan", "Zamrud", "Bayu"]
FLEET_KIND = {"lorry": "Haulage", "bus": "Coach Lines", "van": "Logistics", "ehailing": "Ride", "taxi": "Cabs",
              "private": "Corporate Cars"}


def seed_data_fleets() -> None:
    """Name the 40 fleets that exist in the synthetic data and give each a home branch."""
    data = get_settings().data_dir
    v = pd.read_parquet(data / "synthetic/vehicles.parquet")
    ins = pd.read_parquet(data / "synthetic/inspections.parquet", columns=["vehicle_id", "branch_id"])
    fv = v[v.fleet_id.notna()]
    home = fv.merge(ins, on="vehicle_id").groupby("fleet_id").branch_id.agg(lambda s: s.mode().iat[0])
    usage = fv.groupby("fleet_id").usage.agg(lambda s: s.mode().iat[0])
    rng = np.random.default_rng(3)
    with session_scope() as s:
        s.execute(delete(Fleet))  # showcase fleets are re-created by seed_showcase_fleets
        for i, fid in enumerate(sorted(fv.fleet_id.unique())):
            name = f"{FLEET_NAMES[i % len(FLEET_NAMES)]} {FLEET_KIND.get(usage[fid], 'Fleet')}"
            if fid == "FLEET07":
                name = "Alam Megah Haulage"
            s.add(Fleet(fleet_id=fid, name=name, branch_id=home.get(fid, "BR00"), segment=usage[fid],
                        api_key="fk_" + "".join(rng.choice(list("abcdef0123456789"), 20))))

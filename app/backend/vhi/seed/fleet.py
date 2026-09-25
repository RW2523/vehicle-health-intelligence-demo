"""Showcase fleets for the Fleet Intelligence portal, plus 12 months of condition readings.

* Five fictional operators (165 vehicles), including the 12 flagged vehicles from the approved design, with
  their photo evidence from the sample captures.
* FLEET07 (the S5 haulier from the curated data, 43 trucks), anchored to its real synthetic inspections.

Only the *readings* and the context *events* (workshop visits, telematics impacts ...) are seeded. Everything the
portal shows about them - anomalies, patterns, time to failure, risk - is computed live by
``vhi.ml.degradation`` when a page asks for it.
"""
from __future__ import annotations

import datetime as dt
import random

import numpy as np
import pandas as pd
from sqlalchemy import delete, select

from ..config import get_settings
from ..db import session_scope
from ..fleet_metrics import METRICS, base_metrics
from ..tables import Fleet, FleetReading, Vehicle

MONTHS = [(2025, 10), (2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]
N = len(MONTHS)


def month_key(i: int) -> str:
    y, m = MONTHS[i]
    return f"{y}-{m:02d}"


def month_date(i: int) -> str:
    y, m = MONTHS[i]
    return dt.date(y, m, 20).isoformat()


OPERATORS = [
    dict(fleet_id="OP-SMR", name="Sinar Metro Ride", branch_id="BR03", segment="ehailing",
         comp={"Sedan": 36, "Hatchback": 12}),
    dict(fleet_id="OP-TJR", name="Tanjung Rentals", branch_id="BR01", segment="rental",
         comp={"Sedan": 16, "MPV": 22, "Hatchback": 3}),
    dict(fleet_id="OP-LPC", name="Lembah Parcel Co.", branch_id="BR05", segment="van",
         comp={"Van": 34, "Pickup": 4}),
    dict(fleet_id="OP-KAS", name="Kinabalu Agri Supply", branch_id="BR18", segment="pickup",
         comp={"Pickup": 22}),
    dict(fleet_id="OP-SCT", name="Seri Care Transport", branch_id="BR11", segment="mpv",
         comp={"MPV": 16}),
]

MODELS = {
    "Sedan": [("Toyota", "Vios"), ("Perodua", "Bezza"), ("Honda", "City"), ("Proton", "Saga")],
    "Hatchback": [("Perodua", "Myvi"), ("Perodua", "Axia"), ("Honda", "Jazz")],
    "MPV": [("Perodua", "Alza"), ("Toyota", "Innova"), ("Toyota", "Avanza"), ("Nissan", "Serena")],
    "Van": [("Toyota", "Hiace"), ("Nissan", "NV350 Urvan"), ("Foton", "View")],
    "Pickup": [("Toyota", "Hilux"), ("Ford", "Ranger"), ("Isuzu", "D-Max"), ("Nissan", "Navara")],
}

# The 12 flagged vehicles from the approved design. Values are monthly readings Oct 2025 .. Sep 2026.
# `events` are recorded context (workshop visits, telematics, AI vision notes) - not detections.
HEROES = [
    dict(plate="VKR 3128", make="Toyota", model="Vios 1.5", vtype="Sedan", op=0, photo="c07o.jpg", evidence=["n1a.jpg", "c07a.jpg"],
         metric="brake_imbalance", v=[8, 8.5, 9, 9.8, 10.5, 11.2, 12, 13, 17, 19.5, 23, 26.8],
         events={8: "Front pad change at a non-panel workshop"}, year=2021, odo=186400, kmpm=5200),
    dict(plate="WXD 2291", make="Ford", model="Ranger XLT", vtype="Pickup", op=3, photo="c03o.jpg", evidence=["n8_2.jpg", "c03a.jpg", "c09a.jpg"],
         metric="tread_depth", v=[7.4, 7.1, 6.8, 6.5, 6.2, 5.9, 5.3, 4.7, 4.1, 3.5, 2.9, 2.3],
         events={6: "Pothole impact logged by telematics (3.1 g, front right)", 11: "AI vision: sidewall bulge seen at lane check"},
         photos={1: "n8_0.jpg", 6: "n8_1.jpg", 11: "n8_2.jpg"}, year=2020, odo=142900, kmpm=3900),
    dict(plate="BHY 7783", make="Toyota", model="Hiace 2.8D", vtype="Van", op=2, photo="c08o.jpg", evidence=["n2a.jpg", "c08a.jpg"],
         metric="hc_idle", v=[180, 195, 205, 220, 590, 240, 255, 275, 300, 350, 410, 480],
         events={4: "Cylinder-3 misfire code logged; spark plugs changed next day"}, year=2019, odo=231700, kmpm=6100, fuel="petrol"),
    dict(plate="VCC 8841", make="Perodua", model="Alza 1.5", vtype="MPV", op=1, photo="c02o.jpg", evidence=["c02a.jpg"],
         metric="headlamp_output", v=[100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78], events={}, year=2022, odo=98300, kmpm=3100),
    dict(plate="JTR 5510", make="Nissan", model="NV350 Urvan", vtype="Van", op=2, photo="c04o.jpg", evidence=["n3a.jpg", "c04a.jpg"],
         metric="damping", v=[78, 77, 75, 74, 72, 70, 68, 62, 58, 54, 50, 46],
         events={7: "Load cell logged 1.4x rated payload"}, year=2020, odo=205200, kmpm=5600, fuel="diesel"),
    dict(plate="BMK 6620", make="Isuzu", model="D-Max 1.9", vtype="Pickup", op=3, photo="c09o.jpg", evidence=["c09a.jpg", "c13a.jpg"],
         metric="oil_loss", v=[20, 22, 25, 28, 32, 36, 42, 50, 60, 75, 125, 170],
         events={10: "Underbody camera: fresh wet trail at the sump"}, year=2019, odo=176800, kmpm=4300, fuel="diesel"),
    dict(plate="VJM 3287", make="Perodua", model="Bezza 1.3", vtype="Sedan", op=1, photo="c16o.jpg", evidence=["n7_2.jpg", "c16a.jpg"],
         metric="rust_area", v=[2, 2.3, 3.2, 4.1, 5, 5.6, 6.3, 7.2, 8.2, 9.4, 10.8, 12.4],
         events={2: "Parked through flood-season rains (Nov-Jan)"}, photos={3: "n7_0.jpg", 7: "n7_1.jpg", 11: "n7_2.jpg"},
         year=2018, odo=164500, kmpm=3300),
    dict(plate="PKE 4410", make="Toyota", model="Innova 2.0", vtype="MPV", op=4, photo="c12o.jpg", evidence=["n4a.jpg", "c12a.jpg"],
         metric="adas_yaw", v=[0.2, 0.22, 0.21, 0.55, 0.5, 0.53, 0.58, 0.55, 0.6, 0.63, 0.59, 0.66],
         events={3: "Windscreen replaced; no ADAS recalibration on record"}, year=2021, odo=121600, kmpm=4800),
    dict(plate="BPR 7730", make="Toyota", model="Vios 1.5", vtype="Sedan", op=0, photo="c01o.jpg", evidence=["n9_2.jpg", "c01a.jpg"],
         metric="crack_length", v=[0, 0, 0, 0, 0, 12, 20, 31, 44, 58, 76, 96],
         events={5: "Stone chip first seen by AI vision"}, photos={5: "n9_0.jpg", 8: "n9_1.jpg", 11: "n9_2.jpg"},
         year=2022, odo=133900, kmpm=5400),
    dict(plate="VJM 7412", make="Perodua", model="Bezza 1.0", vtype="Sedan", op=1, photo="c15o.jpg", evidence=["n5a.jpg", "c15a.jpg"],
         metric="cranking_v", v=[10.9, 10.9, 10.85, 10.8, 10.8, 10.75, 10.7, 10.6, 10.5, 10.4, 10.3, 10.15], events={},
         year=2021, odo=88200, kmpm=2900),
    dict(plate="WQK 9054", make="Toyota", model="Hiace 2.5D", vtype="Van", op=2, photo="c06o.jpg", evidence=["c06a.jpg"],
         metric="vibration", v=[1.8, 1.9, 2, 2.1, 2.3, 2.4, 2.6, 2.9, 3.2, 3.6, 4.1, 4.6], events={},
         year=2018, odo=262300, kmpm=5900, fuel="diesel"),
    dict(plate="WVA 1209", make="Perodua", model="Myvi 1.5", vtype="Hatchback", op=0, photo="c10o.jpg", evidence=["n6a.jpg", "c10a.jpg"],
         metric="pad_thickness", v=[10, 9.6, 9.2, 8.8, 8.4, 8, 7.6, 7.2, 6.8, 6.4, 6.0, 5.6], events={},
         year=2023, odo=74100, kmpm=4700),
]

# start range, monthly change range (sign = direction), noise sd, physical clip
GEN = {
    "brake_imbalance": ((3, 10), (0.2, 0.55), 0.5, (0, 70)),
    "tread_depth": ((5.8, 8.4), (-0.28, -0.12), 0.07, (0.5, 9)),
    "damping": ((66, 86), (-0.8, -0.25), 0.9, (5, 95)),
    "hc_idle": ((90, 220), (2, 8), 10, (20, 3000)),
    "smoke_opacity": ((8, 24), (0.25, 0.9), 1.1, (0, 100)),
    "headlamp_output": ((88, 100), (-1.0, -0.35), 0.7, (10, 105)),
    "cranking_v": ((10.6, 11.2), (-0.055, -0.015), 0.035, (7, 12.6)),
    "cranking_v24": ((21.8, 22.8), (-0.12, -0.04), 0.07, (15, 25.2)),
    "vibration": ((1.2, 2.4), (0.04, 0.14), 0.08, (0.2, 20)),
}
# Periodic replacement: (threshold that triggers it, value after, note)
RESET = {
    "tread_depth": (2.3, lambda r: r.uniform(7.6, 8.4), "Tyres replaced"),
    "cranking_v": (9.95, lambda r: r.uniform(11.0, 11.3), "12 V battery replaced"),
    "cranking_v24": (19.9, lambda r: r.uniform(22.4, 22.9), "24 V batteries replaced"),
    "brake_imbalance": (24, lambda r: r.uniform(3, 7), "Brakes serviced"),
}


def gen_series(metric: str, rng: random.Random, km_factor: float, pattern: str | None):
    (s0, s1), (d0, d1), sd, (lo, hi) = GEN[metric]
    v = rng.uniform(s0, s1)
    rate = rng.uniform(d0, d1) * km_factor
    change_at = rng.randint(5, 9)
    vals, notes = [], {}
    for i in range(N):
        r = rate
        if pattern == "accelerating" and i >= change_at:
            r = rate * rng.uniform(2.3, 3.2)
        v = v + (r if i else 0)
        x = v + rng.gauss(0, sd)
        if pattern == "step" and i == change_at:
            v += (1 if d0 > 0 else -1) * sd * rng.uniform(6, 9)
            x = v
        if pattern == "spike" and i == change_at:
            x = x + (1 if d0 > 0 else -1) * sd * rng.uniform(10, 14)
        if metric in RESET and i < N - 1:
            thr, after, note = RESET[metric]
            breach = (x <= thr) if d0 < 0 else (x >= thr)
            if breach and pattern is None:
                v = after(rng)
                x = v
                notes[i] = note
        vals.append(float(np.clip(x, lo, hi)))
    return [round(x, 2 if abs(x) < 30 else 1) for x in vals], notes


def seed_showcase_fleets() -> None:
    rng = random.Random(2026)
    readings: list[dict] = []
    with session_scope() as s:
        ids = [v for (v,) in s.execute(select(Vehicle.vehicle_id).where(Vehicle.vehicle_id.like("FV%")))]
        s.execute(delete(FleetReading))
        s.execute(delete(Vehicle).where(Vehicle.vehicle_id.in_(ids)))
        s.execute(delete(Fleet).where(Fleet.showcase.is_(True)))
        s.flush()
        for op in OPERATORS:
            s.add(Fleet(fleet_id=op["fleet_id"], name=op["name"], branch_id=op["branch_id"], segment=op["segment"],
                        api_key="fk_" + "".join(rng.choice("abcdef0123456789") for _ in range(20)), showcase=True))
        n = 0
        plate_no = 6100
        for oi, op in enumerate(OPERATORS):
            heroes = [h for h in HEROES if h["op"] == oi]
            for vtype, count in op["comp"].items():
                hs = [h for h in heroes if h["vtype"] == vtype]
                for k in range(count):
                    n += 1
                    vid = f"FV{n:04d}"
                    hero = hs[k] if k < len(hs) else None
                    if hero:
                        make, model, plate = hero["make"], hero["model"], hero["plate"]
                        fuel = hero.get("fuel", "petrol")
                        year, odo, kmpm = hero["year"], hero["odo"], hero["kmpm"]
                        photo = "captures/" + hero["photo"]
                    else:
                        make, model = rng.choice(MODELS[vtype])
                        plate_no += rng.randint(3, 40)
                        plate = f"DMO {plate_no}"
                        fuel = "diesel" if vtype in ("Van", "Pickup") and rng.random() < 0.6 else "petrol"
                        year = rng.randint(2016, 2024)
                        kmpm = rng.randint(2200, 6400)
                        odo = kmpm * 12 * (2026 - year) + rng.randint(0, 9000)
                        photo = None
                    s.add(Vehicle(vehicle_id=vid, plate=plate, chassis_no=f"PM{rng.getrandbits(52):013X}"[:17],
                                  engine_no=f"EN{rng.getrandbits(40):010X}", make=make, model=model, vtype=vtype,
                                  usage=op["segment"], fuel=fuel, heavy=False, year=year, state="",
                                  odometer_km=odo, fleet_id=op["fleet_id"], owner_type="company", photo=photo,
                                  km_per_month=kmpm,
                                  mvl_expiry=f"{2026 if k % 4 == 0 else 2027}-{(k * 5) % 12 + 1:02d}-{(k * 7) % 27 + 1:02d}",
                                  ground_truth={"hero": bool(hero), "evidence": hero["evidence"] if hero else []}))
                    readings += vehicle_readings(vid, fuel, False, kmpm, rng, hero)
        s.bulk_insert_mappings(FleetReading, readings)
    seed_fleet07_readings()


def vehicle_readings(vid: str, fuel: str, heavy: bool, kmpm: int, rng: random.Random, hero: dict | None = None,
                     anchor: dict[str, float] | None = None) -> list[dict]:
    out = []
    km_factor = max(0.5, min(1.8, kmpm / 4000))
    if hero is not None:
        km_factor = 0.35  # a hero's other subsystems stay healthy so its designed issue is the one that shows
    metrics = base_metrics(fuel, heavy)
    injected = None
    if hero is None and rng.random() < 0.09:
        injected = (rng.choice(metrics), rng.choice(["accelerating", "step", "spike"]))
    for m in metrics + ([hero["metric"]] if hero and hero["metric"] not in metrics else []):
        if hero and m == hero["metric"]:
            vals, notes = hero["v"], dict(hero.get("events", {}))
            photos = hero.get("photos", {})
        else:
            pattern = injected[1] if injected and injected[0] == m else None
            vals, notes = gen_series(m, rng, km_factor, pattern)
            photos = {}
            if anchor and m in anchor and anchor[m] is not None and not np.isnan(anchor[m]):
                # wear from a healthy start to the value measured at the truck's latest real inspection
                (s0, s1), _, sd, (lo, hi) = GEN[m]
                start = rng.uniform(s0, s1)
                end = float(np.clip(anchor[m], lo, hi))
                vals = [round(float(np.clip(start + (end - start) * (i / (N - 1)) + (rng.gauss(0, sd) if 0 < i < N - 1 else 0), lo, hi)), 2)
                        for i in range(N)]
                notes = {}
        for i, val in enumerate(vals):
            src = "lane_check" if i in (0, 6, 11) else ("telematics" if m in ("cranking_v", "cranking_v24", "vibration") else "fleet_check")
            out.append(dict(vehicle_id=vid, metric=m, month=month_key(i), date=month_date(i), value=float(val),
                            source=src, photo=("captures/" + photos[i]) if i in photos else None, note=notes.get(i, "")))
    return out


def seed_fleet07_readings() -> None:
    """Readings for the 43 FLEET07 trucks, anchored to each truck's latest synthetic inspection."""
    data = get_settings().data_dir
    ins = pd.read_parquet(data / "synthetic/inspections.parquet")
    rng = random.Random(707)
    rows = []
    with session_scope() as s:
        trucks = s.execute(select(Vehicle).where(Vehicle.fleet_id == "FLEET07")).scalars().all()
        s.execute(select(Fleet).where(Fleet.fleet_id == "FLEET07")).scalar_one().showcase = True
        for v in trucks:
            last = ins[ins.vehicle_id == v.vehicle_id].sort_values("date").tail(1)
            anchor = {}
            if len(last):
                r = last.iloc[0]
                anchor = {"brake_imbalance": r.brake_imbalance_pct, "tread_depth": r.tyre_tread_min_mm,
                          "damping": r.suspension_efficiency_pct, "smoke_opacity": r.smoke_opacity_pct}
            rows += vehicle_readings(v.vehicle_id, v.fuel, v.heavy, v.km_per_month, rng, None, anchor)
        s.bulk_insert_mappings(FleetReading, rows)
    _ = METRICS  # keep import explicit for readers: every metric key above is defined in METRICS

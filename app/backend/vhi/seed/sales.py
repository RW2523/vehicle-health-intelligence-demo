"""The used-vehicle sales listings (owner app "Sale" tab, Oversight > Used-vehicle sales) and the records behind them.

* 15 fictional motorcycles (the synthetic world has none), plates DMO 95xx: Malaysian commuter and sport models with
  1-4 inspections each (B5 ownership transfers and voluntary checks) measuring what a motorcycle lane measures: brake
  efficiency, headlamp aim, tyre tread, CO/HC of the 4-stroke petrol engine, the odometer, and an OBD read-out on
  fuel-injected models. Five carry a designed red flag (rollback, flood claim, failed last inspection, open fault
  code, accident claim).
* Three ex-fleet cars with inspection photos in the image library (VJM 3287, WVA 1209, VCC 8841) get an inspection
  on each of their fleet lane-check dates, with the values those checks measured.
* 40 car listings: DMO 9003 (S3) and DMO 9002 (S2), the three ex-fleet cars, and cars from the synthetic world with at
  least two inspections on record, picked so that some have an odometer rollback, a flood claim or a failed last
  inspection and the rest do not.

Asking prices, sellers and descriptions are synthetic; everything is deterministic (seeded RNG). The step fills only
when the listings table is empty, so it also runs on a world that was seeded before it existed.
"""
from __future__ import annotations

import datetime as dt
import logging
import random

import pandas as pd
from sqlalchemy import delete, func, select, text

from ..config import get_settings
from ..db import engine, session_scope
from ..tables import Branch, Examiner, Fleet, Listing, Vehicle
from .core import person_name

log = logging.getLogger("vhi.seed")

CAR_TYPES = ("Sedan", "Hatchback", "MPV", "SUV", "Pickup", "Van")
PICK = {"rollback": 5, "flood": 6, "failed": 6, "clean": 18}
FEATURED = {  # the S3 Civic is sold with a rolled-back odometer; the S2 EV has a flood claim
    "DMO 9003": ("private", 2, "Honda Civic 1.8, low mileage, one careful owner."),
    "DMO 9002": ("private", 9, "BYD Atto 3, battery still strong, home charger included."),
}
EX_FLEET = ["VJM 3287", "WVA 1209", "VCC 8841"]

# make, model, fuel-injected (so it has a diagnostic port), new price RM, year, state, km a year, inspections, story
BIKES = [
    ("Yamaha", "Y15ZR", True, 8998, 2019, "Selangor", 9800, 3, None),
    ("Honda", "RS150R", True, 8999, 2018, "W.P. Kuala Lumpur", 11500, 4, "rollback"),
    ("Honda", "Wave 125i", True, 6099, 2020, "Johor", 8200, 2, None),
    ("Modenas", "Kriss 110", False, 4200, 2016, "Kelantan", 6800, 3, "flood"),
    ("Yamaha", "NVX 155", True, 10368, 2021, "Pulau Pinang", 7400, 2, "obd"),
    ("Kawasaki", "Ninja 250", True, 22900, 2019, "Selangor", 4300, 3, None),
    ("Honda", "EX5", False, 4995, 2015, "Perak", 9100, 4, "failed"),
    ("Yamaha", "LC135", True, 6900, 2017, "Kedah", 10200, 3, "accident"),
    ("Honda", "Vario 160", True, 8999, 2023, "W.P. Kuala Lumpur", 9300, 1, None),
    ("Honda", "ADV 160", True, 12699, 2023, "Selangor", 6900, 1, None),
    ("Yamaha", "YZF-R15", True, 11998, 2020, "Melaka", 5600, 2, None),
    ("Modenas", "Kriss 110", False, 4200, 2021, "Terengganu", 6100, 2, None),
    ("SYM", "VF3i 185", True, 9098, 2020, "Sabah", 8000, 2, None),
    ("Yamaha", "Y15ZR", True, 8998, 2022, "Sarawak", 12600, 2, None),
    ("Kawasaki", "Z250", True, 20900, 2018, "Negeri Sembilan", 3900, 4, None),
]

NEW_RM = {"Bezza": 42000, "Saga": 38000, "Persona": 50000, "City": 88000, "Vios": 92000, "Alza": 72000, "Myvi": 56000,
          "Axia": 34000, "Serena": 150000, "Innova": 145000, "Atto 3": 150000, "X50": 95000, "Civic": 135000,
          "Hilux": 125000, "Corolla Cross Hybrid": 145000, "Almera": 88000, "CX-5": 165000, "e.MAS 7": 115000}
BIKE_RM = {(b[0], b[1]): b[3] for b in BIKES}
TYPE_RM = {"Sedan": 70000, "Hatchback": 45000, "MPV": 95000, "SUV": 120000, "Pickup": 120000, "Van": 110000}

CAR_TEXT = {
    "private": ["One owner, serviced on time. Selling because I am upgrading.",
                "Daily car, never missed a service. Viewing in {state}.",
                "Owner-driven and well kept. Happy to do a B5 inspection at PUSPAKOM before the sale."],
    "dealer": ["Dealer unit. Bank loan up to 90%, one-year warranty.", "Trade-in welcome. Full loan for eligible buyers.",
               "Checked in our workshop and ready to drive away."],
    "ehailing": "Ex e-hailing unit, fully serviced before sale.",
    "taxi": "Ex-taxi, new tyres fitted.",
    "rollback": "Genuine mileage, owner-driven.",
}
BIKE_TEXT = ["Original parts, never modified. Road tax until {mvl}.", "Daily commuter, serviced every 3,000 km.",
             "Kept indoors, new chain and sprocket.", "All papers ready for the B5 transfer.",
             "Weekend rides only, well looked after."]
BIKE_STORY_TEXT = {"rollback": "Genuine low mileage, rarely used.", "flood": "Runs well, just serviced."}

INSURERS = ["Insurer A", "Insurer B", "Insurer C", "Insurer D", "Insurer E"]


def today() -> dt.date:
    return dt.date.fromisoformat(get_settings().demo_today)


def seed_sales() -> bool:
    """Returns True if the listings were (re)built."""
    with session_scope() as s:
        if s.execute(select(func.count()).select_from(Listing)).scalar():
            # a full re-seed replaces the vehicles and the history but not this table: rebuild when the bikes are gone
            if s.execute(select(func.count()).select_from(Vehicle).where(Vehicle.vtype == "Motorcycle")).scalar():
                return False
            s.execute(delete(Listing))
    rng = random.Random(2609)
    _clear()
    bikes = seed_motorcycles(rng)
    seed_ex_fleet_history(rng)
    n = seed_listings(rng, bikes)
    log.info("sales: %d listings (%d motorcycles)", n, len(bikes))
    return True


def _clear() -> None:
    with engine().begin() as c:
        c.execute(text("delete from hist_inspections where inspection_id like 'IS%'"))
        for t in ("hist_claims", "hist_policies"):
            c.execute(text(f"delete from {t} where vehicle_id like 'MC%'"))
    with session_scope() as s:
        s.execute(delete(Vehicle).where(Vehicle.vtype == "Motorcycle"))


def _staff(s) -> tuple[dict[str, str], dict[str, list[str]]]:
    """First branch of each state, and the examiners based at each branch."""
    branch_of: dict[str, str] = {}
    for b in s.execute(select(Branch).order_by(Branch.branch_id)).scalars():
        branch_of.setdefault(b.state, b.branch_id)
    staff: dict[str, list[str]] = {}
    for e in s.execute(select(Examiner).order_by(Examiner.examiner_id)).scalars():
        staff.setdefault(e.home_branch, []).append(e.examiner_id)
    return branch_of, staff


def _dates(rng: random.Random, year: int, n: int) -> list[dt.date]:
    end = dt.date(2026, 9, 18) - dt.timedelta(days=rng.randint(3, 160))
    start = max(dt.date(year + 1, 2, 1), dt.date(2021, 3, 1)) + dt.timedelta(days=rng.randint(0, 240))
    if n == 1 or start >= end:
        out = [end]
    else:
        step = (end - start).days / (n - 1)
        out = [start + dt.timedelta(days=round(i * step + (rng.uniform(-0.15, 0.15) * step if 0 < i < n - 1 else 0)))
               for i in range(n)]
    return [d + dt.timedelta(days=1) if d.weekday() == 6 else d for d in out]  # lanes are closed on Sundays


def _bike_measure(rng: random.Random, fi: bool) -> dict:
    """A passing motorcycle inspection: the car-only checks (suspension, side slip, tint ...) stay empty."""
    return dict(duration_min=round(rng.uniform(14, 24), 1), brake_efficiency_pct=round(rng.uniform(54, 74), 1),
                headlamp_aim_dev_pct=round(rng.uniform(0.1, 1.9), 2), speedo_error_pct=round(rng.uniform(1, 7), 1),
                tyre_tread_min_mm=round(rng.uniform(1.9, 4.2), 1), tyre_pressure_low=rng.random() < 0.1,
                co_pct=round(rng.uniform(0.4, 2.4 if fi else 3.4), 2), hc_ppm=float(rng.randint(160, 700 if fi else 1400)),
                corrosion_score_0_10=round(rng.uniform(0.3, 2.2), 1), structural_anomaly=False,
                obd_dtcs="" if fi else None, obd_mil_on=False, fail_reasons="", result="PASS", examiner_override_flag=False)


def seed_motorcycles(rng: random.Random) -> list[str]:
    ins, claims, policies = [], [], []
    plates = []
    with session_scope() as s:
        taken = {p for (p,) in s.execute(select(Vehicle.plate))}
        branch_of, staff = _staff(s)
        no = 9500
        for i, (make, model, fi, new_rm, year, state, kmpy, n, story) in enumerate(BIKES):
            vid = f"MC{i + 1:04d}"
            no += rng.randint(3, 29)
            while f"DMO {no}" in taken:
                no += 1
            plate = f"DMO {no}"
            born, per_day = dt.date(year, 3, 1), kmpy * rng.uniform(0.92, 1.08) / 365.25
            dates = _dates(rng, year, n)
            branch = branch_of.get(state, "BR01")
            rows = []
            for k, d in enumerate(dates):
                itype = "B5_MV15" if (k == len(dates) - 1 or rng.random() < 0.5) else "voluntary"
                rows.append({"inspection_id": f"ISM{i + 1:02d}{k}", "vehicle_id": vid, "date": d.isoformat(),
                             "branch_id": branch, "examiner_id": rng.choice(staff.get(branch) or ["VE012"]),
                             "inspection_type": itype, "odometer_km": int(per_day * (d - born).days), **_bike_measure(rng, fi)})
            true_km = advertised = int(per_day * (dt.date(2026, 9, 20) - born).days)
            truth: dict = {"synthetic": "vhi.seed.sales", "story": story}
            last = rows[-1]
            if story == "rollback":  # the meter was wound back before the last visit, and again before the advert
                last["odometer_km"] = int(rows[-2]["odometer_km"] * 0.56)
                advertised = last["odometer_km"] + rng.randint(900, 2500)
                truth["odometer_rollback_km"] = true_km - advertised
            elif story == "failed":
                last.update(tyre_tread_min_mm=1.1, headlamp_aim_dev_pct=3.1, fail_reasons="tyre;headlamp", result="FAIL")
            elif story == "obd":
                last.update(obd_dtcs="P0122", obd_mil_on=True)
            elif story == "flood":
                a, b = dt.date.fromisoformat(rows[-2]["date"]), dt.date.fromisoformat(last["date"])
                claims.append({"vehicle_id": vid, "claim_date": (a + (b - a) / 2).isoformat(),
                               "claim_type": "flood_natural_disaster", "amount_rm": 1860.0, "ber_total_loss": False})
                last.update(corrosion_score_0_10=5.4)
            elif story == "accident":
                a, b = dt.date.fromisoformat(rows[0]["date"]), dt.date.fromisoformat(rows[1]["date"])
                claims.append({"vehicle_id": vid, "claim_date": (a + (b - a) / 3).isoformat(),
                               "claim_type": "accident_own_damage", "amount_rm": 2350.0, "ber_total_loss": False})
            ins += rows
            big = new_rm > 15000
            policies.append({"vehicle_id": vid, "insurer": rng.choice(INSURERS),
                             "policy_type": "comprehensive" if big or rng.random() < 0.3 else "third_party",
                             "sum_insured_rm": float(round(new_rm * 0.8 ** (2026 - year), -2)),
                             "ncd_pct": 0.0 if story in ("flood", "accident") else rng.choice([25.0, 30.0, 38.33, 45.0, 55.0]),
                             "flood_cover_addon": story == "flood",
                             "renewal_due": (today() + dt.timedelta(days=rng.randint(20, 340))).isoformat()})
            s.add(Vehicle(vehicle_id=vid, plate=plate, chassis_no=f"PM{make[0]}{rng.getrandbits(56):014X}",
                          engine_no=f"E{rng.getrandbits(36):09X}", make=make, model=model, vtype="Motorcycle",
                          usage="private", fuel="petrol", heavy=False, year=year, state=state, odometer_km=advertised,
                          owner_type="individual", owner_name=person_name(rng), km_per_month=kmpy // 12,
                          mvl_expiry=(today() + dt.timedelta(days=rng.randint(15, 330))).isoformat(), ground_truth=truth))
            taken.add(plate)
            plates.append(plate)
    eng = engine()
    pd.DataFrame(ins).to_sql("hist_inspections", eng, if_exists="append", index=False)
    pd.DataFrame(claims).to_sql("hist_claims", eng, if_exists="append", index=False)
    pd.DataFrame(policies).to_sql("hist_policies", eng, if_exists="append", index=False)
    return plates


def seed_ex_fleet_history(rng: random.Random) -> None:
    """A lane inspection on each fleet lane-check date of the three ex-fleet cars, with the values measured then."""
    rows = []
    with session_scope() as s:
        _, staff = _staff(s)
        for k, plate in enumerate(EX_FLEET):
            v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
            f = s.get(Fleet, v.fleet_id) if v and v.fleet_id else None
            if v is None or f is None:
                continue
            checks = pd.read_sql(text("select metric, date, value from fleet_readings where vehicle_id = :v and "
                                      "source = 'lane_check' order by date"), engine(), params={"v": v.vehicle_id})
            for j, (date, g) in enumerate(checks.groupby("date")):
                got = dict(zip(g.metric, g.value))
                months_ago = (today() - dt.date.fromisoformat(date)).days / 30.44
                m = dict(duration_min=round(rng.uniform(32, 44), 1), brake_efficiency_pct=round(rng.uniform(58, 72), 1),
                         brake_imbalance_pct=got.get("brake_imbalance"), brake_drag_pct=round(rng.uniform(1, 4), 1),
                         suspension_efficiency_pct=got.get("damping"), side_slip_m_per_km=round(rng.uniform(0.3, 2.5), 2),
                         headlamp_aim_dev_pct=round(rng.uniform(0.2, 1.4), 2), speedo_error_pct=round(rng.uniform(1, 5), 1),
                         tint_vlt_front_pct=round(rng.uniform(62, 72), 1), tyre_tread_min_mm=got.get("tread_depth"),
                         tyre_pressure_low=False, co_pct=round(rng.uniform(0.1, 0.5), 2), hc_ppm=got.get("hc_idle"),
                         obd_dtcs="", obd_mil_on=False, corrosion_score_0_10=round(min(9.5, 1 + got.get("rust_area", 0) / 3), 1),
                         structural_anomaly=False, examiner_override_flag=False)
                reasons = [r for r, bad in (("tyre", (m["tyre_tread_min_mm"] or 9) < 1.6),
                                            ("brake_imbalance", (m["brake_imbalance_pct"] or 0) > 30),
                                            ("corrosion_structural", m["corrosion_score_0_10"] > 7.5)) if bad]
                rows.append({"inspection_id": f"ISF{k}{j}", "vehicle_id": v.vehicle_id, "date": date, "branch_id": f.branch_id,
                             "examiner_id": rng.choice(staff.get(f.branch_id) or ["VE012"]),
                             "inspection_type": "berkala_ehailing" if v.usage == "ehailing" else "voluntary",
                             "odometer_km": int(v.odometer_km - v.km_per_month * months_ago), **m,
                             "fail_reasons": ";".join(reasons), "result": "FAIL" if reasons else "PASS"})
    if rows:
        pd.DataFrame(rows).to_sql("hist_inspections", engine(), if_exists="append", index=False)


def _pick_cars(rng: random.Random) -> list[tuple[str, str]]:
    """Cars from the synthetic world with at least two inspections: some with each kind of red flag, the rest clean."""
    eng = engine()
    ins = pd.read_sql(text("select vehicle_id, date, odometer_km, result from hist_inspections where vehicle_id like 'V%'"),
                      eng).sort_values(["vehicle_id", "date"])
    veh = pd.read_sql(text("select vehicle_id, vtype, fleet_id from vehicles where vehicle_id like 'V%'"), eng)
    claims = pd.read_sql(text("select vehicle_id, claim_type from hist_claims"), eng)
    n = ins.groupby("vehicle_id").size()
    pool = set(veh[veh.vtype.isin(CAR_TYPES) & veh.fleet_id.isna()].vehicle_id) & set(n[n >= 2].index)
    drop = ins.groupby("vehicle_id").odometer_km.diff() < -1000
    last = ins.groupby("vehicle_id").tail(1)
    groups = {"rollback": set(ins[drop].vehicle_id),
              "flood": set(claims[claims.claim_type == "flood_natural_disaster"].vehicle_id),
              "failed": set(last[last.result == "FAIL"].vehicle_id)}
    groups["clean"] = pool - set().union(*groups.values())
    chosen: list[tuple[str, str]] = []
    for key, k in PICK.items():
        cand = sorted((groups[key] & pool) - {i for i, _ in chosen})
        chosen += [(i, key) for i in rng.sample(cand, min(k, len(cand)))]
    return chosen


def asking_price(new_rm: float, year: int, km: int, kind: str, rng: random.Random) -> float:
    age = max(0, 2026 - year)
    v = new_rm * (0.88 if kind == "car" else 0.9) ** age
    typical = (18000 if kind == "car" else 8000) * max(age, 0.5)
    v *= max(0.72, min(1.08, 1 - 0.25 * (km - typical) / typical))  # above-average mileage lowers the price
    v = max(v * rng.uniform(0.95, 1.07), new_rm * 0.12)
    step = 500 if kind == "car" else 100
    return float(round(v / step) * step)


def _advert(v: Vehicle, how: str, rng: random.Random, fleet: Fleet | None, states: dict[str, str]) -> tuple[str, int, str, str]:
    """Seller, days on sale, description and state of one advert."""
    days, state = rng.randint(1, 80), v.state
    if how == "featured":
        seller, days, desc = FEATURED[v.plate]
    elif how == "ex_fleet":
        seller, state = "dealer", (states.get(fleet.branch_id, "") if fleet else "")
        desc = f"Ex-{fleet.name if fleet else 'fleet'} unit, serviced to schedule. Sold through our dealership."
    elif v.vtype == "Motorcycle":
        seller = "private" if rng.random() < 0.75 else "dealer"
        desc = BIKE_STORY_TEXT.get((v.ground_truth or {}).get("story")) or rng.choice(BIKE_TEXT).format(mvl=v.mvl_expiry)
    elif how == "rollback":
        seller, desc = "private", CAR_TEXT["rollback"]
    else:
        seller = "private" if rng.random() < 0.6 else "dealer"
        desc = rng.choice(CAR_TEXT[seller]).format(state=v.state)
        if seller == "dealer" and v.usage in ("ehailing", "taxi"):
            desc = CAR_TEXT[v.usage]
    return seller, days, desc, state


def seed_listings(rng: random.Random, bikes: list[str]) -> int:
    picked = _pick_cars(rng)
    rows = []
    with session_scope() as s:
        states = {b.branch_id: b.state for b in s.execute(select(Branch)).scalars()}
        fleets = {f.fleet_id: f for f in s.execute(select(Fleet)).scalars()}
        named = {v.plate: v for v in s.execute(select(Vehicle).where(Vehicle.plate.in_([*FEATURED, *EX_FLEET, *bikes]))).scalars()}
        cars = {v.vehicle_id: v for v in s.execute(select(Vehicle).where(Vehicle.vehicle_id.in_([i for i, _ in picked]))).scalars()}
        todo = ([(named.get(p), "featured") for p in FEATURED] + [(named.get(p), "ex_fleet") for p in EX_FLEET]
                + [(cars.get(i), group) for i, group in picked] + [(named.get(p), "bike") for p in bikes])
        for v, how in todo:
            if v is None:
                continue
            kind = "motorcycle" if v.vtype == "Motorcycle" else "car"
            seller, days, desc, state = _advert(v, how, rng, fleets.get(v.fleet_id or ""), states)
            new_rm = BIKE_RM.get((v.make, v.model), 6000) if kind == "motorcycle" else NEW_RM.get(
                v.model, next((p for m, p in NEW_RM.items() if v.model.startswith(m)), TYPE_RM.get(v.vtype, 70000)))
            rows.append(Listing(listing_id=f"LS{len(rows) + 1:04d}", plate=v.plate, kind=kind,
                                asking_price_rm=asking_price(new_rm, v.year, v.odometer_km, kind, rng),
                                listed_at=(today() - dt.timedelta(days=days)).isoformat(), seller=seller, state=state,
                                status="active", description=desc))
        s.add_all(rows)
    return len(rows)

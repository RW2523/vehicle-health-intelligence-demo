"""Synthetic data generator for the PUSPAKOM Vehicle Health Intelligence demo.

Everything here is FICTIONAL (plates, owners, examiners, vehicles) but calibrated to real public data:
  * state + vehicle-category mix  <- JPJ 2025 registrations (data.gov.my via tasadapullo-svg repo, 1.63M rows)
  * failure rate vs age, defect-group mix <- UK DVSA MOT 2024 (ivitskiy/uk-mot-risk-index-dataset)
  * e-nose signatures             <- UCI Gas Sensor Array Drift class centroids (curated/sensors)
  * EV battery SOH fade           <- NASA PCoE B0005/6/7/18 capacity curves (curated/sensors)
  * OBD PID ranges                <- real Seat Leon OBD-II logs (curated/sensors)
  * audio clips referenced        <- curated/audio (real recordings)
Hidden ground-truth flags let the demo show that the AI finds what was injected.
"""
import os, json, math, random, hashlib, datetime as dt
import numpy as np, pandas as pd

rng = np.random.default_rng(7); random.seed(7)
BASE = "/home/claude/dl"
CUR = f"{BASE}/curated"
OUT = f"{CUR}/synthetic"
os.makedirs(OUT, exist_ok=True)
TODAY = dt.date(2026, 9, 24)
N_VEH = 5000

# ---------------- calibration inputs ----------------
jpj = pd.read_parquet(f"{BASE}/raw/malaysia/tasadapullo-svg__Malaysia-7Cities-Traffic-Master-Dataset-2025/04_population_vehicle/raw_vehicles_2025_selected.parquet")
jpj = jpj[~jpj.state.isin(["Rakan Niaga"])]  # dealer-channel pseudo-state
state_w = jpj.state.value_counts(normalize=True)
cat_w = jpj.category.value_counts(normalize=True)
mot_def = pd.read_csv(f"{BASE}/raw/inspection_history/ivitskiy__uk-mot-risk-index-dataset/motriskindex-defect-groups-2024-v2.csv")
defect_mix = (mot_def.groupby("defect_group")["national_failure_items_per_100_tests"].first().sort_values(ascending=False))
defect_mix = (defect_mix / defect_mix.sum()).round(4)

# Branches: ILLUSTRATIVE list (official list loads via JS on puspakom.com.my/branches; replace before demo)
BRANCHES = [
    ("Alam Megah", "Selangor", True, 8), ("Glenmarie", "Selangor", False, 6), ("Batu Caves", "Selangor", False, 5),
    ("Cheras", "W.P. Kuala Lumpur", False, 4), ("Kajang", "Selangor", False, 4), ("Klang", "Selangor", True, 5),
    ("Seremban", "Negeri Sembilan", True, 4), ("Melaka", "Melaka", False, 3), ("Johor Bahru", "Johor", True, 6),
    ("Kluang", "Johor", False, 3), ("Ipoh", "Perak", True, 4), ("Prai", "Pulau Pinang", True, 5),
    ("Alor Setar", "Kedah", False, 3), ("Kuantan", "Pahang", True, 4), ("Kota Bharu", "Kelantan", False, 3),
    ("Kuala Terengganu", "Terengganu", False, 3), ("Kuching", "Sarawak", True, 4), ("Miri", "Sarawak", True, 3),
    ("Kota Kinabalu", "Sabah", True, 4), ("Mobile Truck Service", "Nationwide", True, 2)]
bdf = pd.DataFrame(BRANCHES, columns=["branch", "state", "heavy_vehicle_capable", "lanes"])
bdf["branch_id"] = [f"BR{i:02d}" for i in range(len(bdf))]
bdf["note"] = "illustrative branch list - replace with official PUSPAKOM list"
bdf.to_csv(f"{OUT}/branches.csv", index=False)

# Flood exposure by state (qualitative, from recurring monsoon flood history: 2021 Klang Valley, 2022/2024 east coast)
FLOOD_RISK = {"Kelantan": .16, "Terengganu": .14, "Pahang": .12, "Johor": .08, "Selangor": .07, "W.P. Kuala Lumpur": .05,
              "Perak": .05, "Kedah": .04, "Sabah": .04, "Sarawak": .05, "Negeri Sembilan": .03, "Melaka": .04,
              "Pulau Pinang": .03, "Perlis": .03, "W.P. Putrajaya": .01, "W.P. Labuan": .02}
FLOOD_EVENTS = [dt.date(2021, 12, 18), dt.date(2022, 12, 20), dt.date(2023, 12, 5), dt.date(2024, 11, 28), dt.date(2025, 12, 10)]

MODELS = {  # usage -> [(make, model, fuel, weight)]
    "private": [("Perodua", "Myvi", "petrol", 18), ("Perodua", "Axia", "petrol", 12), ("Perodua", "Bezza", "petrol", 9),
                ("Proton", "Saga", "petrol", 10), ("Proton", "X50", "petrol", 6), ("Proton", "Persona", "petrol", 5),
                ("Honda", "City", "petrol", 8), ("Honda", "Civic", "petrol", 4), ("Toyota", "Vios", "petrol", 6),
                ("Toyota", "Hilux", "diesel", 4), ("Nissan", "Almera", "petrol", 3), ("Mazda", "CX-5", "petrol", 2),
                ("Toyota", "Corolla Cross Hybrid", "hybrid", 2), ("BYD", "Atto 3", "ev", 3), ("Tesla", "Model Y", "ev", 1.5),
                ("Proton", "e.MAS 7", "ev", 1.5), ("Perodua", "QV-E", "ev", 1)],
    "ehailing": [("Perodua", "Bezza", "petrol", 20), ("Proton", "Saga", "petrol", 15), ("Perodua", "Alza", "petrol", 12),
                 ("Toyota", "Vios", "petrol", 10), ("Honda", "City", "petrol", 10), ("BYD", "Atto 3", "ev", 4)],
    "taxi": [("Proton", "Persona", "petrol", 10), ("Toyota", "Innova", "petrol", 6), ("Nissan", "Serena", "petrol", 4)],
    "van": [("Toyota", "Hiace", "diesel", 10), ("Nissan", "NV350", "diesel", 6), ("Hyundai", "Staria", "diesel", 3)],
    "lorry": [("Isuzu", "NPR", "diesel", 12), ("Hino", "300 Series", "diesel", 10), ("Mitsubishi Fuso", "Canter", "diesel", 8),
              ("Hino", "500 Series", "diesel", 6), ("Scania", "P-Series Prime Mover", "diesel", 4), ("Volvo", "FH Prime Mover", "diesel", 3)],
    "bus": [("Scania", "K-Series", "diesel", 6), ("Hino", "RK8J", "diesel", 5), ("Volvo", "B8R", "diesel", 3), ("BYD", "K9 e-bus", "ev", 1)],
}
USAGE_W = {"private": .52, "ehailing": .13, "taxi": .03, "van": .07, "lorry": .19, "bus": .06}
ANNUAL_KM = {"private": 16000, "ehailing": 48000, "taxi": 60000, "van": 40000, "lorry": 85000, "bus": 95000}
INSPECT_EVERY_M = {"ehailing": 12, "taxi": 6, "van": 6, "lorry": 6, "bus": 6}

def euro_class(fuel, year, heavy):
    if fuel in ("ev",): return "EV"
    if fuel == "diesel":
        return "Euro 5" if year >= (2022 if heavy else 2015) else ("Euro 3" if year >= 2008 else "Euro 2")
    return "Euro 4" if year >= 2014 else "Euro 2/3"

def plate(i):  # fictional plates: 'DMO' prefix reserved for demo, never real
    return f"DMO {1000 + i}"

vehicles = []
states = rng.choice(state_w.index, N_VEH, p=state_w.values)
usages = rng.choice(list(USAGE_W), N_VEH, p=list(USAGE_W.values()))
for i in range(N_VEH):
    u = usages[i]
    opts = MODELS[u]; w = np.array([o[3] for o in opts], float)
    make, model, fuel, _ = opts[rng.choice(len(opts), p=w / w.sum())]
    heavy = u in ("lorry", "bus")
    max_age = 25 if heavy else (10 if u == "ehailing" else 20)
    age = min(max_age, rng.gamma(2.2, 3.3 if not heavy else 4.2)) if fuel != "ev" else min(6, rng.gamma(1.6, 1.3))
    year = int(TODAY.year - age)
    km = int(max(500, (TODAY.year - year + rng.random()) * ANNUAL_KM[u] * rng.lognormal(0, .25)))
    st = states[i]
    flood = rng.random() < FLOOD_RISK.get(st, .04) * (1.4 if year < 2022 else 0.8)
    v = dict(vehicle_id=f"V{i:05d}", plate=plate(i), chassis_no=hashlib.md5(f"ch{i}".encode()).hexdigest()[:17].upper(),
             engine_no=f"EN{hashlib.md5(f'en{i}'.encode()).hexdigest()[:10].upper()}", make=make, model=model, usage=u,
             fuel=fuel, heavy=heavy, year=year, age_years=TODAY.year - year, state=st, euro_class=euro_class(fuel, year, heavy),
             dpf_fitted=(fuel == "diesel" and euro_class(fuel, year, heavy) == "Euro 5"), scr_fitted=(fuel == "diesel" and heavy and year >= 2022),
             odometer_km_now=km, fleet_id=(f"FLEET{rng.integers(1, 41):02d}" if heavy or u == "van" else None),
             owner_type=("company" if heavy or u == "van" else "individual"),
             # hidden ground truth (what the AI should discover)
             gt_flood_damaged=bool(flood), gt_flood_event=(str(random.choice([e for e in FLOOD_EVENTS if e.year >= year] or FLOOD_EVENTS[-1:])) if flood else None),
             gt_dpf_tampered=bool(fuel == "diesel" and rng.random() < .07), gt_scr_fault=bool(fuel == "diesel" and heavy and rng.random() < .10),
             gt_odometer_rollback_km=int(rng.integers(40000, 120000)) if (rng.random() < .012 and km > 90000) else 0,
             gt_engine_swapped=bool(rng.random() < .006), gt_structural_repair=bool(rng.random() < .04 + .02 * flood),
             gt_ev_soh_pct=(round(float(np.clip(100 - (TODAY.year - year) * rng.normal(2.6, .7) - (6 if flood else 0), 55, 100)), 1) if fuel == "ev" else None),
             acoustic_fingerprint_seed=int(rng.integers(1e9)))
    vehicles.append(v)
veh = pd.DataFrame(vehicles)

# ---------------- insurance policies & claims ----------------
insurers = [f"Insurer {c}" for c in "ABCDEFGH"]
pol, claims = [], []
for v in vehicles:
    sum_ins = {"private": 55000, "ehailing": 50000, "taxi": 45000, "van": 90000, "lorry": 220000, "bus": 450000}[v["usage"]] * math.exp(-0.08 * v["age_years"])
    ncd = random.choice([0, 25, 30, 38.33, 45, 55, 55, 55])
    pol.append(dict(vehicle_id=v["vehicle_id"], insurer=random.choice(insurers), policy_type=random.choice(["comprehensive"] * 4 + ["third_party"]),
                    sum_insured_rm=round(sum_ins, -2), ncd_pct=ncd, flood_cover_addon=bool(random.random() < .35),
                    renewal_due=str(TODAY + dt.timedelta(days=int(rng.integers(1, 365))))))
    lam = 0.08 + 0.012 * v["age_years"] + (0.15 if v["usage"] in ("ehailing", "taxi", "lorry") else 0)
    for _ in range(rng.poisson(lam * 3)):
        d = TODAY - dt.timedelta(days=int(rng.integers(1, 3 * 365)))
        typ = random.choices(["accident_own_damage", "third_party_property", "windscreen", "theft"], [60, 20, 17, 3])[0]
        amt = {"accident_own_damage": rng.lognormal(8.4, .8), "third_party_property": rng.lognormal(8.0, .7), "windscreen": rng.lognormal(6.6, .3), "theft": sum_ins}[typ]
        claims.append(dict(vehicle_id=v["vehicle_id"], claim_date=str(d), claim_type=typ, amount_rm=round(float(amt), 2), ber_total_loss=bool(typ != "windscreen" and amt > .6 * sum_ins)))
    if v["gt_flood_damaged"]:
        amt = rng.uniform(.25, .95) * sum_ins
        claims.append(dict(vehicle_id=v["vehicle_id"], claim_date=v["gt_flood_event"], claim_type="flood_natural_disaster", amount_rm=round(float(amt), 2),
                           ber_total_loss=bool(amt > .6 * sum_ins)))
pol = pd.DataFrame(pol); cl = pd.DataFrame(claims)
veh["gt_ber_rebuilt"] = veh.vehicle_id.isin(cl[cl.ber_total_loss].vehicle_id)
for v, b in zip(vehicles, veh["gt_ber_rebuilt"]): v["gt_ber_rebuilt"] = bool(b)

# ---------------- inspection history (3 years) ----------------
EXAMINERS = [f"VE{n:03d}" for n in range(1, 81)]
CORRUPT = {"VE017": "BR00", "VE044": "BR05"}  # integrity storyline: pass-rate inflation on heavy vehicles
branch_of_state = bdf.groupby("state").branch_id.apply(list).to_dict()
heavy_br = bdf[bdf.heavy_vehicle_capable].branch_id.tolist()

def pick_branch(v):
    c = branch_of_state.get(v["state"], [])
    if v["heavy"]:
        c = [b for b in c if b in heavy_br] or ["BR00", "BR19"]
    return random.choice(c or ["BR00", "BR01", "BR02"])

def measure(v, when, prev_km):
    age = (when.year - v["year"]) + when.timetuple().tm_yday / 365
    deg = 1 - math.exp(-age / 14)
    heavy = v["heavy"]
    m = {}
    m["brake_efficiency_pct"] = round(float(np.clip(rng.normal(68 - 18 * deg, 7), 25, 90)), 1)
    m["brake_imbalance_pct"] = round(float(np.clip(rng.gamma(2, 2.5 + 6 * deg), 0, 60)), 1)
    m["brake_drag_pct"] = round(float(np.clip(rng.gamma(1.5, 1.5 + 3 * deg), 0, 40)), 1)
    m["suspension_efficiency_pct"] = round(float(np.clip(rng.normal(70 - 20 * deg, 8), 15, 95)), 1)
    m["side_slip_m_per_km"] = round(float(rng.normal(0, 1.8 + 2.8 * deg)), 2)
    m["headlamp_aim_dev_pct"] = round(float(abs(rng.normal(0, 0.7 + 1.0 * deg))), 2)
    m["speedo_error_pct"] = round(float(rng.normal(3, 3)), 1)
    m["tint_vlt_front_pct"] = round(float(np.clip(rng.normal(68, 9), 15, 90)), 1)
    m["tyre_tread_min_mm"] = round(float(np.clip(rng.normal(5.2 - 2.2 * deg, 1.2), 0.4, 9)), 1)
    m["tyre_pressure_low"] = bool(rng.random() < .02 + .04 * deg)
    if v["fuel"] == "diesel":
        m["smoke_opacity_pct"] = round(float(np.clip(rng.gamma(2, 4 + 11 * deg) + (6 if v["gt_dpf_tampered"] else 0), 0, 99)), 1)
        base_pn = 5e3 if v["dpf_fitted"] else 4e5
        m["pn_per_cm3"] = int(base_pn * rng.lognormal(0, .6) * (80 if (v["dpf_fitted"] and v["gt_dpf_tampered"]) else 1))
        m["co_pct"] = None; m["hc_ppm"] = None
    elif v["fuel"] in ("petrol", "hybrid"):
        m["smoke_opacity_pct"] = None; m["pn_per_cm3"] = None
        m["co_pct"] = round(float(np.clip(rng.gamma(1.5, .15 + .6 * deg), 0, 6)), 2)
        m["hc_ppm"] = int(np.clip(rng.gamma(2, 40 + 200 * deg), 5, 3000))
    else:
        m.update(smoke_opacity_pct=None, pn_per_cm3=None, co_pct=None, hc_ppm=None)
    dtcs = []
    if v["gt_scr_fault"]: dtcs += random.sample(["P20EE", "P2BAD", "P20BA", "P207F"], 2)
    if v["gt_dpf_tampered"] and v["dpf_fitted"]: dtcs += ["P2002"]
    if v["gt_flood_damaged"] and rng.random() < .35: dtcs += random.sample(["U0100", "B1318", "P0562", "C1201"], 1)
    if rng.random() < .04 + .1 * deg: dtcs += random.sample(["P0300", "P0171", "P0420", "P0128", "P0442"], 1)
    m["obd_dtcs"] = ",".join(sorted(set(dtcs)))
    m["obd_mil_on"] = bool(dtcs)
    if v["fuel"] == "ev":
        years_before_now = (TODAY - when).days / 365
        m["ev_soh_pct"] = round(min(100, v["gt_ev_soh_pct"] + 2.6 * years_before_now + rng.normal(0, .6)), 1)
        m["hv_isolation_mohm"] = round(float(rng.lognormal(math.log(40 if not v["gt_flood_damaged"] else 3), .5)), 2)
    else:
        m["ev_soh_pct"] = None; m["hv_isolation_mohm"] = None
    m["corrosion_score_0_10"] = round(float(np.clip(rng.normal(1 + 4 * deg + (3 if v["gt_flood_damaged"] else 0), 1.2), 0, 10)), 1)
    m["structural_anomaly"] = bool(v["gt_structural_repair"] and rng.random() < .7)
    return m

def fails(v, m):
    r = []
    if m["brake_efficiency_pct"] < (45 if v["heavy"] else 50): r.append("brake_efficiency")
    if m["brake_imbalance_pct"] > 30: r.append("brake_imbalance")
    if m["brake_drag_pct"] > 10 and v["heavy"]: r.append("brake_drag")
    if m["suspension_efficiency_pct"] < 40: r.append("suspension")
    if abs(m["side_slip_m_per_km"]) > 7: r.append("side_slip")
    if m["headlamp_aim_dev_pct"] > 2.5: r.append("headlamp")
    if m["tint_vlt_front_pct"] < 50: r.append("tint_vlt")
    if m["tyre_tread_min_mm"] < 1.6 or m["tyre_pressure_low"]: r.append("tyre")
    if m["smoke_opacity_pct"] is not None and m["smoke_opacity_pct"] > 50: r.append("smoke_opacity")
    if m["co_pct"] is not None and (m["co_pct"] > 3.5 or m["hc_ppm"] > 1200): r.append("petrol_emission")
    if m["corrosion_score_0_10"] > 7.5: r.append("corrosion_structural")
    if m["structural_anomaly"]: r.append("structural")
    return r

insp = []
iid = 0
for v in vehicles:
    events = []
    start = max(dt.date(2023, 10, 1), dt.date(v["year"], 6, 1))
    if v["usage"] in INSPECT_EVERY_M:
        d = start + dt.timedelta(days=int(rng.integers(0, 150)))
        while d <= TODAY:
            events.append((d, "berkala_ehailing" if v["usage"] == "ehailing" else "berkala_B2")); d += dt.timedelta(days=int(INSPECT_EVERY_M[v["usage"]] * 30.4))
    else:
        if rng.random() < .35: events.append((TODAY - dt.timedelta(days=int(rng.integers(30, 1000))), random.choice(["B5_MV15", "B5_MV15", "B7_hire_purchase", "voluntary"])))
        if rng.random() < .10: events.append((TODAY - dt.timedelta(days=int(rng.integers(30, 1000))), "B5_MV15"))
        if v["gt_ber_rebuilt"]: events.append((TODAY - dt.timedelta(days=int(rng.integers(30, 500))), "khas_B2_85_ber"))
    events.sort()
    km_now = v["odometer_km_now"] + v["gt_odometer_rollback_km"]  # true km
    for j, (d, typ) in enumerate(events):
        true_km = int(km_now - (TODAY - d).days / 365 * ANNUAL_KM[v["usage"]])
        shown_km = true_km - (v["gt_odometer_rollback_km"] if (v["gt_odometer_rollback_km"] and j == len(events) - 1 and j > 0) else 0)
        m = measure(v, d, None)
        br = pick_branch(v); ex = random.choice(EXAMINERS)
        if v["heavy"] and random.random() < .12:  # route some heavy vehicles through the two outlier examiners
            ex = random.choice(list(CORRUPT)); br = CORRUPT[ex]
        fr = fails(v, m)
        result = "FAIL" if fr else "PASS"
        if ex in CORRUPT and fr and random.random() < .8: result = "PASS"
        iid += 1
        insp.append(dict(inspection_id=f"I{iid:07d}", vehicle_id=v["vehicle_id"], date=str(d), branch_id=br, examiner_id=ex,
                         inspection_type=typ, odometer_km=max(0, shown_km), duration_min=round(float(np.clip(rng.normal(34, 7), 18, 75)), 1),
                         **m, fail_reasons=";".join(fr), result=result, examiner_override_flag=bool(ex in CORRUPT and fr and result == "PASS")))
ins = pd.DataFrame(insp)

# ---------------- engine acoustic fingerprints (embedding per visit) ----------------
fp = []
for v in vehicles:
    base = np.random.default_rng(v["acoustic_fingerprint_seed"]).normal(0, 1, 32)
    vis = ins[ins.vehicle_id == v["vehicle_id"]].sort_values("date")
    for k, (_, r) in enumerate(vis.iterrows()):
        e = base + rng.normal(0, .15, 32)
        if v["gt_engine_swapped"] and k == len(vis) - 1 and k > 0:
            e = rng.normal(0, 1, 32)
        fp.append(dict(inspection_id=r.inspection_id, vehicle_id=v["vehicle_id"], **{f"e{i:02d}": round(float(x), 4) for i, x in enumerate(e)}))
fpdf = pd.DataFrame(fp)

# ---------------- bookings / demand (for forecasting) ----------------
days = pd.date_range("2024-01-01", "2026-12-31", freq="D")
FESTIVE = pd.to_datetime(["2024-04-10", "2024-04-11", "2025-03-31", "2025-04-01", "2026-03-20", "2026-03-21", "2024-02-10", "2025-01-29", "2026-02-17"])
bk = []
for _, b in bdf.iterrows():
    base = b.lanes * 38
    for d in days:
        if d.date() > TODAY: continue
        dow = [1.0, 1.05, 1.0, 1.02, 1.12, .55 if d.year >= 2026 else 0, 0][d.dayofweek]
        f = .25 if d in FESTIVE else 1
        me = 1.15 if d.day >= 24 else 1
        trend = 1 + .06 * (d.year - 2024)
        demand = rng.poisson(max(0, base * dow * f * me * trend))
        cap = int(b.lanes * 42 * (1 if dow > 0 else 0))
        bk.append(dict(date=d.date(), branch_id=b.branch_id, demand_requests=int(demand), capacity_slots=cap,
                       booked=int(min(demand, cap)), unmet=int(max(0, demand - cap)), gear_premium_booked=int(min(80, demand * .08)) if d.date() >= dt.date(2026, 7, 15) else 0,
                       no_show=int(rng.binomial(min(demand, cap), .06)) if cap else 0))
bkdf = pd.DataFrame(bk)

# ---------------- lane equipment telemetry (predictive maintenance) ----------------
eq = []
for _, b in bdf.head(6).iterrows():
    for lane in range(1, int(b.lanes) + 1):
        for dev in ["roller_brake_tester", "suspension_tester", "gas_analyser", "opacity_meter", "air_compressor"]:
            drift = (dev == "roller_brake_tester" and b.branch_id == "BR00" and lane == 3)
            for k, d in enumerate(pd.date_range("2026-06-01", str(TODAY), freq="D")):
                vib = rng.normal(1.0, .08) + (0.012 * k if drift and k > 60 else 0)
                eq.append(dict(date=d.date(), branch_id=b.branch_id, lane=lane, device=dev, vibration_rms_g=round(float(vib), 3),
                               temp_c=round(float(rng.normal(41, 3) + (0.05 * k if drift and k > 60 else 0)), 1),
                               calibration_offset_pct=round(float(rng.normal(0, .4) + (0.02 * k if drift and k > 60 else 0)), 2),
                               gt_failing=drift and k > 60))
eqdf = pd.DataFrame(eq)

# ---------------- roadside remote-sensing screening (DOE/JPJ view) ----------------
rs = []
sites = [("Federal Highway Shah Alam", 3.0738, 101.5183), ("Jalan Klang Lama", 3.0980, 101.6780), ("NKVE Bukit Raja", 3.0880, 101.4600),
         ("Jalan Tun Razak", 3.1590, 101.7180), ("Pasir Gudang Hwy", 1.4760, 103.8930)]
passes = veh.sample(3000, replace=True, random_state=3)
for _, v in passes.iterrows():
    s = random.choice(sites)
    hi = v.gt_dpf_tampered or v.gt_scr_fault
    rs.append(dict(timestamp=str(dt.datetime(2026, 9, 1) + dt.timedelta(minutes=int(rng.integers(0, 33000)))), site=s[0], lat=s[1], lon=s[2], plate=v.plate,
                   speed_kmh=round(float(rng.normal(62, 12)), 1), co_pct=round(float(rng.gamma(1.2, .1)), 3), hc_ppm=int(rng.gamma(2, 30)),
                   no_ppm=int(rng.gamma(2, 150) * (4 if hi else 1)) if v.fuel == "diesel" else int(rng.gamma(2, 60)),
                   pm_uv_smoke=round(float(rng.gamma(2, .05) * (6 if v.gt_dpf_tampered else 1)), 3), high_emitter_flag=bool(hi and rng.random() < .8)))
rsdf = pd.DataFrame(rs)

# ---------------- save ----------------
veh.to_parquet(f"{OUT}/vehicles.parquet", index=False)
pol.to_parquet(f"{OUT}/insurance_policies.parquet", index=False)
cl.to_parquet(f"{OUT}/insurance_claims.parquet", index=False)
ins.to_parquet(f"{OUT}/inspections.parquet", index=False)
fpdf.to_parquet(f"{OUT}/acoustic_fingerprints.parquet", index=False)
bkdf.to_parquet(f"{OUT}/bookings_daily.parquet", index=False)
eqdf.to_parquet(f"{OUT}/lane_equipment_telemetry.parquet", index=False)
rsdf.to_parquet(f"{OUT}/remote_sensing_roadside.parquet", index=False)
pd.Series(EXAMINERS, name="examiner_id").to_frame().assign(
    home_branch=lambda d: [random.choice(bdf.branch_id) for _ in range(len(d))],
    gt_integrity_outlier=lambda d: d.examiner_id.isin(CORRUPT)).to_csv(f"{OUT}/examiners.csv", index=False)
defect_mix.rename("share").to_csv(f"{OUT}/calibration_uk_mot_defect_mix.csv")
state_w.rename("share").to_csv(f"{OUT}/calibration_jpj_2025_state_mix.csv")
cat_w.rename("share").to_csv(f"{OUT}/calibration_jpj_2025_category_mix.csv")
print("vehicles", len(veh), "inspections", len(ins), "claims", len(cl), "bookings", len(bkdf), "telemetry", len(eqdf), "roadside", len(rsdf))
print(ins.result.value_counts(normalize=True).round(3).to_dict())
print(veh[[c for c in veh.columns if c.startswith("gt_") and veh[c].dtype == bool]].sum().to_dict())

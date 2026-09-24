"""Build the six scripted demo sessions (S1-S6) with real-time sensor streams.

Each session = sessions/S#.json (vehicle, prior history, timeline of lane events, injected faults, expected AI outputs,
references to REAL images/audio in curated/) + streams/S#/*.parquet sampled at real-time rates for the session player.
E-nose channels use REAL UCI gas-sensor-array class centroids as signature proxies (documented per signal).
"""
import os, json, glob, random, datetime as dt
import numpy as np, pandas as pd

rng = np.random.default_rng(11); random.seed(11)
B = "/home/claude/dl"; CUR = f"{B}/curated"; SYN = f"{CUR}/synthetic"
SES = f"{CUR}/sessions"; os.makedirs(SES, exist_ok=True)

# ---- e-nose signatures from real UCI data (16 sensors, steady-state feature per sensor) ----
rows = []
for b in (1, 2):
    for line in open(f"{B}/raw/gas_sensor/miltongneto__Gas-Sensor-Array-Drift/Dataset/batch{b}.dat"):
        t = line.split(); lab = int(t[0].split(";")[0])
        f = {int(k): float(v) for k, v in (x.split(":") for x in t[1:])}
        rows.append([lab] + [f[1 + 8 * s] for s in range(16)])
g = pd.DataFrame(rows, columns=["gas"] + [f"s{i:02d}" for i in range(16)])
cent = g.groupby("gas").mean()
norm = cent.div(cent.abs().max(axis=1), axis=0)  # unit-shape signature per gas
GAS = {1: "ethanol", 2: "ethylene", 3: "ammonia", 4: "acetaldehyde", 5: "acetone", 6: "toluene"}
SIGNATURE_PROXY = {  # demo condition -> UCI gas class used as signature shape (documented proxy, not a claim of chemistry equivalence)
    "fuel_vapour_leak": 6, "nh3_slip_scr": 3, "burning_oil_or_hot_brake": 4, "coolant_glycol_leak": 1,
    "ev_electrolyte_offgas": 2, "cabin_solvent_or_mould": 5}
json.dump({k: {"uci_gas": GAS[v], "signature": norm.loc[v].round(4).tolist()} for k, v in SIGNATURE_PROXY.items()},
          open(f"{SES}/enose_signature_library.json", "w"), indent=1)

def enose_stream(seconds, events, humidity=0.8, hz=2):
    n = seconds * hz; t = np.arange(n) / hz
    base = rng.normal(0, .015, (n, 16)).cumsum(0) * .05 + humidity * .03
    x = base.copy()
    for cond, start, dur, amp in events:
        sig = norm.loc[SIGNATURE_PROXY[cond]].values
        env = np.clip((t - start) / 4, 0, 1) * np.clip((start + dur - t) / 6, 0, 1)
        x += np.outer(env * amp, sig) + rng.normal(0, .01, (n, 16))
    df = pd.DataFrame(x.round(4), columns=[f"ch{i:02d}" for i in range(16)]); df.insert(0, "t_s", t)
    return df

obd = pd.read_parquet(f"{CUR}/sensors/obd/obd2_driving_logs.parquet")
rpm_col = [c for c in obd.columns if "rpm" in c][0]
def obd_stream(seconds, dtcs, idle_rpm=750, rev_at=None):
    t = np.arange(seconds)
    rpm = idle_rpm + rng.normal(0, 15, seconds)
    if rev_at: rpm[rev_at:rev_at + 8] = np.linspace(idle_rpm, 3200, 8)
    real = obd.sample(seconds, random_state=1)
    df = pd.DataFrame({"t_s": t, "engine_rpm": rpm.round(0),
                       "coolant_temp_c": np.clip(real[[c for c in obd.columns if "coolant" in c][0]].values, 70, 105),
                       "intake_air_temp_c": real[[c for c in obd.columns if "intake_air_temp" in c][0]].values,
                       "maf_g_s": np.clip(rpm / 250 + rng.normal(0, .3, seconds), 1, 60).round(2)})
    df["dtcs"] = ",".join(dtcs); df["mil_on"] = bool(dtcs)
    return df

def pn_stream(seconds, level):
    return pd.DataFrame({"t_s": np.arange(seconds), "pn_per_cm3": (level * rng.lognormal(0, .25, seconds)).astype(int)})

def brake_roller(axles, eff, imb, drag):
    out = []
    for a in range(1, axles + 1):
        for side in ("L", "R"):
            k = 1 - (imb / 100 if side == "R" and a == 2 else 0)
            for s in np.arange(0, 12, .1):
                force = (eff / 100) * 9.5 * min(1, max(0, (s - 2) / 5)) * k + (drag / 100) * 1.2
                out.append(dict(axle=a, side=side, t_s=round(float(s), 1), brake_force_kn=round(float(force + rng.normal(0, .05)), 3)))
    return pd.DataFrame(out)

def thermal(axles, hot=None, pack_hotspot=None):
    d = {"wheel_hub_max_c": {f"A{a}{s}": round(float(rng.normal(58, 4)), 1) for a in range(1, axles + 1) for s in "LR"}}
    if hot: d["wheel_hub_max_c"][hot] = 146.0
    if pack_hotspot: d["battery_pack_cells"] = {"max_c": pack_hotspot, "mean_c": 33.5, "hotspot_cell": "M07-C12"}
    return d

def pick(glob_pat, n=1):
    fs = sorted(glob.glob(f"{CUR}/{glob_pat}"))
    return [os.path.relpath(f, CUR) for f in random.sample(fs, min(n, len(fs)))] if fs else []

LANE = [("check_in_anpr", 0, 20), ("identity_ocr", 20, 40), ("emission_idle_rev", 40, 130), ("brake_roller", 130, 190),
        ("suspension", 190, 230), ("side_slip", 230, 245), ("headlamp_tint", 245, 280), ("undercarriage_ai", 280, 340),
        ("above_carriage_ai", 340, 380), ("examiner_review", 380, 460), ("report", 460, 480)]

def save(sid, meta, streams):
    d = f"{SES}/streams/{sid}"; os.makedirs(d, exist_ok=True)
    for k, v in streams.items():
        if isinstance(v, pd.DataFrame): v.to_parquet(f"{d}/{k}.parquet", index=False)
        else: json.dump(v, open(f"{d}/{k}.json", "w"), indent=1)
    meta["streams"] = sorted(os.listdir(d)); meta["lane_timeline"] = [dict(step=s, start_s=a, end_s=b) for s, a, b in LANE]
    json.dump(meta, open(f"{SES}/{sid}.json", "w"), indent=1, default=str)

# ---- S1 tampered diesel prime mover ----
save("S1", dict(session="S1", title="Tampered diesel prime mover - Berkala at Alam Megah", branch_id="BR00",
    vehicle=dict(plate="DMO 9001", make="Scania", model="P-Series Prime Mover", year=2022, usage="lorry", fuel="diesel", euro_class="Euro 5",
                 dpf_fitted=True, scr_fitted=True, odometer_km=412300, fleet_id="FLEET07", axles=3),
    injected_faults=["dpf_removed", "scr_fault_adblue_bypass", "dragging_brake_axle2_R", "wheel_bearing_axle1_L"],
    expected=dict(smoke_opacity_pct=18.5, opacity_verdict="PASS (misleading)", pn_per_cm3=2.4e6, pn_verdict="FAIL advisory (>250k)",
                  obd_dtcs=["P2002", "P20EE", "P2BAD"], enose="nh3_slip_scr high", thermal="A2R hub 146C", acoustic="fault_bad_wheal_bearing",
                  health_score=41, next_berkala_fail_risk=0.83, examiner_action="confirm"),
    media=dict(undercarriage_images=pick("images/corrosion/*/*.jpg", 2), tyre_images=pick("images/tyre/defective/*.jpg", 1),
               audio=pick("audio/fault_bad_wheal_bearing/*.wav", 1) + pick("audio/engine_normal_idle/*.wav", 1))),
    dict(enose=enose_stream(480, [("nh3_slip_scr", 45, 80, 1.0), ("burning_oil_or_hot_brake", 150, 60, .6)]),
         obd=obd_stream(480, ["P2002", "P20EE", "P2BAD"], 600, 70), pn=pn_stream(60, 2.4e6),
         brake_roller=brake_roller(3, 58, 12, 16), thermal=thermal(3, hot="A2R"),
         instruments=dict(smoke_opacity_pct=18.5, suspension_eff_pct=[71, 69, 66], side_slip_m_per_km=3.1, headlamp_dev_pct=1.2, tint_vlt_pct=72)))

# ---- S2 used EV with flood history ----
save("S2", dict(session="S2", title="Used EV with flood history - B5 + B7 for sale with bank loan", branch_id="BR01",
    vehicle=dict(plate="DMO 9002", make="BYD", model="Atto 3", year=2022, usage="private", fuel="ev", odometer_km=58200, axles=2),
    prior_claims=[dict(date="2025-12-10", type="flood_natural_disaster", amount_rm=38400, ber=False)],
    injected_faults=["flood_immersion_dec_2025", "hv_isolation_marginal", "cell_module_hotspot", "undercarriage_corrosion"],
    expected=dict(ev_soh_pct=71.0, hv_isolation_mohm=1.8, hv_verdict="marginal (<2 MOhm advisory)", enose="ev_electrolyte_offgas trace",
                  corrosion_score=7.1, flood_probability=0.91, health_score=52, certificate="EV Health Certificate - CONDITIONAL"),
    media=dict(flood_reference_images=pick("images/flood/*/*.jpg", 2), undercarriage_images=pick("images/corrosion/*/*.jpg", 2),
               audio=pick("audio/fault_flooded_engin/*.wav", 1))),
    dict(enose=enose_stream(480, [("ev_electrolyte_offgas", 280, 70, .35)]), obd=obd_stream(480, ["U0100", "P0AA6"], 0),
         ev_bms=pd.DataFrame({"cell_module": [f"M{m:02d}" for m in range(1, 13)], "soh_pct": np.round(rng.normal(71, 1.2, 12), 1),
                              "v_min": np.round(rng.normal(3.28, .02, 12), 3), "t_max_c": np.r_[rng.normal(33, .8, 6), [44.2], rng.normal(33, .8, 5)].round(1)}),
         nasa_reference=pd.read_csv(f"{CUR}/sensors/ev_battery_nasa/cycle_capacity_soh.csv").query("battery=='B0005'")[["cycle", "soh_pct"]],
         brake_roller=brake_roller(2, 71, 6, 3), thermal=thermal(2, pack_hotspot=44.2),
         instruments=dict(hv_isolation_mohm=1.8, suspension_eff_pct=[74, 72], side_slip_m_per_km=1.4, headlamp_dev_pct=0.8, tint_vlt_pct=70, adas_self_test="advisory only")))

# ---- S3 suspicious private car ----
save("S3", dict(session="S3", title="Suspicious sedan - B5 ownership transfer", branch_id="BR02",
    vehicle=dict(plate="DMO 9003", make="Honda", model="Civic", year=2016, usage="private", fuel="petrol", odometer_km=96400, axles=2),
    prior_inspections=[dict(date="2024-03-14", type="B5_MV15", odometer_km=171300, engine_fingerprint="FP-A"),
                       dict(date="2025-06-02", type="voluntary", odometer_km=182900, engine_fingerprint="FP-A")],
    injected_faults=["odometer_rollback_86500km", "engine_swap_undeclared", "repaired_rear_panel"],
    expected=dict(odometer_flag="rollback: 182,900 -> 96,400 km", acoustic_similarity_to_history=0.31, engine_changed=True,
                  chassis_ocr_match=True, astra_finding="panel repair rear-left", route="senior examiner", health_score=58),
    media=dict(body_images=pick("images/vehicle_damage/r_breakage/*.jpg", 2), plate_images=pick("images/plates_my/real_plate_photo/*.jpg", 1),
               audio=pick("audio/engine_normal_idle/*.wav", 2))),
    dict(enose=enose_stream(480, []), obd=obd_stream(480, [], 720, 60), brake_roller=brake_roller(2, 66, 9, 4), thermal=thermal(2),
         instruments=dict(co_pct=0.3, hc_ppm=110, suspension_eff_pct=[63, 61], side_slip_m_per_km=2.2, headlamp_dev_pct=1.1, tint_vlt_pct=55)))

# ---- S4 HQ integrity + predictive maintenance (uses synthetic history) ----
ins = pd.read_parquet(f"{SYN}/inspections.parquet"); veh = pd.read_parquet(f"{SYN}/vehicles.parquet")
m = ins.merge(veh[["vehicle_id", "heavy"]], on="vehicle_id"); hv = m[m.heavy]
ex = hv.groupby("examiner_id").agg(n=("result", "size"), pass_rate=("result", lambda s: (s == "PASS").mean()),
                                   evidence_fail_rate=("fail_reasons", lambda s: (s != "").mean())).query("n>=30")
ex["z_pass"] = ((ex.pass_rate - ex.pass_rate.mean()) / ex.pass_rate.std()).round(2)
ex["evidence_conflict_rate"] = (ex.evidence_fail_rate - (1 - ex.pass_rate)).clip(lower=0).round(3)
eq = pd.read_parquet(f"{SYN}/lane_equipment_telemetry.parquet")
save("S4", dict(session="S4", title="HQ integrity analytics + lane predictive maintenance",
    expected=dict(outlier_examiners=ex.sort_values("z_pass", ascending=False).head(2).index.tolist(),
                  hash_chain_audit="all records intact", failing_device="BR00 lane 3 roller_brake_tester")),
    dict(examiner_stats=ex.reset_index(), equipment=eq[(eq.branch_id == "BR00")]))

# ---- S5 fleet + regulator ----
fleet = veh[veh.fleet_id == "FLEET07"]
fi = ins[ins.vehicle_id.isin(fleet.vehicle_id)].sort_values("date").groupby("vehicle_id").tail(1)
bk = pd.read_parquet(f"{SYN}/bookings_daily.parquet")
save("S5", dict(session="S5", title="Fleet operator (FLEET07) + JPJ/DOE regulator view", fleet_id="FLEET07",
    expected=dict(fleet_size=len(fleet), trucks_at_risk_next_berkala=int((fi.fail_reasons != "").sum()),
                  forecast_branch="BR00 Alam Megah")),
    dict(fleet_vehicles=fleet, fleet_last_inspection=fi, bookings_BR00=bk[bk.branch_id == "BR00"],
         remote_sensing=pd.read_parquet(f"{SYN}/remote_sensing_roadside.parquet")))

# ---- S6 customer journey ----
save("S6", dict(session="S6", title="Customer journey - BM assistant, GEAR booking, self-check, passport", branch_id="BR01",
    vehicle=dict(plate="DMO 9006", make="Perodua", model="Myvi", year=2019, usage="private", fuel="petrol", odometer_km=74100),
    assistant_script=[dict(user_bm="Saya nak jual kereta, pemeriksaan apa yang saya perlu?", intent="which_inspection", answer_type="B5/MV15 (+B7 if buyer takes loan)"),
                      dict(user_bm="Ada slot esok di Glenmarie?", intent="gear_slot", answer_type="GEAR next-day slot list")],
    self_check=dict(photos=["tint", "headlamp_left", "headlamp_right", "tyres x4"], engine_audio_s=20,
                    first_attempt=dict(tint_vlt_pct=38, headlamp_left="not working", verdict="fix these first"),
                    second_attempt=dict(tint_vlt_pct=71, headlamp_left="ok", verdict="likely to pass")),
    media=dict(tyre_images=pick("images/tyre/perfect/*.jpg", 2), audio=pick("audio/engine_normal_idle/*.wav", 1))),
    dict())
print("sessions:", sorted(f for f in os.listdir(SES) if f.endswith(".json")))

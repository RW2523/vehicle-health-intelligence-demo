"""Pattern comparison report: vehicle age x insurance x damage x inspection, flood vs normal, corrosion stages.
Real data sections are labelled REAL; synthetic sections SYNTHETIC. Output: curated/reports/*.png + PATTERNS.md"""
import os, glob, random, json
import numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

C = "/home/claude/dl/curated"; R = f"{C}/reports"; os.makedirs(R, exist_ok=True)
S1, S2, S3, S4 = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
INK, INK2, GRID, SURF = "#0b0b0b", "#52514e", "#e6e5e0", "#fcfcfb"
plt.rcParams.update({"figure.facecolor": SURF, "axes.facecolor": SURF, "axes.edgecolor": GRID, "axes.labelcolor": INK2,
                     "xtick.color": INK2, "ytick.color": INK2, "axes.grid": True, "grid.color": GRID, "grid.linewidth": .8,
                     "axes.spines.top": False, "axes.spines.right": False, "font.size": 10, "axes.titlesize": 12,
                     "axes.titleweight": "bold", "axes.titlecolor": INK, "axes.titlelocation": "left", "legend.frameon": False, "axes.axisbelow": True})
F = []  # findings
def save(fig, name, source):
    fig.text(0.01, 0.01, f"Source: {source}", fontsize=7.5, color=INK2)
    fig.tight_layout(rect=(0, .04, 1, 1)); fig.savefig(f"{R}/{name}.png", dpi=150); plt.close(fig)

# ---------- 1-3 REAL: Copart salvage lots (US) ----------
c = pd.read_parquet(f"{C}/tabular/salvage_flood_copart/copart_salvage_lots.parquet")
c = c[(c.mileage < 500000) & (c.repairCost < 200000) & (c.year >= 1995)]
c["age"] = 2026 - c.year
bands = [0, 3, 6, 10, 15, 32]; labels = ["0-3", "4-6", "7-10", "11-15", "16+"]
c["age_band"] = pd.cut(c.age, bands, labels=labels, include_lowest=True)
share = (pd.crosstab(c.age_band, c.damageDescription, normalize="index") * 100)
fig, ax = plt.subplots(figsize=(8, 4.2))
for col, lab, clr in [("WATER/FLOOD", "Water / flood", S1), ("MECHANICAL", "Mechanical", S2), ("NORMAL WEAR", "Normal wear", S3), ("UNDERCARRIAGE", "Undercarriage", S4)]:
    y = share[col].values; ax.plot(labels, y, color=clr, lw=2, marker="o", ms=5, label=lab)
    ax.annotate(lab, (4, y[-1]), xytext=(6, 0), textcoords="offset points", va="center", color=INK2, fontsize=8.5)
ax.set_title("Salvage damage type mix shifts with vehicle age"); ax.set_xlabel("Vehicle age (years)"); ax.set_ylabel("% of salvage lots in age band")
ax.legend(loc="upper center", bbox_to_anchor=(.5, -.18), ncol=4, fontsize=8.5)
save(fig, "01_real_salvage_damage_mix_by_age", f"Copart salvage auction lots, {len(c):,} rows, 30 daily snapshots Aug-Sep 2026 (rebrowser/copart-dataset)")
F.append(("REAL", f"Among {len(c):,} US salvage lots, flood/water damage is {share['WATER/FLOOD'].iloc[0]:.1f}% of lots for 0-3-year-old vehicles vs {share['WATER/FLOOD'].iloc[-1]:.1f}% for 16+; "
                  f"mechanical rises from {share['MECHANICAL'].iloc[0]:.1f}% to {share['MECHANICAL'].iloc[-1]:.1f}% and normal wear from {share['NORMAL WEAR'].iloc[0]:.1f}% to {share['NORMAL WEAR'].iloc[-1]:.1f}%."))

c["flood"] = np.where(c.damageDescription.eq("WATER/FLOOD") | c.secondaryDamage.astype(str).eq("WATER/FLOOD"), "Flood-damaged", "Other damage")
med = c.groupby(["age_band", "flood"], observed=True).repairCost.median().unstack()
fig, ax = plt.subplots(figsize=(8, 4.2)); x = np.arange(len(labels)); w = .38
for k, (col, clr) in enumerate([("Flood-damaged", S1), ("Other damage", S2)]):
    b = ax.bar(x + (k - .5) * (w + .02), med[col].values, w, color=clr, label=col)
ax.set_xticks(x, labels); ax.set_title("Flood repair estimates overtake other damage as vehicles age")
ax.set_xlabel("Vehicle age (years)"); ax.set_ylabel("Median repair cost estimate (USD)"); ax.legend(ncol=2)
save(fig, "02_real_flood_vs_other_repair_cost_by_age", "Copart salvage lots (rebrowser/copart-dataset)")
F.append(("REAL", "Median salvage repair estimate, flood vs other damage, by age band (USD): " + "; ".join(f"{a}: {med.loc[a,'Flood-damaged']:,.0f} vs {med.loc[a,'Other damage']:,.0f}" for a in labels) + "."))

mm = c.groupby(["age_band", "flood"], observed=True).mileage.median().unstack()
F.append(("REAL", "Median odometer (miles) flood vs other, by age band: " + "; ".join(f"{a}: {mm.loc[a,'Flood-damaged']:,.0f} vs {mm.loc[a,'Other damage']:,.0f}" for a in labels) +
          f". Odometer marked 'Not Actual' on {(c.odometerBrand=='N').mean()*100:.1f}% of lots - the rollback signal a history check should catch."))

# ---------- 4 REAL: insurance claims vs vehicle age ----------
ins = pd.read_csv(f"{C}/tabular/insurance_claims/insurance_claims.csv")
ins["veh_age"] = pd.to_datetime(ins.incident_date).dt.year - ins.auto_year
ins["age_band"] = pd.cut(ins.veh_age, [-1, 3, 6, 10, 15, 30], labels=labels)
g = ins.groupby("age_band", observed=True).agg(claim=("vehicle_claim", "median"), fraud=("fraud_reported", lambda s: (s == "Y").mean() * 100), n=("vehicle_claim", "size"))
fig, axs = plt.subplots(1, 2, figsize=(9, 3.8))
axs[0].bar(g.index.astype(str), g.claim, color=S1, width=.6); axs[0].set_title("Median vehicle claim (USD)"); axs[0].set_xlabel("Vehicle age at incident")
axs[1].bar(g.index.astype(str), g.fraud, color=S2, width=.6); axs[1].set_title("Claims flagged as fraud (%)"); axs[1].set_xlabel("Vehicle age at incident")
save(fig, "03_real_insurance_claims_by_vehicle_age", f"Auto insurance claims dataset, n={len(ins)} (DandiMahendris/Auto-Insurance-Fraud-Detection)")
F.append(("REAL", "Insurance claims (n=1,000): median vehicle claim by age band " + ", ".join(f"{a} {v:,.0f}" for a, v in g.claim.items()) +
          "; fraud flag rate " + ", ".join(f"{a} {v:.0f}%" for a, v in g.fraud.items()) + ". Claim size does not fall with age as fast as vehicle value, so older insured vehicles are likelier BER/rebuild candidates."))

# ---------- 5 REAL: UK MOT failure by family + defect mix ----------
fam = pd.read_csv(f"{C}/tabular/inspection_history_uk_mot/motriskindex-families-2024-v2.csv").sort_values("initial_fail_pct")
fig, ax = plt.subplots(figsize=(8, 7))
ax.barh(fam.family, fam.initial_fail_pct, color=S1, height=.65); ax.set_title("UK MOT initial failure rate by model family (2024)")
ax.set_xlabel("% of tests failed at first attempt"); ax.tick_params(axis="y", labelsize=8)
for y, v in zip(fam.family, fam.initial_fail_pct):
    if y in (fam.family.iloc[0], fam.family.iloc[-1]): ax.annotate(f"{v:.1f}%", (v, y), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8, color=INK2)
save(fig, "04_real_uk_mot_fail_rate_by_family", "DVSA anonymised MOT results 2024 via ivitskiy/uk-mot-risk-index-dataset (CC BY 4.0)")
dg = pd.read_csv(f"{C}/tabular/inspection_history_uk_mot/motriskindex-defect-groups-2024-v2.csv").groupby("defect_group").national_failure_items_per_100_tests.first().sort_values()
fig, ax = plt.subplots(figsize=(8, 4.5)); ax.barh(dg.index, dg.values, color=S3, height=.6)
ax.set_title("What fails periodic inspection: defect groups (UK national)"); ax.set_xlabel("Failure items per 100 tests")
save(fig, "05_real_uk_mot_defect_groups", "DVSA MOT 2024 via ivitskiy/uk-mot-risk-index-dataset")
F.append(("REAL", f"UK MOT 2024: first-attempt fail rates range {fam.initial_fail_pct.min():.1f}% ({fam.family.iloc[0]}) to {fam.initial_fail_pct.max():.1f}% ({fam.family.iloc[-1]}). Top defect groups per 100 tests: " +
          ", ".join(f"{k} {v:.1f}" for k, v in dg.sort_values(ascending=False).head(4).items()) + "."))

# ---------- 6 REAL: EV battery SOH fade ----------
b = pd.read_csv(f"{C}/sensors/ev_battery_nasa/cycle_capacity_soh.csv")
fig, ax = plt.subplots(figsize=(8, 4.2))
for bid, clr in zip(["B0005", "B0006", "B0007", "B0018"], [S1, S2, S3, S4]):
    d = b[b.battery == bid]; ax.plot(d.cycle, d.soh_pct, color=clr, lw=2, label=bid)
ax.axhline(80, color=INK2, lw=1, ls="--"); ax.annotate("80% end-of-life convention", (2, 80.6), fontsize=8, color=INK2)
ax.set_title("Li-ion state of health falls with cycling - the curve an EV SOH check reads"); ax.set_xlabel("Discharge cycle"); ax.set_ylabel("State of health (% of initial capacity)")
ax.legend(ncol=4)
save(fig, "06_real_ev_battery_soh_fade", "NASA PCoE battery ageing data B0005/6/7/18 (anirudhkhatry/SOH-prediction-using-NASA-Dataset)")
last = b.groupby("battery").tail(1)
F.append(("REAL", "NASA cells: SOH after last cycle " + ", ".join(f"{r.battery} {r.soh_pct:.0f}% @ cycle {r.cycle}" for r in last.itertuples()) + "."))

# ---------- 7 REAL: gas-sensor drift ----------
gs = pd.read_parquet(f"{C}/sensors/gas_sensor_array_uci_drift/gas_sensor_drift.parquet")
d = gs[gs.gas == "ammonia"].groupby("batch")[["f1", "f9", "f17"]].median()
fig, ax = plt.subplots(figsize=(8, 4))
for col, clr, lab in [("f1", S1, "Sensor 1"), ("f9", S2, "Sensor 2"), ("f17", S3, "Sensor 3")]:
    ax.plot(d.index, d[col], color=clr, lw=2, marker="o", ms=5, label=lab)
ax.set_title("Same gas (ammonia), same sensors - response drifts over 36 months"); ax.set_xlabel("Batch (months 1-36)"); ax.set_ylabel("Median steady-state response")
ax.legend(ncol=3)
save(fig, "07_real_enose_sensor_drift", "UCI Gas Sensor Array Drift dataset (miltongneto/Gas-Sensor-Array-Drift)")
F.append(("REAL", "E-nose drift: median ammonia response on sensor 1 moves from %.0f (batch 1) to %.0f (batch 10) - why the proposal specifies daily zero and monthly span calibration." % (d.f1.iloc[0], d.f1.iloc[-1])))

# ---------- 8-10 SYNTHETIC ----------
v = pd.read_parquet(f"{C}/synthetic/vehicles.parquet"); i = pd.read_parquet(f"{C}/synthetic/inspections.parquet")
cl = pd.read_parquet(f"{C}/synthetic/insurance_claims.parquet")
m = i.merge(v, on="vehicle_id"); m["age_band"] = pd.cut(m.age_years, bands, labels=labels, include_lowest=True)
m["group"] = np.select([m.gt_flood_damaged, m.gt_ber_rebuilt], ["Flood history", "BER / rebuilt"], "No flood / BER")
fr = m.groupby(["age_band", "group"], observed=True).result.apply(lambda s: (s == "FAIL").mean() * 100).unstack()
fig, ax = plt.subplots(figsize=(8, 4.2))
for col, clr in [("No flood / BER", S1), ("BER / rebuilt", S2), ("Flood history", S3)]:
    if col in fr: ax.plot(labels, fr[col].reindex(labels).values, color=clr, lw=2, marker="o", ms=5, label=col)
ax.set_title("Fail rate climbs steeply with age; flood history adds most at 7-15 years"); ax.set_xlabel("Vehicle age (years)"); ax.set_ylabel("% of inspections failed"); ax.legend(ncol=3)
save(fig, "08_synthetic_fail_rate_age_flood_ber", "SYNTHETIC fleet (5,000 vehicles, 13,866 inspections) calibrated to JPJ 2025 registrations and UK MOT defect mix")
F.append(("SYNTHETIC", "Fail rate by age (all vehicles): " + ", ".join(f"{a} {m[m.age_band==a].result.eq('FAIL').mean()*100:.0f}%" for a in labels) + ". Flood-history vehicles fail at " +
          f"{m[m.gt_flood_damaged].result.eq('FAIL').mean()*100:.0f}% vs {m[~m.gt_flood_damaged].result.eq('FAIL').mean()*100:.0f}% otherwise."))

fig, axs = plt.subplots(1, 3, figsize=(10, 3.6))
grp = m.groupby("gt_flood_damaged")
vals = [("Corrosion score (0-10)", grp.corrosion_score_0_10.mean()), ("OBD fault codes present (%)", grp.obd_mil_on.mean() * 100),
        ("EV HV isolation (MOhm, median)", m[m.fuel == "ev"].groupby("gt_flood_damaged").hv_isolation_mohm.median())]
for ax, (t, s) in zip(axs, vals):
    ax.bar(["No flood", "Flood"], [s.get(False, np.nan), s.get(True, np.nan)], color=[S1, S3], width=.55); ax.set_title(t, fontsize=10)
save(fig, "09_synthetic_flood_vs_normal_signals", "SYNTHETIC fleet - ground-truth flood flag vs measured signals")
F.append(("SYNTHETIC", f"Flood vs no-flood: corrosion score {vals[0][1][True]:.1f} vs {vals[0][1][False]:.1f}; OBD codes present {vals[1][1][True]:.0f}% vs {vals[1][1][False]:.0f}%; EV HV isolation median {vals[2][1].get(True, np.nan):.1f} vs {vals[2][1].get(False, np.nan):.1f} MOhm."))

# odometer rollback & engine swap detectability
o = i.sort_values("date").groupby("vehicle_id").odometer_km.apply(lambda s: (s.diff() < -5000).any())
rb = v.set_index("vehicle_id").gt_odometer_rollback_km > 0
fp = pd.read_parquet(f"{C}/synthetic/acoustic_fingerprints.parquet")
E = [c for c in fp.columns if c.startswith("e")]
sim = []
for vid, gdf in fp.merge(i[["inspection_id", "date"]], on="inspection_id").sort_values("date").groupby("vehicle_id"):
    if len(gdf) < 2: continue
    a, bb = gdf[E].iloc[-2].values, gdf[E].iloc[-1].values
    sim.append((vid, float(a @ bb / np.linalg.norm(a) / np.linalg.norm(bb))))
sim = pd.DataFrame(sim, columns=["vehicle_id", "cos"]).merge(v[["vehicle_id", "gt_engine_swapped"]], on="vehicle_id")
fig, ax = plt.subplots(figsize=(8, 4))
ax.hist(sim[~sim.gt_engine_swapped].cos, bins=40, color=S1, label="Same engine", alpha=.9)
ax.hist(sim[sim.gt_engine_swapped].cos, bins=20, color=S2, label="Engine swapped", alpha=.9)
ax.set_title("Acoustic fingerprint similarity to previous visit"); ax.set_xlabel("Cosine similarity of engine-sound embedding"); ax.set_ylabel("Vehicles"); ax.legend()
save(fig, "10_synthetic_engine_swap_fingerprint", "SYNTHETIC acoustic fingerprints (embedding per visit)")
F.append(("SYNTHETIC", f"Odometer rollback: {int((o & rb.reindex(o.index).fillna(False)).sum())} of {int(rb.sum())} injected rollbacks are visible as a >5,000 km drop between visits (the rest had only one visit - needs cross-source history). "
          f"Engine swap: same-engine similarity median {sim[~sim.gt_engine_swapped].cos.median():.2f} vs swapped {sim[sim.gt_engine_swapped].cos.median():.2f}."))

cc = cl.merge(v[["vehicle_id", "age_years", "usage"]], on="vehicle_id"); cc["age_band"] = pd.cut(cc.age_years, bands, labels=labels, include_lowest=True)
F.append(("SYNTHETIC", "Claims per 100 vehicles over 3 years by age band: " + ", ".join(
    f"{a} {len(cc[cc.age_band==a]) / max(1,(pd.cut(v.age_years,bands,labels=labels,include_lowest=True)==a).sum())*100:.0f}" for a in labels) + "."))

# ---------- 11 REAL images: contact sheets + rust-hue pixel share ----------
man = pd.read_csv(f"{C}/manifest.csv")
def sheet(rows, name, title, n=8, cell=180):
    random.seed(1); fig, axs = plt.subplots(len(rows), n, figsize=(n * 1.35, len(rows) * 1.55))
    for r, (lab, pat) in enumerate(rows):
        fs = sorted(glob.glob(f"{C}/images/{pat}")); pick = random.sample(fs, min(n, len(fs)))
        for k in range(n):
            ax = axs[r, k]; ax.axis("off")
            if k < len(pick):
                im = Image.open(pick[k]); im.thumbnail((cell, cell)); ax.imshow(im)
        axs[r, 0].set_title(lab, loc="left", fontsize=9, color=INK)
    fig.suptitle(title, x=.01, ha="left", fontsize=12, fontweight="bold", color=INK)
    fig.tight_layout(); fig.savefig(f"{R}/{name}.png", dpi=110); plt.close(fig)
sheet([("Corrosion (industrial metal)", "corrosion/*/*.jpg"), ("Flood / submerged vehicles", "flood/*/*.jpg"),
       ("Front - normal", "vehicle_damage/f_normal/*.jpg"), ("Front - breakage", "vehicle_damage/f_breakage/*.jpg"),
       ("Front - crushed", "vehicle_damage/f_crushed/*.jpg"), ("Tyre - perfect", "tyre/perfect/*.jpg"), ("Tyre - defective", "tyre/defective/*.jpg"),
       ("Malaysian plates", "plates_my/real_plate_photo/*.jpg")], "11_real_image_contact_sheet", "Real image classes side by side")

def rust_share(p):
    im = np.asarray(Image.open(p).convert("HSV").resize((160, 160))).astype(float)
    h, s, vv = im[..., 0] * 360 / 255, im[..., 1] / 255, im[..., 2] / 255
    return float(((h >= 5) & (h <= 40) & (s > .35) & (vv > .15) & (vv < .85)).mean() * 100)
cls = [("Corrosion", "corrosion/*/*.jpg"), ("Flood", "flood/*/*.jpg"), ("Car normal", "vehicle_damage/f_normal/*.jpg"),
       ("Car crushed", "vehicle_damage/f_crushed/*.jpg"), ("Tyre defective", "tyre/defective/*.jpg"), ("Tyre perfect", "tyre/perfect/*.jpg")]
rs = {k: np.median([rust_share(p) for p in sorted(glob.glob(f"{C}/images/{pat}"))[:120]]) for k, pat in cls}
fig, ax = plt.subplots(figsize=(8, 3.8)); ks = list(rs)
ax.bar(ks, [rs[k] for k in ks], color=[S2 if k == "Corrosion" else S1 for k in ks], width=.6)
for x, k in enumerate(ks): ax.annotate(f"{rs[k]:.1f}%", (x, rs[k]), xytext=(0, 3), textcoords="offset points", ha="center", fontsize=8.5, color=INK2)
ax.set_title("Rust-hue pixel share - a simple colour cue separates corrosion images"); ax.set_ylabel("Median % of pixels in rust hue band")
save(fig, "12_real_rust_hue_share_by_class", "Curated real images; HSV hue 5-40 deg, saturation >0.35")
F.append(("REAL", "Rust-hue pixel share (median): " + ", ".join(f"{k} {v:.1f}%" for k, v in rs.items()) + " - colour alone is a weak but real cue; the detector must learn texture and context."))
json.dump(F, open(f"{R}/findings.json", "w"), indent=1)
print("\n".join(f"[{a}] {b}" for a, b in F))

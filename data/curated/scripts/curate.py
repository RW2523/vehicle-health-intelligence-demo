"""Curate raw GitHub-sourced datasets into the PUSPAKOM VHI demo data layout.

Output: /home/claude/dl/curated/{images,audio,sensors,tabular}/... + manifest.csv
Every file row in the manifest records source repo, licence, original path and label.
"""
import os, re, csv, glob, random, shutil, subprocess, json, hashlib
from PIL import Image, ImageOps
import pandas as pd, numpy as np

random.seed(42)
RAW = "/home/claude/dl/raw"
OUT = "/home/claude/dl/curated"
MAXDIM = 1280
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
AUD_EXT = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".mp4"}

LIC = {  # from GitHub API licence field; None = no licence declared (research/demo use only)
    "krishnapriya-nynaru/Industrial-Corrosion-Detection-YOLOv11": "MIT",
    "umerforsure/Car-Damage-Detection": "MIT",
    "nicolasmetallo/car-damage-detector": "MIT",
    "Nexlson/Malaysia_License_Plate_Generator": "MIT",
    "afeefabubakar/License-Plate-Detection-with-OpenCV": "MIT",
    "artem111-oss/car-diagnosis": "MIT",
    "KaroDievas/car-sound-classification-with-keras": "MIT",
    "Dalageo/ml-gas-sensor-drift": "AGPL-3.0",
    "mytrile/obd-trouble-codes": "MIT",
    "mfaizalzain/mygov": "MIT",
    "foerbsnavi/OBDex": "CC0 data / MIT tooling (per README)",
    "ivitskiy/uk-mot-risk-index-dataset": "CC BY 4.0 (DVSA open data, per README)",
}
manifest = []

def lic(repo):
    return LIC.get(repo, "none declared - demo/research use only, verify before commercial use")

def add(path, domain, label, source, orig, kind, extra=None):
    row = dict(file=os.path.relpath(path, OUT), domain=domain, label=label, kind=kind,
               source_repo=source, source_url=f"https://github.com/{source}", licence=lic(source),
               original_path=orig, bytes=os.path.getsize(path))
    if extra: row.update(extra)
    manifest.append(row)

def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:40]

def put_image(src, domain, label, source, max_n=None, _count={}):
    key = (domain, label)
    n = _count.get(key, 0)
    if max_n and n >= max_n:
        return
    d = os.path.join(OUT, "images", domain, slug(label))
    os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, f"{slug(source.split('/')[1])[:18]}_{n:05d}.jpg")
    try:
        im = Image.open(src); im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((MAXDIM, MAXDIM)); im.save(dst, "JPEG", quality=88)
    except Exception as e:
        return
    _count[key] = n + 1
    w, h = Image.open(dst).size
    add(dst, domain, label, source, os.path.relpath(src, RAW), "image", {"width": w, "height": h})

def imgs(folder, recurse=True):
    out = []
    for r, ds, fs in os.walk(folder):
        for f in fs:
            if os.path.splitext(f)[1].lower() in IMG_EXT:
                out.append(os.path.join(r, f))
        if not recurse: break
    return sorted(out)

def sample(lst, n):
    lst = list(lst); random.shuffle(lst); return sorted(lst[:n])

# ---------------- IMAGES ----------------
# Corrosion (real photos only; exclude model output renders under results/ runs/)
CK = "/home/claude/dl/_media_manifest.json"
if os.path.exists(CK):
    manifest.extend(json.load(open(CK)))
else:
    exec(open("/home/claude/dl/_media.py").read())
# ---------------- SENSORS ----------------
S = f"{OUT}/sensors"
# Gas sensor array (UCI drift): 16 MOS sensors x 8 features, 6 gases, 10 batches over 36 months
gs = f"{S}/gas_sensor_array_uci_drift"; os.makedirs(gs, exist_ok=True)
gases = {1: "ethanol", 2: "ethylene", 3: "ammonia", 4: "acetaldehyde", 5: "acetone", 6: "toluene"}
rows = []
for b in range(1, 11):
    with open(f"{RAW}/gas_sensor/miltongneto__Gas-Sensor-Array-Drift/Dataset/batch{b}.dat") as fh:
        for line in fh:
            t = line.split()
            lab, conc = (t[0].split(";") + ["nan"])[:2]
            feats = {f"f{int(k)}": float(v) for k, v in (x.split(":") for x in t[1:])}
            rows.append({"batch": b, "gas_id": int(lab), "gas": gases[int(lab)], "concentration_ppmv": float(conc), **feats})
gdf = pd.DataFrame(rows)
gdf.to_parquet(f"{gs}/gas_sensor_drift.parquet", index=False)
gdf.groupby(["batch", "gas"]).size().unstack(fill_value=0).to_csv(f"{gs}/counts_by_batch_gas.csv")
add(f"{gs}/gas_sensor_drift.parquet", "sensors", "e_nose_training", "miltongneto/Gas-Sensor-Array-Drift",
    "Dataset/batch*.dat", "table", {"rows": len(gdf)})

# NASA Li-ion ageing (B0005/6/7/18): per-discharge-cycle capacity -> SOH
from scipy.io import loadmat
nb = f"{S}/ev_battery_nasa"; os.makedirs(nb, exist_ok=True)
recs, curves = [], []
for mat in sorted(glob.glob(f"{RAW}/ev_battery/anirudhkhatry__SOH-prediction-using-NASA-Dataset/B00*.mat")):
    bid = os.path.basename(mat)[:-4]
    m = loadmat(mat, simplify_cells=True)[bid]["cycle"]
    k = 0
    for c in m:
        if c["type"] != "discharge": continue
        d = c["data"]; cap = float(np.atleast_1d(d["Capacity"])[0]); k += 1
        recs.append({"battery": bid, "cycle": k, "ambient_temp_c": c["ambient_temperature"], "capacity_ah": cap,
                     "v_min": float(np.min(d["Voltage_measured"])), "t_max_c": float(np.max(d["Temperature_measured"])),
                     "discharge_time_s": float(np.max(d["Time"]))})
        if k % 20 == 1:
            for t, v, i_, tc in zip(d["Time"][::5], d["Voltage_measured"][::5], d["Current_measured"][::5], d["Temperature_measured"][::5]):
                curves.append({"battery": bid, "cycle": k, "time_s": t, "voltage_v": v, "current_a": i_, "temp_c": tc})
bdf = pd.DataFrame(recs)
bdf["soh_pct"] = bdf.groupby("battery")["capacity_ah"].transform(lambda s: 100 * s / s.iloc[0]).round(2)
bdf.to_csv(f"{nb}/cycle_capacity_soh.csv", index=False)
pd.DataFrame(curves).to_parquet(f"{nb}/discharge_curves_every20th_cycle.parquet", index=False)
add(f"{nb}/cycle_capacity_soh.csv", "sensors", "ev_soh_training", "anirudhkhatry/SOH-prediction-using-NASA-Dataset", "B00*.mat", "table", {"rows": len(bdf)})
add(f"{nb}/discharge_curves_every20th_cycle.parquet", "sensors", "ev_discharge_curves", "anirudhkhatry/SOH-prediction-using-NASA-Dataset", "B00*.mat", "table", {"rows": len(curves)})

# OBD-II real driving logs (Seat Leon, 2017-18) + DTC code dictionaries
ob = f"{S}/obd"; os.makedirs(ob, exist_ok=True)
frames = []
for f in sorted(glob.glob(f"{RAW}/obd/hayatu4islam__Automotive_Diagnostics/OBD-II-Dataset/*.csv")):
    try:
        df = pd.read_csv(f, sep=None, engine="python")
    except Exception:
        continue
    df.insert(0, "trip", os.path.basename(f)[:-4]); frames.append(df)
odf = pd.concat(frames, ignore_index=True)
cols, seen = [], {}
for i, c in enumerate(odf.columns):
    k = slug(c) or f"c{i}"; seen[k] = seen.get(k, 0) + 1
    cols.append(k if seen[k] == 1 else f"{k}_{seen[k]}")
odf.columns = cols
odf.to_parquet(f"{ob}/obd2_driving_logs.parquet", index=False)
add(f"{ob}/obd2_driving_logs.parquet", "sensors", "obd_pid_streams", "hayatu4islam/Automotive_Diagnostics", "OBD-II-Dataset/*.csv", "table",
    {"rows": len(odf), "trips": len(frames)})
shutil.copy(f"{RAW}/obd/mytrile__obd-trouble-codes/obd-trouble-codes.csv", f"{ob}/dtc_codes.csv")
add(f"{ob}/dtc_codes.csv", "sensors", "dtc_dictionary", "mytrile/obd-trouble-codes", "obd-trouble-codes.csv", "table")
obdex = f"{RAW}/obd/foerbsnavi__OBDex"
dd = f"{ob}/obdex"; os.makedirs(dd, exist_ok=True)
for f in glob.glob(f"{obdex}/data/**/*", recursive=True):
    if os.path.isfile(f):
        tgt = os.path.join(dd, os.path.relpath(f, f"{obdex}/data")); os.makedirs(os.path.dirname(tgt), exist_ok=True); shutil.copy(f, tgt)
if os.listdir(dd):
    add(dd if os.path.isfile(dd) else next(iter(glob.glob(f"{dd}/**/*", recursive=True))), "sensors", "dtc_pid_database", "foerbsnavi/OBDex", "data/", "table")
print("sensors done", len(manifest))

# ---------------- TABULAR ----------------
T = f"{OUT}/tabular"
cp = f"{T}/salvage_flood_copart"; os.makedirs(cp, exist_ok=True)
cfr = [pd.read_csv(f, low_memory=False) for f in sorted(glob.glob(f"{RAW}/salvage_flood/rebrowser__copart-dataset/auction-listings/data/*.csv"))]
cdf = pd.concat(cfr, ignore_index=True).replace("[PREMIUM]", np.nan)
cdf = cdf.drop(columns=[c for c in cdf.columns if cdf[c].isna().all()])
for c in cdf.columns:
    if cdf[c].dtype == object: cdf[c] = cdf[c].astype("string")
cdf.to_parquet(f"{cp}/copart_salvage_lots.parquet", index=False)
add(f"{cp}/copart_salvage_lots.parquet", "tabular", "salvage_damage_age_mileage", "rebrowser/copart-dataset", "auction-listings/data/*.csv", "table",
    {"rows": len(cdf), "days": len(cfr)})
mot = f"{T}/inspection_history_uk_mot"; os.makedirs(mot, exist_ok=True)
for f in glob.glob(f"{RAW}/inspection_history/ivitskiy__uk-mot-risk-index-dataset/*.csv"):
    shutil.copy(f, mot); add(os.path.join(mot, os.path.basename(f)), "tabular", "mot_failure_by_age_family", "ivitskiy/uk-mot-risk-index-dataset", os.path.basename(f), "table")
for f in [f"{RAW}/inspection_history/Nasser-Sanchez__UK-MOT-Reliability-Analysis/docs/example_cars.csv",
          f"{RAW}/inspection_history/Nasser-Sanchez__UK-MOT-Reliability-Analysis/data/terminal_predictions/batch_0000.parquet"]:
    shutil.copy(f, mot); add(os.path.join(mot, os.path.basename(f)), "tabular", "mot_reliability_survival", "Nasser-Sanchez/UK-MOT-Reliability-Analysis", os.path.relpath(f, RAW), "table")
ins = f"{T}/insurance_claims"; os.makedirs(ins, exist_ok=True)
shutil.copy(f"{RAW}/insurance/DandiMahendris__Auto-Insurance-Fraud-Detection/data/dataset/insurance_claims.csv", ins)
add(f"{ins}/insurance_claims.csv", "tabular", "insurance_claim_fraud_vehicle_age", "DandiMahendris/Auto-Insurance-Fraud-Detection", "data/dataset/insurance_claims.csv", "table")
for f in glob.glob(f"{RAW}/insurance/Avitrya__Car-Insurance-Fraud-Detection/**/*", recursive=True):
    if os.path.isfile(f) and os.path.splitext(f)[1].lower() in {".csv", ".xlsx", ".xls"}:
        shutil.copy(f, ins); add(os.path.join(ins, os.path.basename(f)), "tabular", "insurance_claims_alt", "Avitrya/Car-Insurance-Fraud-Detection", os.path.relpath(f, RAW), "table")
uc = f"{T}/used_cars"; os.makedirs(uc, exist_ok=True)
for f in glob.glob(f"{RAW}/used_cars/**/*", recursive=True):
    if os.path.isfile(f) and os.path.splitext(f)[1].lower() in {".csv", ".xlsx", ".zip"}:
        shutil.copy(f, uc); add(os.path.join(uc, os.path.basename(f)), "tabular", "used_car_listings", "jyothiknj/Used-Cars-Dataset", os.path.relpath(f, RAW), "table")
my = f"{T}/malaysia"; os.makedirs(my, exist_ok=True)
tsa = f"{RAW}/malaysia/tasadapullo-svg__Malaysia-7Cities-Traffic-Master-Dataset-2025"
for f in glob.glob(f"{tsa}/**/*", recursive=True):
    if os.path.isfile(f) and os.path.splitext(f)[1].lower() in {".csv", ".parquet", ".xlsx"} and os.path.getsize(f) < 20e6:
        rel = os.path.relpath(f, tsa); tgt = os.path.join(my, "seven_cities_2025", rel); os.makedirs(os.path.dirname(tgt), exist_ok=True); shutil.copy(f, tgt)
        add(tgt, "tabular", "malaysia_traffic_population_vehicle_registration", "tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025", rel, "table")
print("tabular done", len(manifest))

man = pd.DataFrame(manifest)
man.to_csv(f"{OUT}/manifest.csv", index=False)
print(man.groupby(["kind", "domain"]).agg(files=("file", "count"), mb=("bytes", lambda b: round(b.sum() / 1e6, 1))))
print(man[man.kind == "image"].groupby(["domain", "label"]).size())
print(man[man.kind == "audio"].groupby("label").size().to_string())

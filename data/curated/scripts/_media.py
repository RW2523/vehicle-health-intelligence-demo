kp = f"{RAW}/corrosion/krishnapriya-nynaru__Industrial-Corrosion-Detection-YOLOv11"
for p in imgs(kp):
    if "/results" in p or "/runs" in p: continue
    put_image(p, "corrosion", "corrosion_industrial_metal", "krishnapriya-nynaru/Industrial-Corrosion-Detection-YOLOv11")
hc = f"{RAW}/corrosion/H-Cavid__AP-corrosion-detection"
for p in imgs(hc):
    if re.search(r"/(output|results|runs)/", p): continue
    put_image(p, "corrosion", "corrosion_misc", "H-Cavid/AP-corrosion-detection")

# Vehicle damage - severity classes (front/rear x normal/breakage/crushed)
ap = f"{RAW}/car_damage/AspectParadox-dev__Car-Damage-Evaluation/dataset"
for cls in sorted(os.listdir(ap)):
    for p in sample(imgs(os.path.join(ap, cls)), 180):
        put_image(p, "vehicle_damage", cls.lower(), "AspectParadox-dev/Car-Damage-Evaluation")
tq = f"{RAW}/car_damage/dxlabskku__TQVCD"
tqmap = {"FB": "f_breakage", "FC": "f_crushed", "FN": "f_normal", "RB": "r_breakage", "RC": "r_crushed", "RN": "r_normal"}
for k, v in tqmap.items():
    for p in imgs(os.path.join(tq, k)):
        put_image(p, "vehicle_damage", v, "dxlabskku/TQVCD")
for p in imgs(f"{RAW}/car_damage/nicolasmetallo__car-damage-detector/dataset"):
    put_image(p, "vehicle_damage", "dent_scratch_annotated", "nicolasmetallo/car-damage-detector")
lbl = f"{OUT}/images/vehicle_damage/_annotations/nicolasmetallo"
os.makedirs(lbl, exist_ok=True)
for j in glob.glob(f"{RAW}/car_damage/nicolasmetallo__car-damage-detector/dataset/*/*.json"):
    shutil.copy(j, os.path.join(lbl, j.split("/")[-2] + "_" + os.path.basename(j)))
for p in imgs(f"{RAW}/car_damage/Oleksy1121__Car-damage-detection"):
    put_image(p, "vehicle_damage", "mixed_damage_test", "Oleksy1121/Car-damage-detection")
for p in imgs(f"{RAW}/car_damage/umerforsure__Car-Damage-Detection/dataset"):
    put_image(p, "vehicle_damage", "mixed_damage_test", "umerforsure/Car-Damage-Detection")

# Flood (submerged vehicles)
for p in imgs(f"{RAW}/flood/ELindberg13__Flood_Depths"):
    put_image(p, "flood", "submerged_vehicle", "ELindberg13/Flood_Depths")
for p in imgs(f"{RAW}/flood/Trifurs__BEW-YOLOv8"):
    put_image(p, "flood", "submerged_vehicle", "Trifurs/BEW-YOLOv8")

# Tyres
ty = f"{RAW}/tyre/Arsalanzabeeb786__Tyre-Helath-Quality-Prediction/dataset"
for cls in ["defective", "perfect"]:
    for p in sample([x for x in imgs(ty) if f"/{cls}/" in x], 450):
        put_image(p, "tyre", cls, "Arsalanzabeeb786/Tyre-Helath-Quality-Prediction")
for p in imgs(f"{RAW}/tyre/wisetrue95__Tire"):
    put_image(p, "tyre", "wear_examples", "wisetrue95/Tire")

# Malaysian plates
ip = f"{RAW}/plates/iNusz__Malaysia_LicensePlate"
for p in sample([x for x in imgs(ip) if "Image_Original" in x], 500):
    put_image(p, "plates_my", "real_plate_photo", "iNusz/Malaysia_LicensePlate")
for p in imgs(f"{RAW}/plates/Sehba1__Malaysian-License-Plate-Recognition-State-Identification-System"):
    put_image(p, "plates_my", "real_plate_photo", "Sehba1/Malaysian-License-Plate-Recognition-State-Identification-System")
for p in sample(imgs(f"{RAW}/plates/Nexlson__Malaysia_License_Plate_Generator"), 120):
    put_image(p, "plates_my", "synthetic_plate", "Nexlson/Malaysia_License_Plate_Generator")
for p in imgs(f"{RAW}/plates/afeefabubakar__License-Plate-Detection-with-OpenCV"):
    put_image(p, "plates_my", "real_plate_photo", "afeefabubakar/License-Plate-Detection-with-OpenCV")
gen = f"{OUT}/tools/plate_generator"; os.makedirs(gen, exist_ok=True)
for f in glob.glob(f"{RAW}/plates/Nexlson__Malaysia_License_Plate_Generator/*.py"):
    shutil.copy(f, gen)
print("images done", len(manifest))

# ---------------- AUDIO ----------------
def put_audio(src, label, source, clip_s=5, max_clips=8, _count={}):
    d = os.path.join(OUT, "audio", slug(label)); os.makedirs(d, exist_ok=True)
    try:
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                   capture_output=True, text=True).stdout.strip() or 0)
    except Exception:
        return
    if dur <= 0: return
    starts = [0.0] if dur <= clip_s * 1.5 else list(np.arange(0, dur - clip_s, clip_s))[:max_clips]
    for st in starts:
        n = _count.get(label, 0)
        dst = os.path.join(d, f"{slug(source.split('/')[1])[:14]}_{n:05d}.wav")
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(st), "-t", str(clip_s), "-i", src,
                            "-ac", "1", "-ar", "16000", "-vn", dst], capture_output=True)
        if r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 4000:
            _count[label] = n + 1
            add(dst, "audio", label, source, os.path.relpath(src, RAW) if src.startswith(RAW) else src, "audio",
                {"clip_start_s": round(float(st), 2), "clip_len_s": clip_s})

aw = f"{RAW}/audio/AwaisSabit__Car-Engine-Sounds-Dataset"
for f in sorted(glob.glob(f"{aw}/Normal Car Sounds/*")):
    put_audio(f, "engine_normal_idle", "AwaisSabit/Car-Engine-Sounds-Dataset", max_clips=3)
for f in sorted(glob.glob(f"{aw}/Abnormal Car Sounds/*")):
    name = os.path.basename(f).lower()
    lab = "engine_knocking" if "knock" in name else ("engine_ticking" if "tick" in name else "engine_abnormal_other")
    put_audio(f, lab, "AwaisSabit/Car-Engine-Sounds-Dataset", max_clips=3)
# DB1 segmented fault sounds (category/fault/clip)
for f in sorted(glob.glob("/tmp/db1/**/*", recursive=True)):
    if os.path.splitext(f)[1].lower() in AUD_EXT:
        parts = os.path.relpath(f, "/tmp/db1").split("/")
        lab = "fault_" + slug(parts[-2] if len(parts) > 1 else parts[0])
        put_audio(f, lab, "amrrashed/Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition", max_clips=4)
# DB1 long recordings for classes not in the segmented zip
db1 = f"{RAW}/audio/amrrashed__Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition/Datasets/DB1"
for cls in sorted(os.listdir(db1)):
    for f in glob.glob(os.path.join(db1, cls, "*")):
        if os.path.splitext(f)[1].lower() in AUD_EXT:
            put_audio(f, "fault_" + slug(cls), "amrrashed/Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition", max_clips=6)
# DB2: vehicle-relevant environmental classes only (lane background / negatives)
db2 = f"{RAW}/audio/amrrashed__Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition/Datasets/DB2"
for cls in ["truck", "bus", "car horn", "truck horn", "motorcycle", "drilling", "car crashes"]:
    for f in sorted(glob.glob(os.path.join(db2, cls, "*")))[:25]:
        if os.path.splitext(f)[1].lower() in AUD_EXT:
            put_audio(f, "background_" + slug(cls), "amrrashed/Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition", max_clips=1)
# KaroDievas per-brand engine recordings
kd = f"{RAW}/audio/KaroDievas__car-sound-classification-with-keras"
for f in sorted(glob.glob(f"{kd}/**/*", recursive=True)):
    if os.path.splitext(f)[1].lower() in AUD_EXT:
        brand = slug(os.path.basename(os.path.dirname(f)))
        put_audio(f, "engine_recording_" + brand, "KaroDievas/car-sound-classification-with-keras", max_clips=4)
for f in sorted(glob.glob(f"{RAW}/audio/artem111-oss__car-diagnosis/**/*", recursive=True)):
    if os.path.splitext(f)[1].lower() in AUD_EXT:
        put_audio(f, "fault_misc", "artem111-oss/car-diagnosis", max_clips=4)
print("audio done", len(manifest))


json.dump(manifest, open(CK, "w"))

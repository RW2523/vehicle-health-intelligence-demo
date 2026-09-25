"""Acoustic fault classifier (feature 13) and engine fingerprint / identity check (feature 14).

Trained on the real curated clips in data/curated/audio (16 kHz, 5 s). Classes are grouped into what a lane
examiner can act on. Several source classes have only 1-2 clips, so the metrics are reported per class and the
demo labels this as "enough to demo, not to claim accuracy".
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import audio

GROUPS = {
    "normal_engine": ["engine_normal_idle", "engine_recording_multi_brand"],
    "engine_knock": ["engine_knocking", "fault_knocking", "fault_pre_ignition", "fault_thrown_rod"],
    "valve_tick": ["engine_ticking", "fault_lifter_ticking"],
    "wheel_bearing_or_suspension": ["fault_bad_wheal_bearing", "fault_bad_cv_joint", "fault_turning_front_end_clicking_bad_cv_axle",
                                    "fault_suspension_and_steering_issues", "fault_suspension_arm_fault", "fault_strut_mount_failure",
                                    "fault_clunking_over_bumps_bad_stabilizer_link_", "fault_stearing_groaning_whining_low_power_stee",
                                    "fault_stearing_noise", "fault_universal_joint_failure_or_steering_rack"],
    "belt_or_accessory": ["fault_belt_and_accessory_issues", "fault_squeaky_belt", "fault_engine_chriping_squealing_belt",
                          "fault_radiator_fan_failure"],
    "exhaust_or_fuel": ["fault_exhaust_and_fuel_system_issue", "fault_muffler_running_loud_exhaust_leak",
                        "fault_loose_exhaust_shield", "fault_vacuum_leak", "fault_fuel_pump_cartridge_fault"],
    "brake_noise": ["fault_braking_system_issues", "fault_squeaky_brake_grinding_brake"],
    "powertrain_other": ["fault_engine_and_powertrain_issues", "engine_abnormal_other", "fault_engine_misfire",
                         "fault_engine_rattle_noise", "fault_bad_transimision", "fault_seized_engin", "fault_flooded_engin",
                         "fault_misc", "fault_miscellaneous_issues", "fault_problem_6", "fault_general_vehicle_sounds"],
    "lane_background": ["background_bus", "background_car_crashes", "background_car_horn", "background_drilling",
                        "background_motorcycle", "background_truck", "background_truck_horn"],
}
LABELS = {
    "normal_engine": "Normal engine sound", "engine_knock": "Engine knock", "valve_tick": "Valve / lifter tick",
    "wheel_bearing_or_suspension": "Wheel bearing / suspension noise", "belt_or_accessory": "Belt or accessory squeal",
    "exhaust_or_fuel": "Exhaust or fuel-system noise", "brake_noise": "Brake grinding / squeal",
    "powertrain_other": "Other powertrain fault", "lane_background": "Lane background noise",
}
CAP_PER_FOLDER = 180


def group_of(folder: str) -> str | None:
    for g, folders in GROUPS.items():
        if folder in folders:
            return g
    return None


def _dataset(data_dir: Path):
    rng = np.random.default_rng(0)
    X, y, files = [], [], []
    for d in sorted((data_dir / "audio").iterdir()):
        g = group_of(d.name)
        if not g or not d.is_dir():
            continue
        fs = sorted(d.glob("*.wav"))
        if len(fs) > CAP_PER_FOLDER:
            fs = list(rng.choice(fs, CAP_PER_FOLDER, replace=False))
        for f in fs:
            try:
                X.append(audio.features(audio.load_wav(f)))
                y.append(g)
                files.append(str(f.relative_to(data_dir)))
            except (ValueError, OSError):
                continue
    return np.array(X), np.array(y), files


def train(data_dir: Path, out: Path) -> dict:
    X, y, files = _dataset(data_dir)
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=0.5, class_weight="balanced"))
    cv = StratifiedKFold(n_splits=4, shuffle=True, random_state=0)
    # classes with < 4 clips cannot be stratified; they are still trained on, just not scored in CV
    keep = np.isin(y, [c for c in np.unique(y) if (y == c).sum() >= 4])
    pred = cross_val_predict(clf, X[keep], y[keep], cv=cv)
    per_class = {c: round(float(f1_score(y[keep] == c, pred == c)), 3) for c in np.unique(y[keep])}
    clf.fit(X, y)
    # Fingerprint space: PCA over standardised features of engine clips
    engine_mask = np.isin(y, ["normal_engine", "engine_knock", "valve_tick", "powertrain_other"])
    fp = make_pipeline(StandardScaler(), PCA(n_components=32, random_state=0)).fit(X[engine_mask])
    thr, eer = _calibrate_fingerprint(data_dir, files, y, fp)
    joblib.dump({"clf": clf, "fp": fp, "threshold": thr}, out / "acoustic.joblib")
    metrics = {"clips": int(len(y)), "classes": {c: int((y == c).sum()) for c in np.unique(y)},
               "cv_accuracy": round(float(accuracy_score(y[keep], pred)), 3),
               "cv_macro_f1": round(float(f1_score(y[keep], pred, average="macro")), 3), "cv_f1_per_class": per_class,
               "fingerprint_threshold": round(thr, 3), "fingerprint_eer": round(eer, 3)}
    (out / "acoustic_metrics.json").write_text(json.dumps(metrics, indent=1))
    return metrics


def _calibrate_fingerprint(data_dir: Path, files, y, fp) -> tuple[float, float]:
    """Same engine = the two halves of one recording; different engine = halves of different recordings.
    Pick the threshold at the equal-error rate."""
    rng = np.random.default_rng(1)
    eng = [f for f, g in zip(files, y) if g == "normal_engine"]
    eng = list(rng.choice(eng, min(120, len(eng)), replace=False))
    halves = []
    for f in eng:
        x = audio.load_wav(data_dir / f)
        a, b = x[: len(x) // 2], x[len(x) // 2:]
        halves.append((embed_raw(fp, a), embed_raw(fp, b)))
    same = [cos(a, b) for a, b in halves]
    diff = [cos(halves[i][0], halves[j][1]) for i, j in rng.integers(0, len(halves), (400, 2)) if i != j]
    best = (0.5, 1.0, 0.5)
    for t in np.linspace(-0.2, 1.0, 121):
        frr = np.mean(np.array(same) < t)
        far = np.mean(np.array(diff) >= t)
        if abs(frr - far) < best[1]:
            best = (float(t), abs(frr - far), float((frr + far) / 2))
    return best[0], best[2]


def embed_raw(fp, x: np.ndarray) -> np.ndarray:
    return fp.transform(audio.features(x)[None])[0]


def cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


class AcousticModel:
    def __init__(self, path: Path):
        d = joblib.load(path)
        self.clf, self.fp, self.threshold = d["clf"], d["fp"], d["threshold"]

    def classify(self, wav: str | Path) -> dict:
        x = audio.load_wav(wav)
        p = self.clf.predict_proba(audio.features(x)[None])[0]
        order = np.argsort(p)[::-1]
        classes = self.clf.classes_
        ranked = [{"class": classes[i], "label": LABELS.get(classes[i], classes[i]), "p": round(float(p[i]), 3)}
                  for i in order[:4]]
        # Where in the clip the fault energy concentrates (for the spectrogram highlight): loudest 1 s window
        rms = np.sqrt(np.convolve(x ** 2, np.ones(1600) / 1600, mode="valid"))
        peak_t = float(np.argmax(rms) / audio.SR)
        return {"top": ranked[0], "ranked": ranked, "spectrogram": audio.band_energy_profile(x),
                "highlight_s": [max(0.0, peak_t - 0.5), min(5.0, peak_t + 0.5)]}

    def embed(self, wav: str | Path) -> np.ndarray:
        return embed_raw(self.fp, audio.load_wav(wav))

    def compare(self, wav_now: str | Path, wav_refs: list[str | Path]) -> dict:
        now = self.embed(wav_now)
        sims = [cos(now, self.embed(r)) for r in wav_refs]
        c = float(np.mean(sims)) if sims else float("nan")
        # report on a 0..1 scale (cosine -1..1 mapped linearly); the threshold is mapped the same way
        s, thr = (c + 1) / 2, (self.threshold + 1) / 2
        return {"similarity": round(s, 3), "threshold": round(thr, 3), "cosine": round(c, 3),
                "engine_changed": bool(sims) and c < self.threshold, "n_refs": len(sims)}

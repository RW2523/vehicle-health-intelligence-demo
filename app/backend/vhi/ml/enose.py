"""Electronic-nose classifier (feature 12): XGBoost on real UCI gas-sensor-array data.

The demo e-nose streams are synthetic (no public vehicle e-nose data exists) and are shaped from real UCI gas
class signatures (see sessions/enose_signature_library.json). The classifier is trained on the real UCI
steady-state responses of the 16 sensors, normalised to a unit "shape" so that concentration does not matter,
and evaluated on later batches to show sensor drift honestly.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score
from xgboost import XGBClassifier

CHANNELS = [f"f{1 + 8 * s}" for s in range(16)]  # steady-state resistance change of each of the 16 sensors
UCI_GAS = ["ethanol", "ethylene", "ammonia", "acetaldehyde", "acetone", "toluene"]


def library(sessions_dir: Path) -> dict:
    return json.loads((sessions_dir / "enose_signature_library.json").read_text())


def shape(v: np.ndarray) -> np.ndarray:
    m = np.abs(v).max(axis=-1, keepdims=True)
    return v / np.where(m == 0, 1, m)


def train(data_dir: Path, out: Path) -> dict:
    df = pd.read_parquet(data_dir / "sensors/gas_sensor_array_uci_drift/gas_sensor_drift.parquet")
    X = shape(df[CHANNELS].to_numpy(dtype=float))
    y = df["gas"].map({g: i for i, g in enumerate(UCI_GAS)}).to_numpy()
    # Drift-aware evaluation: train on batches 1-7, test on the later batches 8-10
    tr, te = df.batch <= 7, df.batch > 7
    m = XGBClassifier(n_estimators=250, max_depth=5, learning_rate=0.1, subsample=0.9, colsample_bytree=0.9,
                      eval_metric="mlogloss", random_state=0, n_jobs=2)
    m.fit(X[tr], y[tr])
    acc_drift = accuracy_score(y[te], m.predict(X[te]))
    rng = np.random.default_rng(0)
    idx = rng.permutation(len(X))
    cut = int(len(X) * 0.8)
    m2 = XGBClassifier(n_estimators=250, max_depth=5, learning_rate=0.1, subsample=0.9, colsample_bytree=0.9,
                       eval_metric="mlogloss", random_state=0, n_jobs=2).fit(X[idx[:cut]], y[idx[:cut]])
    acc_random = accuracy_score(y[idx[cut:]], m2.predict(X[idx[cut:]]))
    m.fit(X, y)  # final model on all batches
    joblib.dump(m, out / "enose.joblib")
    metrics = {"rows": int(len(X)), "holdout_accuracy_random_split": round(float(acc_random), 3),
               "holdout_accuracy_later_batches_drift": round(float(acc_drift), 3), "classes": UCI_GAS}
    (out / "enose_metrics.json").write_text(json.dumps(metrics, indent=1))
    return metrics


class ENoseModel:
    """Finds odour events in a 16-channel stream and classifies each one."""

    def __init__(self, path: Path, sessions_dir: Path):
        self.m = joblib.load(path)
        lib = library(sessions_dir)
        self.gas_to_condition = {v["uci_gas"]: k for k, v in lib.items()}

    def analyse(self, t: np.ndarray, x: np.ndarray, humidity: float = 0.8) -> dict:
        """t: seconds (n,), x: channels (n, 16). Returns detected events with condition probabilities."""
        if len(x) < 8:
            return {"events": [], "baseline": None}
        # humidity / drift compensation: subtract a slow rolling baseline (rolling 20th percentile over 60 s)
        df = pd.DataFrame(x)
        base = df.rolling(120, min_periods=1).quantile(0.2).to_numpy()
        base = np.minimum(base, np.median(x[: min(40, len(x))], axis=0))
        r = x - base
        mag = np.linalg.norm(r, axis=1)
        noise = np.median(mag) + 3 * (np.median(np.abs(mag - np.median(mag))) * 1.4826 + 1e-6)
        thr = max(0.12, noise)
        on = mag > thr
        events = []
        i = 0
        while i < len(on):
            if on[i]:
                j = i
                while j < len(on) and on[j]:
                    j += 1
                if j - i >= 6:  # at least 3 s at 2 Hz
                    seg = slice(i, j)
                    k = i + int(np.argmax(mag[seg]))
                    win = r[max(i, k - 4): min(j, k + 5)].mean(axis=0)
                    p = self.m.predict_proba(shape(win)[None])[0]
                    order = np.argsort(p)[::-1]
                    peak = float(mag[k])
                    events.append({
                        "start_s": float(t[i]), "end_s": float(t[j - 1]), "peak_s": float(t[k]),
                        "intensity": round(peak, 3),
                        "level": "high" if peak > 0.8 else ("medium" if peak > 0.35 else "trace"),
                        "condition": self.gas_to_condition.get(UCI_GAS[order[0]], UCI_GAS[order[0]]),
                        "proxy_gas": UCI_GAS[order[0]], "p": round(float(p[order[0]]), 3),
                        "ranked": [{"condition": self.gas_to_condition.get(UCI_GAS[o], UCI_GAS[o]), "p": round(float(p[o]), 3)}
                                   for o in order[:3]],
                    })
                i = j
            else:
                i += 1
        return {"events": events, "threshold": round(float(thr), 3), "humidity_compensated": True,
                "humidity": humidity}

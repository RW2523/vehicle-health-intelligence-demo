"""HQ analytics: examiner integrity (feature 26) and lane-equipment predictive maintenance (feature 31).

Both are computed live from the history tables (seconds), not pre-baked.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

# A PASS is "in conflict with the evidence" when the recorded measurements breach a fail threshold.
CONFLICT_RULES = [
    ("brake_efficiency_pct", lambda s, heavy: s < np.where(heavy, 45, 50)),
    ("brake_imbalance_pct", lambda s, heavy: s > 30),
    ("tyre_tread_min_mm", lambda s, heavy: s < 1.6),
    ("smoke_opacity_pct", lambda s, heavy: s > 50),
    ("suspension_efficiency_pct", lambda s, heavy: s < 40),
    ("corrosion_score_0_10", lambda s, heavy: s >= 8),
]


def examiner_integrity(ins: pd.DataFrame, veh: pd.DataFrame, examiners: pd.DataFrame) -> dict:
    df = ins.merge(veh[["vehicle_id", "heavy"]], on="vehicle_id", how="left")
    df["heavy"] = df["heavy"].fillna(False).astype(bool)
    df["passed"] = df["result"].eq("PASS")
    breach = np.zeros(len(df), dtype=bool)
    for col, rule in CONFLICT_RULES:
        vals = pd.to_numeric(df[col], errors="coerce").to_numpy()
        with np.errstate(invalid="ignore"):
            breach |= np.nan_to_num(rule(vals, df["heavy"].to_numpy()), nan=0).astype(bool)
    df["conflict"] = df["passed"] & breach
    df["override"] = df["examiner_override_flag"].fillna(False).astype(bool)
    rows = []
    for cls, g in df.groupby("heavy"):
        per = g.groupby("examiner_id").agg(n=("passed", "size"), pass_rate=("passed", "mean"),
                                           conflict_rate=("conflict", "mean"), override_rate=("override", "mean"),
                                           minutes=("duration_min", "mean"))
        per = per[per.n >= 15]
        mu, sd = per.pass_rate.mean(), per.pass_rate.std(ddof=0) or 1e-9
        per["z_pass"] = (per.pass_rate - mu) / sd
        per["vehicle_class"] = "heavy" if cls else "light"
        rows.append(per.reset_index())
    t = pd.concat(rows, ignore_index=True)
    feats = t[["z_pass", "conflict_rate", "override_rate", "minutes"]].fillna(0).to_numpy()
    iso = IsolationForest(n_estimators=300, contamination=0.04, random_state=0).fit(feats)
    t["anomaly_score"] = -iso.score_samples(feats)
    t["isolation_flag"] = iso.predict(feats) == -1
    t["outlier"] = (t.z_pass >= 2.5) | (t.isolation_flag & (t.conflict_rate > t.conflict_rate.median() * 3 + 0.01))
    names = examiners.set_index("examiner_id")["name"].to_dict() if len(examiners) else {}
    t["name"] = t.examiner_id.map(names)
    t = t.sort_values(["outlier", "z_pass"], ascending=[False, False])
    out = t.round(4).to_dict("records")
    flagged = sorted({r["examiner_id"] for r in out if r["outlier"]})
    evid = df[df.examiner_id.isin(flagged) & df.conflict].sort_values("date", ascending=False)
    return {"examiners": out, "flagged": flagged,
            "evidence": evid[["inspection_id", "examiner_id", "vehicle_id", "date", "inspection_type", "brake_efficiency_pct",
                              "tyre_tread_min_mm", "smoke_opacity_pct", "result"]].head(40).to_dict("records"),
            "method": "Peer z-score of pass rate within vehicle class + Isolation Forest on (z, evidence-conflict rate, "
                      "override rate, inspection minutes)"}


def equipment_health(tel: pd.DataFrame) -> dict:
    tel = tel.copy()
    tel["date"] = pd.to_datetime(tel["date"])
    out = []
    for dev_type, g in tel.groupby("device"):
        early = g[g.date <= g.date.min() + pd.Timedelta(days=30)]
        feats = ["vibration_rms_g", "temp_c", "calibration_offset_pct"]
        iso = IsolationForest(n_estimators=200, contamination=0.02, random_state=0).fit(early[feats])
        vib_limit = float(early.vibration_rms_g.quantile(0.99) * 1.6)
        for (br, lane), d in g.groupby(["branch_id", "lane"]):
            d = d.sort_values("date")
            recent = d.tail(14)
            score = float((-iso.score_samples(recent[feats])).mean())
            x = (recent.date - recent.date.min()).dt.days.to_numpy()
            b, a = np.polyfit(x, recent.vibration_rms_g.to_numpy(), 1) if len(x) > 2 else (0.0, recent.vibration_rms_g.iloc[-1])
            now = float(a + b * x[-1])
            days = (vib_limit - now) / b if b > 1e-4 else np.inf
            health = float(np.clip(100 - (score - 0.40) * 250 - max(0.0, (now / vib_limit - 0.6)) * 100, 3, 100))
            out.append({
                "branch_id": br, "lane": int(lane), "device": dev_type, "health": round(health),
                "anomaly_score": round(score, 3), "vibration_now_g": round(now, 3), "vibration_limit_g": round(vib_limit, 3),
                "trend_g_per_day": round(float(b), 4),
                "days_to_limit": None if not np.isfinite(days) else round(float(max(0.0, days)), 1),
                "service_by": None if not np.isfinite(days) else (d.date.max() + pd.Timedelta(days=float(max(0.0, days)))).date().isoformat(),
                "series": [{"date": r.date.date().isoformat(), "vibration": round(r.vibration_rms_g, 3),
                            "temp": round(r.temp_c, 1), "offset": round(r.calibration_offset_pct, 2)} for r in d.tail(60).itertuples()],
            })
    out.sort(key=lambda r: r["health"])
    return {"devices": out, "method": "Isolation Forest per device type (trained on the first 30 days) + vibration trend "
                                      "to the 99th-percentile x1.6 limit"}

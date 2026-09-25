"""Fusion Vehicle Health Score (feature 19), flood-damage model (18) and next-inspection fail risk (20).

* Health score: LightGBM on every lane measurement, trained on 13.9k synthetic inspections to predict FAIL.
  Score = 100 x (1 - P(fail)); sub-scores per subsystem come from the model's exact tree SHAP contributions.
  A transparent rule layer adds the signals the history does not contain (e-nose, acoustics, thermal, flood,
  identity); every rule and its points are returned so the examiner sees why.
* Flood: LightGBM on vehicle-level signals (corrosion, flood claims, HV isolation, SOH gap, state) against the
  synthetic ground truth.
* Next-fail risk: LightGBM on consecutive inspection pairs (measurements now -> FAIL at the next visit), plus a
  Weibull AFT survival model (lifelines) for months until the first failed inspection.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

FEATURES = [
    "age_years", "heavy", "is_diesel", "is_ev", "odometer_log",
    "brake_efficiency_pct", "brake_imbalance_pct", "brake_drag_pct",
    "suspension_efficiency_pct", "side_slip_m_per_km",
    "headlamp_aim_dev_pct", "speedo_error_pct", "tint_vlt_front_pct",
    "tyre_tread_min_mm", "tyre_pressure_low",
    "smoke_opacity_pct", "pn_log", "co_pct", "hc_ppm", "n_dtcs", "obd_mil_on",
    "ev_soh_pct", "hv_isolation_mohm", "corrosion_score_0_10", "structural_anomaly",
]
SYSTEM_OF = {
    "brake_efficiency_pct": "Brakes", "brake_imbalance_pct": "Brakes", "brake_drag_pct": "Brakes",
    "tyre_tread_min_mm": "Tyres", "tyre_pressure_low": "Tyres",
    "suspension_efficiency_pct": "Suspension", "side_slip_m_per_km": "Suspension",
    "smoke_opacity_pct": "Engine & emissions", "pn_log": "Engine & emissions", "co_pct": "Engine & emissions",
    "hc_ppm": "Engine & emissions", "n_dtcs": "Engine & emissions", "obd_mil_on": "Engine & emissions",
    "headlamp_aim_dev_pct": "Lights & body", "tint_vlt_front_pct": "Lights & body",
    "corrosion_score_0_10": "Lights & body", "structural_anomaly": "Lights & body", "speedo_error_pct": "Lights & body",
    "ev_soh_pct": "EV battery & electrics", "hv_isolation_mohm": "EV battery & electrics",
}
SYSTEMS = ["Brakes", "Tyres", "Suspension", "Engine & emissions", "Lights & body", "EV battery & electrics"]
PRETTY = {
    "brake_efficiency_pct": "Brake efficiency", "brake_imbalance_pct": "Brake imbalance", "brake_drag_pct": "Brake drag",
    "suspension_efficiency_pct": "Suspension efficiency", "side_slip_m_per_km": "Side slip",
    "headlamp_aim_dev_pct": "Headlamp aim", "speedo_error_pct": "Speedometer error", "tint_vlt_front_pct": "Window tint VLT",
    "tyre_tread_min_mm": "Tyre tread", "tyre_pressure_low": "Tyre pressure", "smoke_opacity_pct": "Smoke opacity",
    "pn_log": "Particle number", "co_pct": "CO", "hc_ppm": "HC", "n_dtcs": "OBD fault codes", "obd_mil_on": "Check-engine lamp",
    "ev_soh_pct": "Battery state of health", "hv_isolation_mohm": "HV isolation", "corrosion_score_0_10": "Corrosion",
    "structural_anomaly": "Structural anomaly", "age_years": "Vehicle age", "heavy": "Heavy vehicle", "is_diesel": "Diesel",
    "is_ev": "Electric", "odometer_log": "Mileage",
}
FLOOD_STATES = {"Kelantan", "Terengganu", "Pahang", "Johor", "Selangor", "Kedah", "Perlis", "Sabah"}


def _num(v, default=np.nan) -> float:
    try:
        f = float(v)
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def feature_row(m: dict, vehicle: dict, today_year: int = 2026) -> dict:
    """Map an inspection's measurements (+ vehicle) to model features. Missing values stay NaN."""
    dtcs = m.get("obd_dtcs") or ""
    n_dtcs = len([d for d in (dtcs.split(",") if isinstance(dtcs, str) else dtcs) if d])
    pn = _num(m.get("pn_per_cm3"))
    return {
        "age_years": today_year - int(vehicle.get("year", today_year)),
        "heavy": float(bool(vehicle.get("heavy"))),
        "is_diesel": float(vehicle.get("fuel") == "diesel"), "is_ev": float(vehicle.get("fuel") == "ev"),
        "odometer_log": math.log10(max(1000, _num(m.get("odometer_km"), vehicle.get("odometer_km", 1000) or 1000))),
        "brake_efficiency_pct": _num(m.get("brake_efficiency_pct")), "brake_imbalance_pct": _num(m.get("brake_imbalance_pct")),
        "brake_drag_pct": _num(m.get("brake_drag_pct")), "suspension_efficiency_pct": _num(m.get("suspension_efficiency_pct")),
        "side_slip_m_per_km": abs(_num(m.get("side_slip_m_per_km"))), "headlamp_aim_dev_pct": abs(_num(m.get("headlamp_aim_dev_pct"))),
        "speedo_error_pct": abs(_num(m.get("speedo_error_pct"))), "tint_vlt_front_pct": _num(m.get("tint_vlt_front_pct")),
        "tyre_tread_min_mm": _num(m.get("tyre_tread_min_mm")), "tyre_pressure_low": float(bool(m.get("tyre_pressure_low"))),
        "smoke_opacity_pct": _num(m.get("smoke_opacity_pct")), "pn_log": math.log10(pn) if pn and pn > 0 else np.nan,
        "co_pct": _num(m.get("co_pct")), "hc_ppm": _num(m.get("hc_ppm")), "n_dtcs": float(n_dtcs),
        "obd_mil_on": float(bool(m.get("obd_mil_on"))), "ev_soh_pct": _num(m.get("ev_soh_pct")),
        "hv_isolation_mohm": _num(m.get("hv_isolation_mohm")), "corrosion_score_0_10": _num(m.get("corrosion_score_0_10")),
        "structural_anomaly": float(bool(m.get("structural_anomaly"))),
    }


def _frame(ins: pd.DataFrame, veh: pd.DataFrame) -> pd.DataFrame:
    vcols = veh.set_index("vehicle_id")[["year", "heavy", "fuel", "odometer_km"]].to_dict("index")
    rows = [feature_row(r, vcols.get(r["vehicle_id"], {}), int(str(r["date"])[:4])) for r in ins.to_dict("records")]
    return pd.DataFrame(rows, columns=FEATURES)


PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=31, min_data_in_leaf=30, feature_fraction=0.9,
              bagging_fraction=0.9, bagging_freq=1, verbose=-1, seed=0, num_threads=2)


def train(ins: pd.DataFrame, veh: pd.DataFrame, claims: pd.DataFrame, out: Path) -> dict:
    ins = ins.sort_values("date").reset_index(drop=True)
    X = _frame(ins, veh)
    y = (ins["result"] == "FAIL").astype(int).to_numpy()
    cut = int(len(X) * 0.8)  # time-based split: train on the older 80%
    m = lgb.train(PARAMS, lgb.Dataset(X.iloc[:cut], y[:cut]), num_boost_round=400)
    auc = roc_auc_score(y[cut:], m.predict(X.iloc[cut:]))
    health = lgb.train(PARAMS, lgb.Dataset(X, y), num_boost_round=400)
    health.save_model(str(out / "health_lgbm.txt"))
    # Features that every historical inspection measured: if a live lane does not measure one (e.g. tread depth has
    # no scanner in the demo lane), fill it with the median of passing vehicles instead of letting the model read the
    # gap as a failure. The report lists which values were filled.
    always = [f for f in FEATURES if X[f].isna().mean() < 0.01]
    impute = {f: float(X.loc[y == 0, f].median()) for f in always}
    (out / "fusion_impute.json").write_text(json.dumps(impute, indent=1))

    # ---- next-inspection fail risk: features at visit k -> FAIL at visit k+1
    ins["next_result"] = ins.groupby("vehicle_id")["result"].shift(-1)
    ins["next_date"] = ins.groupby("vehicle_id")["date"].shift(-1)
    pairs = ins[ins.next_result.notna()].reset_index(drop=True)
    Xp = _frame(pairs, veh)
    Xp["prev_fail"] = (pairs["result"] == "FAIL").astype(float)
    yp = (pairs["next_result"] == "FAIL").astype(int).to_numpy()
    cutp = int(len(Xp) * 0.8)
    mp = lgb.train(PARAMS, lgb.Dataset(Xp.iloc[:cutp], yp[:cutp]), num_boost_round=300)
    auc_next = roc_auc_score(yp[cutp:], mp.predict(Xp.iloc[cutp:]))
    nextfail = lgb.train(PARAMS, lgb.Dataset(Xp, yp), num_boost_round=300)
    nextfail.save_model(str(out / "nextfail_lgbm.txt"))

    # ---- survival: months from each visit to the next FAIL (censored at the last visit)
    surv = _survival_frame(ins, veh)
    from lifelines import WeibullAFTFitter

    aft = WeibullAFTFitter(penalizer=0.05)
    aft.fit(surv, duration_col="months", event_col="event")
    joblib.dump(aft, out / "survival_aft.joblib")
    c_index = float(aft.concordance_index_)

    # ---- flood model (vehicle level)
    fl, fy = flood_frame(ins, veh, claims)
    cutf = int(len(fl) * 0.75)
    idx = np.random.default_rng(0).permutation(len(fl))
    fparams = dict(PARAMS, num_leaves=15, min_data_in_leaf=15)
    mf = lgb.train(fparams, lgb.Dataset(fl.iloc[idx[:cutf]], fy[idx[:cutf]]), num_boost_round=250)
    auc_flood = roc_auc_score(fy[idx[cutf:]], mf.predict(fl.iloc[idx[cutf:]]))
    # honesty check: every synthetic flooded car also has a flood claim, so also score physical evidence alone
    phys = [c for c in FLOOD_FEATURES if c not in ("flood_claim", "any_claim_rm_log")]
    mfp = lgb.train(fparams, lgb.Dataset(fl.iloc[idx[:cutf]][phys], fy[idx[:cutf]]), num_boost_round=250)
    auc_phys = roc_auc_score(fy[idx[cutf:]], mfp.predict(fl.iloc[idx[cutf:]][phys]))
    # The live model uses physical evidence only; claim history is added afterwards as a transparent rule, because
    # in the synthetic data every flooded car has a flood claim (the claim feature alone would "solve" it).
    flood = lgb.train(fparams, lgb.Dataset(fl[phys], fy), num_boost_round=250)
    flood.save_model(str(out / "flood_lgbm.txt"))

    base_rate = float(y.mean())
    metrics = {"health": {"rows": int(len(X)), "fail_rate": round(base_rate, 3), "holdout_auc_time_split": round(float(auc), 3)},
               "next_fail": {"pairs": int(len(Xp)), "holdout_auc": round(float(auc_next), 3)},
               "survival": {"rows": int(len(surv)), "concordance": round(c_index, 3), "model": "Weibull AFT (lifelines)"},
               "flood": {"vehicles": int(len(fl)), "positives": int(fy.sum()), "holdout_auc": round(float(auc_flood), 3),
                         "holdout_auc_physical_evidence_only": round(float(auc_phys), 3),
                         "note": "synthetic labels: every flooded car has a flood claim, so the full AUC is optimistic"}}
    (out / "fusion_metrics.json").write_text(json.dumps(metrics, indent=1))
    return metrics


SURV_COLS = ["age_years", "heavy", "brake_efficiency_pct", "brake_imbalance_pct", "suspension_efficiency_pct",
             "tyre_tread_min_mm", "corrosion_score_0_10", "n_dtcs"]


def _survival_frame(ins: pd.DataFrame, veh: pd.DataFrame) -> pd.DataFrame:
    rows = []
    X = _frame(ins, veh)
    dates = pd.to_datetime(ins["date"])
    for vid, g in ins.groupby("vehicle_id"):
        idx = g.index.to_list()
        for a, i in enumerate(idx):
            later = idx[a + 1:]
            fail_at = next((j for j in later if ins.at[j, "result"] == "FAIL"), None)
            end = fail_at if fail_at is not None else (later[-1] if later else None)
            if end is None:
                continue
            months = max(0.5, (dates[end] - dates[i]).days / 30.44)
            r = {c: X.at[i, c] for c in SURV_COLS}
            r.update(months=months, event=int(fail_at is not None))
            rows.append(r)
    df = pd.DataFrame(rows)
    for c in SURV_COLS:
        df[c] = df[c].fillna(df[c].median() if df[c].notna().any() else 0)
    return df


FLOOD_FEATURES = ["age_years", "is_ev", "corrosion_max", "corrosion_last", "flood_claim", "any_claim_rm_log",
                  "hv_isolation_min", "soh_gap", "flood_state", "structural_any"]


def flood_frame(ins: pd.DataFrame, veh: pd.DataFrame, claims: pd.DataFrame):
    g = ins.groupby("vehicle_id")
    agg = pd.DataFrame({
        "corrosion_max": g.corrosion_score_0_10.max(), "corrosion_last": g.corrosion_score_0_10.last(),
        "hv_isolation_min": g.hv_isolation_mohm.min(), "soh_min": g.ev_soh_pct.min(),
        "structural_any": g.structural_anomaly.max().astype(float),
    })
    c = claims.copy()
    c["flood"] = c.claim_type.str.contains("flood")
    cagg = c.groupby("vehicle_id").agg(flood_claim=("flood", "max"), any_claim_rm=("amount_rm", "sum"))
    v = veh.set_index("vehicle_id")
    df = v[["year", "fuel", "state"]].join(agg, how="inner").join(cagg, how="left")
    out = pd.DataFrame({
        "age_years": 2026 - df.year, "is_ev": (df.fuel == "ev").astype(float),
        "corrosion_max": df.corrosion_max, "corrosion_last": df.corrosion_last,
        "flood_claim": df.flood_claim.fillna(False).astype(float),
        "any_claim_rm_log": np.log10(df.any_claim_rm.fillna(0) + 1),
        "hv_isolation_min": df.hv_isolation_min,
        "soh_gap": (100 - 2.2 * (2026 - df.year)) - df.soh_min,
        "flood_state": df.state.isin(FLOOD_STATES).astype(float), "structural_any": df.structural_any,
    }, index=df.index)
    y = v.loc[out.index, "gt_flood_damaged"].astype(int).to_numpy() if "gt_flood_damaged" in v else np.zeros(len(out))
    return out[FLOOD_FEATURES], y


class FusionModels:
    def __init__(self, models_dir: Path):
        self.health = lgb.Booster(model_file=str(models_dir / "health_lgbm.txt"))
        self.nextfail = lgb.Booster(model_file=str(models_dir / "nextfail_lgbm.txt"))
        self.flood = lgb.Booster(model_file=str(models_dir / "flood_lgbm.txt"))
        self.aft = joblib.load(models_dir / "survival_aft.joblib")
        p = models_dir / "fusion_impute.json"
        self.impute = json.loads(p.read_text()) if p.exists() else {}

    def _row(self, measurements: dict, vehicle: dict) -> tuple[pd.DataFrame, list[str]]:
        row = pd.DataFrame([feature_row(measurements, vehicle)], columns=FEATURES)
        filled = []
        for f, v in self.impute.items():
            if pd.isna(row.at[0, f]):
                row.at[0, f] = v
                filled.append(f)
        return row, filled

    # ---------- health score
    def health_score(self, measurements: dict, vehicle: dict, rules: list[dict] | None = None) -> dict:
        row, filled = self._row(measurements, vehicle)
        p = float(self.health.predict(row)[0])
        contrib = self.health.predict(row, pred_contrib=True)[0]
        base = float(contrib[-1])
        per_feat = dict(zip(FEATURES, contrib[:-1]))
        sys_logit = {s: 0.0 for s in SYSTEMS}
        for f, c in per_feat.items():
            if f in SYSTEM_OF:
                sys_logit[SYSTEM_OF[f]] += float(c)
        rules = rules or []
        penalties = {s: 0.0 for s in SYSTEMS}
        for r in rules:
            penalties[r["system"]] = penalties.get(r["system"], 0.0) + r["points"]
        sub = {}
        for s_ in SYSTEMS:
            ps = 1 / (1 + math.exp(-(base + sys_logit[s_])))
            sub[s_] = round(max(5.0, min(100.0, 100 * (1 - ps) - penalties.get(s_, 0.0))))
        model_score = 100 * (1 - p)
        score = max(5.0, min(100.0, model_score - sum(r["points"] for r in rules)))
        top = sorted(((f, float(c)) for f, c in per_feat.items() if f not in filled), key=lambda t: -abs(t[1]))[:6]
        return {
            "score": round(score), "model_score": round(model_score), "p_fail_model": round(p, 3),
            "subscores": sub,
            "factors": [{"feature": f, "label": PRETTY.get(f, f), "value": row.at[0, f] if not pd.isna(row.at[0, f]) else None,
                         "shap": round(c, 3), "direction": "raises risk" if c > 0 else "lowers risk"} for f, c in top],
            "rules": rules, "not_measured": [PRETTY.get(f, f) for f in filled],
        }

    # ---------- next-inspection risk + survival
    def next_fail(self, measurements: dict, vehicle: dict, failed_now: bool) -> dict:
        row, _ = self._row(measurements, vehicle)
        row["prev_fail"] = float(failed_now)
        p = float(self.nextfail.predict(row)[0])
        srow = row[SURV_COLS].copy()
        defaults = {"brake_efficiency_pct": 65, "brake_imbalance_pct": 8, "suspension_efficiency_pct": 68,
                    "tyre_tread_min_mm": 4.5, "corrosion_score_0_10": 2, "n_dtcs": 0}
        for c in SURV_COLS:
            if srow[c].isna().any():
                srow[c] = defaults.get(c, 0.0)
        med = float(self.aft.predict_median(srow).iloc[0])
        return {"p_fail_next": round(p, 3), "months_to_failure_median": round(min(med, 120.0), 1)}

    # ---------- flood
    def flood_probability(self, feats: dict) -> dict:
        cols = self.flood.feature_name()
        row = pd.DataFrame([{k: feats.get(k, np.nan) for k in cols}], columns=cols)
        p = float(self.flood.predict(row)[0])
        contrib = self.flood.predict(row, pred_contrib=True)[0][:-1]
        top = sorted(zip(cols, contrib), key=lambda t: -abs(t[1]))[:4]
        return {"p": round(p, 3), "factors": [{"feature": f, "shap": round(float(c), 3)} for f, c in top]}

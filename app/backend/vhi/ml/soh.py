"""EV battery health (feature 17).

* Pack SOH from the BMS module readout (simulated stream), weakest-module weighted, with a confidence band.
* A capacity-fade model fitted on the real NASA ageing data (B0005/6/7/18) projects the equivalent full cycles
  until the pack reaches 70% and 60% SOH.
* HV isolation is checked against the demo rule (< 2 MOhm advisory, < 0.5 MOhm fail) - live logic.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

KM_PER_CYCLE = 380  # a full-equivalent cycle of a ~60 kWh compact EV


def train(data_dir: Path, out: Path) -> dict:
    df = pd.read_csv(data_dir / "sensors/ev_battery_nasa/cycle_capacity_soh.csv")
    # fade rate (SOH points per cycle) as a function of the current SOH, from the real curves
    rows = []
    for _, g in df.groupby("battery"):
        g = g.sort_values("cycle")
        soh = g.soh_pct.rolling(5, min_periods=1).mean().to_numpy()
        cyc = g.cycle.to_numpy()
        for i in range(len(g) - 10):
            rows.append((soh[i], (soh[i] - soh[i + 10]) / max(1, cyc[i + 10] - cyc[i])))
    fade = pd.DataFrame(rows, columns=["soh", "rate"])
    fade = fade[fade.rate > -0.5]
    m = GradientBoostingRegressor(n_estimators=150, max_depth=2, random_state=0).fit(fade[["soh"]], fade.rate)
    # capacity -> SOH regressor on discharge features (cross-check model, used by the self-test report)
    X = df[["v_min", "t_max_c", "discharge_time_s"]]
    y = df.soh_pct
    idx = np.random.default_rng(0).permutation(len(df))
    cut = int(0.8 * len(df))
    reg = GradientBoostingRegressor(n_estimators=200, max_depth=3, random_state=0).fit(X.iloc[idx[:cut]], y.iloc[idx[:cut]])
    mae = mean_absolute_error(y.iloc[idx[cut:]], reg.predict(X.iloc[idx[cut:]]))
    reg.fit(X, y)
    joblib.dump({"fade": m, "reg": reg}, out / "soh.joblib")
    metrics = {"nasa_rows": int(len(df)), "soh_from_discharge_mae_pct": round(float(mae), 2),
               "fade_rate_median_pct_per_cycle": round(float(fade.rate.median()), 4)}
    (out / "soh_metrics.json").write_text(json.dumps(metrics, indent=1))
    return metrics


class SOHModel:
    def __init__(self, path: Path):
        d = joblib.load(path)
        self.fade, self.reg = d["fade"], d["reg"]

    def cycles_to(self, soh_now: float, target: float) -> int:
        soh, n = soh_now, 0
        while soh > target and n < 20000:
            rate = max(0.002, float(self.fade.predict(pd.DataFrame({"soh": [soh]}))[0]))
            soh -= rate * 10
            n += 10
        return n

    def assess(self, modules: list[dict], hv_isolation_mohm: float | None, age_years: float) -> dict:
        s = np.array([m["soh_pct"] for m in modules], dtype=float)
        pack = float(0.6 * s.min() + 0.4 * s.mean())
        spread = float(s.max() - s.min())
        weakest = modules[int(np.argmin(s))]["cell_module"]
        c70 = self.cycles_to(pack, 70) if pack > 70 else 0
        c60 = self.cycles_to(pack, 60) if pack > 60 else 0
        expected = 100 - 2.2 * age_years  # typical calendar + cycle fade for Malaysian climate (assumption, shown)
        hv = None
        if hv_isolation_mohm is not None:
            hv = {"value_mohm": hv_isolation_mohm,
                  "verdict": "fail" if hv_isolation_mohm < 0.5 else ("marginal" if hv_isolation_mohm < 2.0 else "ok"),
                  "rule": "< 0.5 MOhm fail, < 2 MOhm advisory (demo rule)"}
        return {"pack_soh_pct": round(pack, 1), "mean_module_soh_pct": round(float(s.mean()), 1), "band_pct": [round(pack - 1.5 - spread / 4, 1), round(pack + 1.5, 1)],
                "module_spread_pct": round(spread, 1), "weakest_module": weakest,
                "expected_for_age_pct": round(expected, 1), "below_expected": pack < expected - 8,
                "cycles_to_70": c70, "km_to_70": c70 * KM_PER_CYCLE, "cycles_to_60": c60, "km_to_60": c60 * KM_PER_CYCLE,
                "hv_isolation": hv, "modules": modules}

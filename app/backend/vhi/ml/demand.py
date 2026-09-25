"""Demand forecasting (feature 28): LightGBM on daily booking requests per branch, 14 days ahead vs capacity."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

# Malaysian public holidays / festive days used as features (approximate national dates).
HOLIDAYS = {
    "2024-01-01", "2024-02-10", "2024-02-11", "2024-02-12", "2024-04-10", "2024-04-11", "2024-05-01", "2024-05-22",
    "2024-06-03", "2024-06-17", "2024-08-31", "2024-09-16", "2024-10-31", "2024-12-25",
    "2025-01-01", "2025-01-29", "2025-01-30", "2025-03-31", "2025-04-01", "2025-05-01", "2025-05-12", "2025-06-02",
    "2025-06-07", "2025-08-31", "2025-09-16", "2025-10-20", "2025-12-25",
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-03-20", "2026-03-21", "2026-05-01", "2026-05-27", "2026-05-31",
    "2026-06-01", "2026-08-31", "2026-09-16", "2026-11-08", "2026-12-25",
}
FEATS = ["branch_code", "dow", "dom", "month", "woy", "holiday", "near_holiday", "lag7", "lag14", "roll28", "cap"]


def _calendar(d: pd.Series) -> pd.DataFrame:
    dd = pd.to_datetime(d)
    hol = dd.dt.strftime("%Y-%m-%d").isin(HOLIDAYS)
    near = pd.Series(False, index=d.index)
    for k in (-2, -1, 1, 2):
        near |= (dd + pd.Timedelta(days=k)).dt.strftime("%Y-%m-%d").isin(HOLIDAYS)
    return pd.DataFrame({"dow": dd.dt.dayofweek, "dom": dd.dt.day, "month": dd.dt.month,
                         "woy": dd.dt.isocalendar().week.astype(int), "holiday": hol.astype(int), "near_holiday": near.astype(int)})


def _frame(b: pd.DataFrame) -> pd.DataFrame:
    b = b.sort_values(["branch_id", "date"]).copy()
    g = b.groupby("branch_id")["demand_requests"]
    b["lag7"] = g.shift(7)
    b["lag14"] = g.shift(14)
    b["roll28"] = g.transform(lambda s: s.shift(7).rolling(28, min_periods=7).mean())
    b["branch_code"] = b["branch_id"].str[2:].astype(int)
    b["cap"] = b["capacity_slots"]
    return pd.concat([b.reset_index(drop=True), _calendar(b["date"]).reset_index(drop=True)], axis=1)


def train(bookings: pd.DataFrame, out: Path) -> dict:
    f = _frame(bookings).dropna(subset=["lag14", "roll28"])
    cutoff = pd.to_datetime(f.date).max() - pd.Timedelta(days=28)
    tr = pd.to_datetime(f.date) <= cutoff
    params = dict(objective="regression_l1", learning_rate=0.05, num_leaves=31, min_data_in_leaf=20, verbose=-1,
                  seed=0, num_threads=2)
    m = lgb.train(params, lgb.Dataset(f.loc[tr, FEATS], f.loc[tr, "demand_requests"],
                                      categorical_feature=["branch_code"]), num_boost_round=500)
    pred = m.predict(f.loc[~tr, FEATS])
    act = f.loc[~tr, "demand_requests"].to_numpy()
    mape = float(np.mean(np.abs(pred - act) / np.maximum(act, 1)))
    naive = float(np.mean(np.abs(f.loc[~tr, "lag7"].to_numpy() - act) / np.maximum(act, 1)))
    final = lgb.train(params, lgb.Dataset(f[FEATS], f["demand_requests"], categorical_feature=["branch_code"]),
                      num_boost_round=500)
    final.save_model(str(out / "demand_lgbm.txt"))
    metrics = {"rows": int(len(f)), "holdout_days": 28, "holdout_mape": round(mape, 3),
               "naive_last_week_mape": round(naive, 3)}
    (out / "demand_metrics.json").write_text(json.dumps(metrics, indent=1))
    return metrics


class DemandModel:
    def __init__(self, path: Path):
        self.m = lgb.Booster(model_file=str(path))

    def forecast(self, bookings: pd.DataFrame, branch_id: str, days: int = 14, start: dt.date | None = None) -> list[dict]:
        hist = bookings[bookings.branch_id == branch_id].sort_values("date").copy()
        hist["date"] = pd.to_datetime(hist["date"])
        last = hist["date"].max()
        start = pd.Timestamp(start) if start else last + pd.Timedelta(days=1)
        cap = int(hist["capacity_slots"].iloc[-1])
        series = hist.set_index("date")["demand_requests"].astype(float).to_dict()
        out = []
        d = start
        while len(out) < days:
            lag = lambda k: series.get(d - pd.Timedelta(days=k), np.nan)  # noqa: E731
            vals = [series.get(d - pd.Timedelta(days=k)) for k in range(7, 35)]
            roll = float(np.nanmean([x for x in vals if x is not None])) if any(x is not None for x in vals) else np.nan
            cal = _calendar(pd.Series([d])).iloc[0]
            row = pd.DataFrame([{"branch_code": int(branch_id[2:]), "dow": cal.dow, "dom": cal.dom, "month": cal.month,
                                 "woy": cal.woy, "holiday": cal.holiday, "near_holiday": cal.near_holiday,
                                 "lag7": lag(7), "lag14": lag(14), "roll28": roll, "cap": cap}], columns=FEATS)
            y = float(max(0.0, self.m.predict(row)[0]))
            if cal.dow == 6:  # branches closed on Sundays in the synthetic world
                y = min(y, float(series.get(d - pd.Timedelta(days=7), y)))
            series[d] = y
            out.append({"date": d.date().isoformat(), "demand": round(y), "capacity": cap,
                        "gap": round(y - cap), "holiday": bool(cal.holiday)})
            d += pd.Timedelta(days=1)
        return out

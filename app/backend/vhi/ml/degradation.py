"""Degradation analysis for monthly condition readings (Fleet Intelligence, vehicle history).

For one metric series it finds, with robust statistics only (no labels needed):

* the **normal wear model** - a Theil-Sen line through the readings before the first anomaly;
* **anomalies** - spikes (jump and return), step changes (jump that stays), rate changes (the series leaves the
  normal wear model and keeps diverging), new damage (a flat-zero series that starts growing), and repairs;
* the **forecast** - a line through the last four readings, extrapolated to the fail limit, with a range from
  the rate running 25% faster or 20% slower, converted to a date and kilometres;
* the **pattern** label and a **risk** level for the attention list.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

import numpy as np
from scipy.stats import theilslopes

from ..fleet_metrics import Metric


@dataclass
class Point:
    idx: int
    date: str
    value: float
    note: str = ""
    photo: str | None = None
    source: str = ""


def _mad(a: np.ndarray) -> float:
    a = a[~np.isnan(a)]
    if len(a) == 0:
        return 0.0
    return float(np.median(np.abs(a - np.median(a))) * 1.4826)


def weeks_label(weeks: float) -> str:
    if not math.isfinite(weeks) or weeks > 52:
        return "> 1 year"
    if weeks <= 0.5:
        return "At limit now"
    return f"~{max(1, round(weeks))} weeks"


def analyse(points: list[Point], metric: Metric, km_per_month: int, today: dt.date) -> dict:
    v = np.array([p.value for p in points], dtype=float)
    n = len(v)
    sign = 1.0 if metric.up else -1.0  # +1 when rising values are worse
    toward = sign * np.diff(v)          # positive = moving towards the limit
    anomalies: list[dict] = []

    # ---- spikes: a jump towards the limit that comes straight back (detected first so they are not "repairs")
    scale_all = max(_mad(toward), 0.02 * max(1e-6, abs(metric.limit - v[0])), 1e-6)
    spikes: set[int] = set()
    for i in range(1, n - 1):
        up_, back = toward[i - 1], toward[i]
        if up_ > 5 * scale_all and back < -3 * scale_all and abs(v[i + 1] - v[i - 1]) < 0.5 * abs(v[i] - v[i - 1]):
            spikes.add(i)

    # ---- repairs: a large move away from the limit restarts the series
    start = 0
    for i, dd in enumerate(toward, start=1):
        if (i - 1) in spikes:
            continue
        if dd < -6 * scale_all and abs(v[i] - v[i - 1]) > 0.15 * abs(metric.limit - v[i - 1]) + 1e-9:
            start = i
            anomalies.append(dict(idx=i, kind="repair", text=points[i].note or "Reading reset (repair or replacement)"))
    spikes = {i for i in spikes if i > start}
    seg = slice(start, n)
    vs, idx = v[seg], np.arange(start, n)

    # ---- new damage: flat (no variation) and then growth
    first_growth = None
    if len(vs) >= 5:
        flat = np.abs(vs - vs[0]) < 1e-9
        damage_metric = metric.key in ("crack_length", "rust_area") and abs(vs[0]) < 1e-9
        if damage_metric and flat[:3].all() and not flat.all():
            first_growth = int(idx[np.argmin(flat)])
            anomalies.append(dict(idx=first_growth, kind="new_damage", text="Damage first appears"))

    # ---- steps: one large jump, after which the rate returns to normal
    d = sign * np.diff(vs)
    early = np.array([d[k] for k in range(min(5, len(d))) if int(idx[k + 1]) not in spikes and int(idx[k]) not in spikes])
    early_rate = float(np.median(early)) if len(early) else 0.0
    d_scale = max(_mad(early) if len(early) else 0.0, 0.01 * abs(metric.limit - vs[0]) + 1e-9, 0.25 * abs(early_rate))
    margin0 = abs(metric.limit - vs[0]) + 1e-9
    step_min = max(6 * d_scale, 0.15 * margin0)  # a step must use up a meaningful share of the remaining margin
    steps: set[int] = set()
    if first_growth is None:
        for k in range(len(d) - 1):
            i_abs = int(idx[k + 1])
            if i_abs in spikes or (i_abs - 1) in spikes or (i_abs + 1) in spikes:
                continue
            after = d[k + 1: k + 3]
            held = sign * (np.mean(vs[k + 2: k + 4]) - vs[k]) >= 0.7 * d[k] if k + 2 < len(vs) else False
            if d[k] > early_rate + step_min and (after < early_rate + 3 * d_scale).all() and held:
                steps.add(i_abs)
    first_event = min(list(spikes) + list(steps) + ([first_growth] if first_growth is not None else []) + [n], default=n)
    base_end = max(start + 3, min(first_event, start + 6))
    bx = np.arange(start, min(base_end, n))
    by = v[start: min(base_end, n)]
    if first_growth is not None:
        bx, by = np.arange(start, first_growth), v[start:first_growth]
    slope_b, icpt_b = (theilslopes(by, bx)[:2] if len(bx) >= 2 else (0.0, float(v[start])))
    model = lambda i: icpt_b + slope_b * i  # noqa: E731
    resid = np.array([v[i] - model(i) for i in range(n)])
    r_scale = max(_mad(resid[start:base_end]), 0.03 * abs(metric.limit - v[start]) + 1e-9)

    # ---- rate change: from the first month the reading leaves the model for good (2+ months in a row)
    rate_change = None
    if first_growth is None:
        for i in range(base_end, n):
            tail = sign * resid[i:]
            if i in spikes:
                continue
            if len(tail) >= 2 and (tail > max(3 * r_scale, 0.08 * abs(metric.limit - v[start]))).all():
                rate_change = i
                break
    for i in sorted(spikes):
        anomalies.append(dict(idx=i, kind="spike", text="One-off spike, then back towards normal"))
    for i in sorted(steps):
        anomalies.append(dict(idx=i, kind="step", text="Jump that did not recover"))
    if rate_change is not None and rate_change not in steps:
        anomalies.append(dict(idx=rate_change, kind="rate_change", text="Wear rate increased beyond the normal wear model"))

    # attach recorded context (workshop visits, telematics events) within one month of each anomaly
    for a in anomalies:
        ctx = [points[j].note for j in (a["idx"], a["idx"] - 1, a["idx"] + 1) if 0 <= j < n and points[j].note]
        a["context"] = ctx[0] if ctx else ""
        a["date"] = points[a["idx"]].date
        a["value"] = float(v[a["idx"]])
        a["deviation"] = round(float(v[a["idx"]] - model(a["idx"])), 3)
    anomalies.sort(key=lambda a: a["idx"])

    # ---- forecast from the last four readings (spikes excluded)
    fx = [i for i in range(max(start, n - 5), n) if i not in spikes][-4:]
    fy = v[fx]
    b, a0 = np.polyfit(fx, fy, 1) if len(fx) >= 2 else (0.0, float(v[-1]))
    last = float(v[-1])
    level = float(a0 + b * (n - 1))
    towards = sign * b > 1e-9
    months = (metric.limit - level) / b if towards else math.inf
    if sign * (last - metric.limit) >= 0:
        months = 0.0
    months = max(0.0, months) if math.isfinite(months) else math.inf
    weeks = months * 4.345
    base_ratio = (b / slope_b) if abs(slope_b) > 1e-9 else math.inf
    last_date = dt.date.fromisoformat(points[-1].date)

    def at(m):
        return (last_date + dt.timedelta(days=m * 30.44)).isoformat() if math.isfinite(m) else None

    fin = math.isfinite(months) and months <= 24
    # ---- pattern + risk
    recent = [a for a in anomalies if a["idx"] >= n - 4 and a["kind"] != "repair"]
    if any(a["kind"] == "new_damage" for a in anomalies):
        pattern = "New damage, growing"
    elif spikes and rate_change is not None:
        pattern = "Spike, then faster rise"
    elif steps:
        pattern = "Step change"
    elif rate_change is not None or (math.isfinite(base_ratio) and base_ratio > 2.0 and sign * b > 0
                                     and sign * resid[-1] > 2 * r_scale):
        pattern = "Accelerating"
    elif towards:
        pattern = "Steady wear"
    else:
        pattern = "Stable"
    risk_i = 2 if weeks < 8 else (1 if weeks < 20 else 0)
    if pattern == "Step change" or (recent and weeks < 52):
        risk_i = max(risk_i, 1)
    margin_used = (v[-1] - v[start]) / (metric.limit - v[start]) if metric.limit != v[start] else 0.0
    score = round(max(5.0, min(100.0, 100 - 70 * max(0.0, min(1.0, float(margin_used))) - (15 if risk_i == 2 else 0))))
    # a step change or new damage needs action even when the forecast is far away (e.g. a camera out of calibration)
    # Needs attention: close to the limit, degrading unusually, or something changed recently.
    attention = (weeks < 12) or pattern in ("Step change", "New damage, growing") or (
        pattern in ("Accelerating", "Spike, then faster rise") and weeks < 30) or (bool(recent) and weeks < 26)
    fixed = {"Step change": "One-off jump, then normal drift", "New damage, growing": "Not present a year ago",
             "Steady wear": "Matches the normal wear model", "Stable": "No meaningful drift"}
    ratio_text = fixed.get(pattern) if pattern in ("Step change", "New damage, growing", "Stable") else (
        f"Now {base_ratio:.1f}x faster than normal wear" if math.isfinite(base_ratio) and 1.3 < base_ratio < 25
        else fixed.get(pattern, ""))
    return {
        "metric": metric.key, "name": metric.name, "unit": metric.unit, "limit": metric.limit, "up": metric.up,
        "system": metric.system, "icon": metric.icon,
        "points": [dict(date=p.date, value=p.value, note=p.note, photo=p.photo, source=p.source) for p in points],
        "model": {"slope_per_month": round(float(slope_b), 4), "intercept": round(float(icpt_b), 4),
                  "fit_months": [int(bx[0]), int(bx[-1])] if len(bx) else [0, 0],
                  "line": [round(float(model(i)), 3) for i in range(n + 3)]},
        "anomalies": anomalies,
        "forecast": {"slope_per_month": round(float(b), 4), "months_to_limit": round(months, 2) if math.isfinite(months) else None,
                     "weeks_to_limit": round(weeks, 1) if math.isfinite(weeks) else None, "weeks_label": weeks_label(weeks),
                     "date": at(months) if fin else None,
                     "range_weeks": [round(weeks / 1.25, 1), round(weeks / 0.8, 1)] if fin else None,
                     "range_dates": [at(months / 1.25), at(months / 0.8)] if fin else None,
                     "km_left": int(round(months * km_per_month, -2)) if fin else None,
                     "level_now": round(level, 3)},
        "pattern": pattern, "ratio_text": ratio_text, "risk": ["Low", "Medium", "High"][risk_i], "risk_i": risk_i,
        "score": int(score), "attention": bool(attention), "action": metric.action,
    }

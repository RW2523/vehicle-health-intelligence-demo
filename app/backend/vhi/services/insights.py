"""HQ operations (features 23, 26, 28, 31) and the regulator view (features 29, 30)."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import random
import re
import threading
import time
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from sqlalchemy import func, select, text

from .. import terms
from ..config import get_settings
from ..db import engine, session_scope
from ..ml import analytics, ocr
from ..tables import Alert, Branch, LiveInspection, Setting
from . import booking as booking_svc
from . import evidence

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def _cached(key: str, ttl: float, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (time.time(), val)
    return val


# ---------------------------------------------------------------- HQ
def integrity() -> dict:
    def run():
        ins = pd.read_sql(text("select * from hist_inspections"), engine())
        veh = pd.read_sql(text("select vehicle_id, heavy from vehicles"), engine())
        ex = pd.read_sql(text("select examiner_id, name from examiners"), engine())
        return analytics.examiner_integrity(ins, veh, ex)
    return _cached("integrity", 600, run)


def equipment() -> dict:
    return _cached("equipment", 600, lambda: analytics.equipment_health(pd.read_sql(text("select * from hist_equipment"), engine())))


def demand(branch_id: str, models) -> dict:
    def run():
        b = pd.read_sql(text("select * from hist_bookings"), engine())
        # the next 14 days from today: the model runs on from the end of the booking history, and the days already
        # gone are dropped
        from . import booking as booking_svc
        today = booking_svc.today()
        last = pd.to_datetime(b[b.branch_id == branch_id]["date"]).max().date()
        gone = max(0, (today - last).days - 1)
        fc = [d for d in models.demand.forecast(b, branch_id, 14 + gone) if str(d["date"])[:10] >= today.isoformat()][:14]
        recent = b[b.branch_id == branch_id].sort_values("date").tail(28)
        gap_days = [d for d in fc if d["gap"] > 0]
        extra = int(sum(d["gap"] for d in gap_days))
        with session_scope() as s:
            br = s.get(Branch, branch_id)
        per_lane = max(1, int(recent.capacity_slots.iloc[-1] / max(1, br.lanes)))
        roster = [{"date": d["date"], "extra_slots": d["gap"], "extra_lane_shifts": int(np.ceil(d["gap"] / per_lane))} for d in gap_days]
        return {"branch_id": branch_id, "branch": br.name if br else branch_id, "lanes": br.lanes if br else None,
                "forecast": fc, "recent": [{"date": r.date, "demand": int(r.demand_requests), "capacity": int(r.capacity_slots),
                                            "booked": int(r.booked), "gear": int(r.gear_premium_booked), "no_show": int(r.no_show)}
                                           for r in recent.itertuples()],
                "summary": {"days_over_capacity": len(gap_days), "extra_slots_needed": extra, "roster": roster,
                            "slots_per_lane_day": per_lane},
                "model": "LightGBM (calendar, holidays, lags) - see /api/system/status for holdout error"}
    return _cached(f"demand:{branch_id}", 300, run)


def live_ops() -> dict:
    with session_scope() as s:
        rows = s.execute(select(LiveInspection.status, func.count()).group_by(LiveInspection.status)).all()
        n_alerts = s.execute(select(Alert.status, func.count()).group_by(Alert.status)).all()
        recent = s.execute(select(LiveInspection).order_by(LiveInspection.started_at.desc()).limit(500)).scalars().all()
        names = dict(s.execute(select(Branch.branch_id, Branch.name)).all())
        row = lambda r: {"inspection_id": r.inspection_id, "plate": r.plate, "lane_id": r.lane_id, "branch_id": r.branch_id,
                         "branch": names.get(r.branch_id, r.branch_id), "session_id": r.session_id, "status": r.status,
                         "health": r.health_score, "verdict": r.verdict, "started_at": r.started_at.isoformat()}
        lanes = {}  # the latest inspection on every lane, across all branches (the HQ lane overview)
        for r in recent:
            lanes.setdefault(r.lane_id, r)
        return {"inspections_by_status": dict(rows), "alerts_by_status": dict(n_alerts),
                "recent": [row(r) for r in recent[:10]],
                "lanes": [row(r) for r in sorted(lanes.values(), key=lambda r: (r.branch_id, r.lane_id))]}


def audit() -> dict:
    v = evidence.verify()
    return {"verify": v, "recent": evidence.entries(limit=25)}


# ---------------------------------------------------------------- regulator
def _snapshot(name: str) -> dict:
    p = get_settings().assets_dir / "web_snapshots" / name
    return json.loads(p.read_text()) if p.exists() else {}


def web_data() -> dict:
    with session_scope() as s:
        live = s.get(Setting, "web_live")
    live = live.value if live else {}
    return {
        "fuelprice": live.get("fuelprice") or _snapshot("fuelprice.json"),
        "weather_warnings": live.get("weather_warnings") or _snapshot("weather_warnings.json"),
        "flood_stations": live.get("flood_stations") or _snapshot("flood_warning_stations.json"),
        "weather_forecast": _snapshot("weather_forecast_shah_alam.json"),
        "refreshed_at": live.get("refreshed_at"),
        "mode": "live" if live else "snapshot",
    }


def refresh_web() -> dict:
    """Try the live data.gov.my APIs; keep the cached snapshot when offline."""
    api = "https://api.data.gov.my"
    out, errors = {}, {}
    feeds = {"fuelprice": (f"{api}/data-catalogue", {"id": "fuelprice", "limit": 10, "sort": "-date"}),
             "weather_warnings": (f"{api}/weather/warning", {"limit": 20}),
             "flood_stations": (f"{api}/flood-warning", {"limit": 50})}
    for k, (url, params) in feeds.items():
        try:
            r = httpx.get(url, params=params, timeout=8)
            r.raise_for_status()
            out[k] = {"source": str(r.url), "captured": dt.datetime.now().isoformat(timespec="seconds"), "records": r.json()}
        except (httpx.HTTPError, ValueError) as e:
            errors[k] = str(e)[:120]
    if out:
        out["refreshed_at"] = dt.datetime.now().isoformat(timespec="seconds")
        with session_scope() as s:
            s.merge(Setting(key="web_live", value=out))
    return {"updated": sorted(k for k in out if k != "refreshed_at"), "errors": errors,
            "note": "Offline or blocked: the dashboards keep using the last snapshot." if errors else "ok"}


@lru_cache(maxsize=1)
def _hist_frames():
    ins = pd.read_sql(text("select vehicle_id, date, branch_id, result, fail_reasons, smoke_opacity_pct, pn_per_cm3, ev_soh_pct, "
                      "hv_isolation_mohm, co_pct, hc_ppm from hist_inspections"), engine())
    veh = pd.read_sql(text("select vehicle_id, fuel, usage, heavy, year, state from vehicles"), engine())
    return ins.merge(veh, on="vehicle_id", how="left")


def regulator() -> dict:
    def run():
        df = _hist_frames()
        df["month"] = df.date.str[:7]
        counts = df.month.value_counts()
        full = [m for m in sorted(counts.index) if counts[m] >= 0.5 * counts.median()]  # drop the partial current month
        last12 = full[-12:]
        d12 = df[df.month.isin(last12)]
        monthly = d12.groupby("month").agg(inspections=("result", "size"), fail_rate=("result", lambda s: float((s == "FAIL").mean())))
        reasons = d12.fail_reasons.fillna("").str.split(";").explode()
        reasons = reasons[reasons != ""].value_counts().head(8)
        by_branch = df.groupby("branch_id").agg(inspections=("result", "size"), fail_rate=("result", lambda s: float((s == "FAIL").mean())))
        with session_scope() as s:
            brs = {b.branch_id: b for b in s.execute(select(Branch)).scalars()}
        ev = df[df.fuel == "ev"].copy()
        for col in ("hv_isolation_mohm", "ev_soh_pct"):
            ev[col] = pd.to_numeric(ev[col], errors="coerce")
        ev_issues = ev[(ev.hv_isolation_mohm < 2) | (ev.ev_soh_pct < 75)]
        rs = pd.read_sql(text("select * from hist_remote_sensing"), engine())
        rs["high_emitter_flag"] = rs["high_emitter_flag"].astype(bool)
        sites = rs.groupby("site").agg(lat=("lat", "first"), lon=("lon", "first"), readings=("plate", "size"),
                                       high_emitters=("high_emitter_flag", "sum"), co=("co_pct", "mean"),
                                       hc=("hc_ppm", "mean"), no=("no_ppm", "mean"), smoke=("pm_uv_smoke", "mean")).reset_index()
        hits = rs[rs.high_emitter_flag].sort_values("timestamp", ascending=False).head(12)
        reg = _snapshot("jpj_registrations_2025.json")
        with session_scope() as s:
            live_ev = s.execute(select(func.count()).select_from(Alert).where(Alert.code.like("ev:%"))).scalar()
        return {
            "registrations": reg,
            "defects": {"monthly": [{"month": m, "inspections": int(r.inspections), "fail_rate": round(r.fail_rate, 3)}
                                    for m, r in monthly.iterrows()],
                        "top_reasons": [{"reason": k, "count": int(v)} for k, v in reasons.items()]},
            "branches": [{"branch_id": b, "name": brs[b].name if b in brs else b, "lat": brs[b].lat if b in brs else None,
                          "lon": brs[b].lon if b in brs else None, "inspections": int(r.inspections),
                          "fail_rate": round(r.fail_rate, 3)} for b, r in by_branch.iterrows()],
            "ev": {"inspections": int(len(ev)), "flagged": int(len(ev_issues)), "live_alerts": int(live_ev or 0),
                   "hv_isolation_below_2": int((ev.hv_isolation_mohm < 2).sum()), "soh_below_75": int((ev.ev_soh_pct < 75).sum())},
            "remote_sensing": {"sites": sites.round(3).to_dict("records"),
                               "hits": hits[["timestamp", "site", "plate", "co_pct", "hc_ppm", "no_ppm", "pm_uv_smoke"]].to_dict("records"),
                               "total": int(len(rs)), "high_emitters": int(rs.high_emitter_flag.sum()),
                               "source": "simulated roadside remote-sensing feed"},
            "sources": {"registrations": "real (data.gov.my snapshot)", "defects": "synthetic inspection history",
                        "remote_sensing": "simulated", "web": "live data.gov.my when reachable, else snapshot"},
        }
    out = dict(_cached("regulator", 300, run))
    out["web"] = web_data()
    return out


# ---------------------------------------------------------------- owner: self-check and passport
# The self-check's number-plate photo: the photo uploaded for the vehicle's "<slug>.plate" image slot (Settings ->
# Images) or, until there is one, a sample rendered here. Either runs through the lane's plate reader (vhi.ml.ocr).
PLATE_SAMPLE_V = 2  # bump when the sample or the dirt changes: the cached files are named after it
_plate_lock = threading.Lock()


def _rgb(hex_: str | None, default: tuple = (154, 160, 168)) -> tuple:
    h = (hex_ or "").lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) if re.fullmatch(r"[0-9A-Fa-f]{6}", h) else default


def _mix(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def _sample_plate(plate: str, paint: str | None) -> tuple[Image.Image, tuple]:
    """A sample photo of the rear number plate: a Malaysian-style plate (white characters on black, a thin light
    border) on a softly blurred tailgate in the vehicle's paint. Returns the image and the plate's box."""
    W, H = 960, 720
    body = _rgb(paint)
    img = Image.new("RGB", (W, H), body)
    d = ImageDraw.Draw(img)
    for y in range(H):  # lit from above
        d.line([(0, y), (W, y)], fill=_mix(_mix(body, (255, 255, 255), 0.18), _mix(body, (0, 0, 0), 0.35), y / H))
    d.rectangle([0, 0, W, 90], fill=_mix(body, (20, 24, 30), 0.75))  # the bottom edge of the rear window
    d.line([(0, 200), (W, 188)], fill=_mix(body, (255, 255, 255), 0.45), width=6)  # a crease in the tailgate
    d.line([(0, 206), (W, 194)], fill=_mix(body, (0, 0, 0), 0.3), width=4)
    d.rounded_rectangle([170, 240, 790, 490], radius=26, fill=_mix(body, (0, 0, 0), 0.22))  # the plate recess
    d.rectangle([0, 580, W, H], fill=_mix(body, (0, 0, 0), 0.45))  # the bumper
    d.line([(0, 580), (W, 580)], fill=_mix(body, (255, 255, 255), 0.35), width=5)
    img = img.filter(ImageFilter.GaussianBlur(9))
    d = ImageDraw.Draw(img)
    box = (220, 298, 740, 432)
    d.rounded_rectangle(box, radius=8, fill=(14, 14, 16), outline=(205, 205, 205), width=4)
    size = 100
    f = ocr._font(size)
    while size > 40 and d.textlength(plate, font=f) > 0.82 * (box[2] - box[0]):
        size -= 4
        f = ocr._font(size)
    bb = d.textbbox((0, 0), plate, font=f)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], cy - (bb[3] - bb[1]) / 2 - bb[1]), plate, font=f, fill=(244, 244, 244))
    img = img.rotate(-1.2, resample=Image.BICUBIC, center=(cx, cy), fillcolor=_mix(body, (0, 0, 0), 0.3))
    return img.filter(ImageFilter.GaussianBlur(0.7)), box


def _sample_tag(img: Image.Image) -> Image.Image:
    """The copy of a sample that is shown, labelled "SAMPLE PHOTO" above the plate (where the phone's viewfinder and
    a square crop still show it)."""
    img = img.copy()
    d = ImageDraw.Draw(img)
    f = ocr._font(19)
    w = d.textlength("SAMPLE PHOTO", font=f)
    x0, y0 = (img.width - w) / 2 - 13, 146
    d.rounded_rectangle([x0, y0, x0 + w + 26, y0 + 34], radius=9, fill=(255, 255, 255))
    d.text((x0 + 13, y0 + 6), "SAMPLE PHOTO", font=f, fill=(70, 70, 70))
    return img


def _plate_box(path, size: tuple) -> tuple:
    """Where the plate is on a photo: the plate reader's boxes around the largest characters, widened to the plate
    (the middle of the photo when it reads nothing)."""
    lines = [ln for ln in ocr.read_text(path) if ln["box"] and re.search(r"[A-Z0-9]{2}", ln["text"].upper())]
    if not lines:
        W, H = size
        return (round(0.22 * W), round(0.42 * H), round(0.78 * W), round(0.58 * H))
    height = lambda ln: max(p[1] for p in ln["box"]) - min(p[1] for p in ln["box"])  # noqa: E731
    tall = max(height(ln) for ln in lines)
    pts = [p for ln in lines if height(ln) >= 0.6 * tall for p in ln["box"]]
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    w, h = x1 - x0, y1 - y0
    return (round(x0 - 0.08 * w), round(y0 - 0.3 * h), round(x1 + 0.08 * w), round(y1 + 0.3 * h))


def _dirty(img: Image.Image, box: tuple, seed: int) -> Image.Image:
    """The same photo with the plate muddy and faded: a film of road dust over it, road spray from below and a few
    smears across the characters."""
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    s = h / 134
    pad = round(10 * s)
    area = Image.new("L", img.size, 0)
    ImageDraw.Draw(area).rounded_rectangle([x0 - pad, y0 - pad, x1 + pad, y1 + pad], radius=round(14 * s), fill=255)
    area = area.filter(ImageFilter.GaussianBlur(4 * s))
    img = Image.composite(Image.new("RGB", img.size, (150, 138, 118)), img, area.point(lambda v: round(v * 0.75)))
    mud = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mud)
    for _ in range(int(400 * (w / h) / (520 / 134))):
        cx = x0 - pad + rnd.uniform(0, w + 2 * pad)
        cy = y0 + h * (1.08 - rnd.random() ** 1.6)  # thickest along the bottom edge
        r = rnd.uniform(5, 20) * s
        md.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rnd.randint(160, 255))
    for _ in range(3):
        cx, cy = x0 + rnd.uniform(0.15, 0.85) * w, y0 + rnd.uniform(0.35, 0.7) * h
        md.ellipse([cx - 70 * s, cy - 24 * s, cx + 70 * s, cy + 24 * s], fill=225)
    mud = ImageChops.multiply(mud.filter(ImageFilter.GaussianBlur(3.5 * s)), area.filter(ImageFilter.GaussianBlur(8 * s)))
    grain = Image.fromarray(np.random.default_rng(seed).normal(92, 22, (img.height, img.width)).clip(0, 255).astype(np.uint8))
    mud_col = Image.merge("RGB", (grain.point(lambda v: min(255, v + 14)), grain, grain.point(lambda v: max(0, v - 22))))
    img = Image.composite(mud_col, img, mud)
    return Image.composite(img.filter(ImageFilter.GaussianBlur(1.3 * s)), img, area)


def plate_slug(plate: str) -> str:
    """"DMO 9006" -> "dmo-9006" (the vehicle's image-slot group)."""
    return re.sub(r"\s+", "-", plate.strip().lower())


def plate_photo(plate: str, dirty: bool = False) -> dict:
    """The rear number-plate photo the self-check reads, as a file under evidence/selfcheck: the vehicle's own photo for
    its "<slug>.plate" image slot (an upload, else the generated image; source "uploaded" or "generated") or, without
    one, the rendered sample; with dirty, the same photo with
    the plate muddy and faded (the demo control). "path" is the photo the plate reader reads and "url" the one shown,
    which for a sample is the same photo labelled "SAMPLE PHOTO". The files are named after their source, so a new
    upload makes new ones and an earlier check keeps the photo it read."""
    from . import images

    slug = plate_slug(plate)
    own = images.photo_file(f"{slug}.plate")  # the vehicle's own photo: an upload, else its generated image
    src, kind = own if own else (None, "sample")
    uploaded = src is not None
    paint = images.paint(plate).get("paint_hex")
    version = f"{kind}:{src}:{src.stat().st_mtime_ns}" if uploaded else f"sample:{PLATE_SAMPLE_V}:{paint}"
    key = hashlib.sha1(f"{plate}|{version}".encode()).hexdigest()[:10]
    out = get_settings().evidence_dir / "selfcheck" / f"{slug}-plate-{'dirty' if dirty else 'clean'}-{key}.jpg"
    shown = out if uploaded else out.with_name(out.stem + "-sample.jpg")

    def save(img: Image.Image, dst: Path) -> None:
        tmp = dst.with_name(dst.name + ".part")
        img.save(tmp, "JPEG", quality=88)
        os.replace(tmp, dst)

    with _plate_lock:
        if not (out.exists() and shown.exists()):
            if uploaded:
                with Image.open(src) as im:
                    img = im.convert("RGB")
                box = _plate_box(src, img.size) if dirty else None
            else:
                img, box = _sample_plate(plate, paint)
            if dirty:
                img = _dirty(img, box, int(hashlib.sha1(plate.encode()).hexdigest()[:8], 16))
            out.parent.mkdir(parents=True, exist_ok=True)
            save(img, out)
            if shown != out:
                save(_sample_tag(img), shown)
    return {"path": out, "url": f"/media/evidence/selfcheck/{shown.name}", "source": kind, "dirty": dirty}


def _plate_item(plate: str, state: str) -> dict:
    """The number plate: is it readable, and does it read as the registered plate?"""
    ph = plate_photo(plate, state == "dirty")
    r = ocr.read_plate(ph["path"])
    read = r["plate"]
    ok = bool(read) and read.replace(" ", "") == plate.replace(" ", "")
    if ok:
        value, advice = f"Reads {read}", None
    elif read:
        value = f"Reads {read}, not {plate}"
        advice = (f"The plate reader read {read} instead of {plate}: clean the plate, or replace a faded or non-standard "
                  "plate before the inspection.")
    else:
        value = "Not readable"
        advice = "Number plate not readable: clean it, or replace a faded or non-standard plate before the inspection."
    return {"item": "Number plate", "value": value, "p": r["conf"], "ok": ok, "level": "fix", "image": ph["url"],
            "photo": ph["source"], "source": "live model (plate reader)", "advice": advice}


# The guided brake test: the owner's own yes/no answers (guidance, not a measurement). Every "no" is an item with plain
# advice, and each is for a workshop to look at.
BRAKE_CHECKS = (  # answer key, item, value for yes, value for no, advice for no
    ("warning_light", "Brake warning light", "Goes out", "Stays on",
     "The brake warning light stays on: have a workshop check the brakes before the inspection."),
    ("pedal", "Brake pedal", "Firm", "Soft or sinks",
     "The brake pedal feels soft or sinks: have a workshop check the brakes before you drive far."),
    ("straight", "Braking in a straight line", "Stops straight", "Pulls to one side",
     "Pulls to one side when braking: have a workshop check the brakes before the inspection."),
    ("quiet", "Brake noise", "Quiet", "Grinding or squeal",
     "Grinding, scraping or a loud squeal when braking: the pads or discs may be worn. Have a workshop check them "
     "before the inspection."),
    ("handbrake", "Handbrake", "Holds", "Does not hold",
     "The handbrake does not hold the car on a slope: have a workshop adjust or repair it before the inspection."),
)
BRAKE_SOURCE = "owner's answers (guided brake test)"


def _brake_items(answers: dict | None) -> list[dict]:
    if not answers:
        return []
    if answers.get("safe_place") is False:  # no safe place: the owner skipped the test (the app said not to do it)
        return [{"item": "Brake test", "value": "Not done: no safe place", "ok": False, "level": "fix", "source": BRAKE_SOURCE,
                 "advice": "Do the brake test later in an empty, flat car park, or ask a workshop to check the brakes "
                           "before the inspection."}]
    out = []
    for key, item, yes, no, advice in BRAKE_CHECKS:
        a = answers.get(key)
        if a is not None:
            out.append({"item": item, "value": yes if a else no, "ok": bool(a), "level": "pro", "source": BRAKE_SOURCE,
                        "advice": None if a else advice})
    return out


def self_check(plate: str, attempt: dict, models) -> dict:
    """Pre-inspection self-check (feature 3). The number-plate photo runs through the lane's plate reader, the tyre
    photos through the tyre model and the 20 s engine clip through the acoustic model; tint and headlamp readings
    come from the phone check (simulated inputs in the demo) and the brake test from the owner's own answers."""
    s = get_settings()
    items = []
    if attempt.get("plate_photo") in ("clean", "dirty"):
        items.append(_plate_item(plate, attempt["plate_photo"]))
    tint = attempt.get("tint_vlt_pct")
    if tint is not None:
        ok = tint >= 50
        items.append({"item": "Window tint", "value": f"VLT {tint:g}%", "ok": ok, "source": "simulated (phone light check)",
                      "advice": None if ok else "Tint is darker than 50% on the front side windows. Remove or replace the film."})
    for side in ("left", "right"):
        st = attempt.get(f"headlamp_{side}")
        if st is not None:
            ok = st == "ok"
            items.append({"item": f"Headlamp ({side})", "value": st, "ok": ok, "source": "simulated (photo check)",
                          "advice": None if ok else f"The {side} headlamp is not working. Replace the bulb before the inspection."})
    for i, ref in enumerate(attempt.get("tyre_images", [])):
        p = s.data_dir / ref
        r = models.vision.classify("tyre", p)
        ok = not (r.get("available") and r["class"] == "defective" and r["p"] >= 0.6)
        items.append({"item": f"Tyre {i + 1}", "value": r.get("label"), "p": r.get("p"), "ok": ok, "image": f"/media/data/{ref}",
                      "source": "live model (AI Tyre Scan)", "advice": None if ok else "This tyre looks damaged or worn. Have it checked."})
    items += _brake_items(attempt.get("brakes"))
    if attempt.get("engine_audio"):
        r = models.acoustic.classify(s.data_dir / attempt["engine_audio"])
        ok = r["top"]["class"] in ("normal_engine", "lane_background") or r["top"]["p"] < 0.4
        items.append({"item": "Engine sound (20 s)", "value": r["top"]["label"], "p": r["top"]["p"], "ok": ok,
                      "source": "live model (acoustic classifier)", "clip": f"/media/data/{attempt['engine_audio']}",
                      "advice": None if ok else "An unusual engine sound was detected. Ask a workshop to check it."})
    fails = [i for i in items if not i["ok"]]
    # what the owner can put right (tint, bulbs, a dirty plate) vs what a workshop has to look at (tyre damage, engine
    # sound, a brake fault)
    pro = [i for i in fails if i.get("level") == "pro" or i["item"].startswith(("Tyre", "Engine"))]
    verdict = "Needs a professional check" if pro else ("Fix these first" if fails else "Ready for inspection")
    from ..tables import SelfCheck
    with session_scope() as sess:
        sc = SelfCheck(plate=plate, results={"items": items}, verdict=verdict)
        sess.add(sc)
        sess.flush()
        cid = sc.check_id
    return {"check_id": cid, "plate": plate, "verdict": verdict, "items": items, "to_fix": [i["advice"] for i in fails]}


def passport(plate: str) -> dict:
    from ..api.deps import norm_plate, vehicle_public
    from ..tables import Booking, Report, SelfCheck, Vehicle

    plate = norm_plate(plate)
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
        if v is None:
            return {}
        vp = vehicle_public(v)
        reps = s.execute(select(Report).where(Report.plate == plate).order_by(Report.created_at)).scalars().all()
        checks = s.execute(select(SelfCheck).where(SelfCheck.plate == plate).order_by(SelfCheck.created_at)).scalars().all()
        books = s.execute(select(Booking).where(Booking.plate == plate).order_by(Booking.created_at)).scalars().all()
        events = []
        reps_out = [{"date": r.created_at.date().isoformat(), "kind": r.kind, "verdict": r.verdict,
                     "health": (r.data.get("health") or {}).get("score"), "verify_token": r.verify_token} for r in reps]
        for r in reps_out:
            events.append({"date": r["date"], "kind": "report", "title": f"{r['kind']}: {r['verdict']}",
                           "health": r["health"], "verify_token": r["verify_token"], "source": "live"})
        for c in checks:
            events.append({"date": c.created_at.date().isoformat(), "kind": "self_check", "title": f"Self-check: {c.verdict}",
                           "items": c.results.get("items", []), "source": "live"})
        for b in books:
            label = booking_svc.TYPES.get(b.inspection_type, {}).get("label", b.inspection_type)
            events.append({"date": b.date, "kind": "booking", "title": f"Booked: {label}, {b.slot}"
                           + (" (Express)" if b.gear else ""), "status": b.status, "booking_id": b.booking_id,
                           "checkin_token": b.checkin_token, "source": "live"})
    hist = pd.read_sql(text("select * from hist_inspections where vehicle_id = :v"), engine(), params={"v": vp["vehicle_id"]})
    for r in hist.itertuples():
        events.append({"date": str(r.date)[:10], "kind": "inspection", "title": f"{terms.label(r.inspection_type)}: {r.result}",
                       "odometer_km": int(r.odometer_km), "fail_reasons": r.fail_reasons, "source": "history (synthetic)"})
    claims = pd.read_sql(text("select claim_date, claim_type, amount_rm, ber_total_loss from hist_claims where vehicle_id = :v"),
                         engine(), params={"v": vp["vehicle_id"]})
    for r in claims.itertuples():
        events.append({"date": str(r.claim_date)[:10], "kind": "claim", "title": f"Insurance claim: {r.claim_type.replace('_', ' ')}",
                       "amount_rm": float(r.amount_rm), "source": "insurer feed (synthetic)"})
    events.sort(key=lambda e: e["date"], reverse=True)
    certs = certificates(reps_out, hist)
    health = next((c["score"] for c in certs if c["score"] is not None), None)
    return {"vehicle": vp, "events": events, "health": health, "certificates": certs,
            "latest": certs[0] if certs else None}


def certificates(reports: list[dict], hist: pd.DataFrame) -> list[dict]:
    """Every certificate of a vehicle, newest first: the reports issued in the lane (with the health score the lane
    computed and a verify link) and each past inspection with its result and odometer."""
    out = [{"date": r["date"], "kind": r["kind"], "result": r["verdict"], "score": r["health"],
            "verify_token": r["verify_token"], "odometer_km": None, "source": "report"} for r in reports]
    for r in hist.to_dict("records"):
        out.append({"date": str(r["date"])[:10], "kind": terms.label(r["inspection_type"]),
                    "result": r["result"], "score": None, "verify_token": None, "odometer_km": int(r["odometer_km"]),
                    "source": "history"})
    return sorted(out, key=lambda c: c["date"], reverse=True)

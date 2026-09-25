"""Image models (features 8, 9, 10).

* Tyre condition and body damage: YOLO11 classifiers fine-tuned on the curated images
  (``vhi.ml.train_vision``) and run here through onnxruntime.
* Corrosion (undercarriage): colour-texture segmentation of rust (live logic), calibrated on the 137 real
  corrosion photos against the undamaged vehicle photos. It returns boxes and a 0-10 corrosion score.
  The curated corrosion photos are industrial metal, not underbodies - the demo says so.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage.color import rgb2hsv

LABELS = {
    "tyre": {"good": "Tyre in good condition", "defective": "Tyre defect (cracks / wear / damage)"},
    "damage": {"normal": "No body damage", "breakage": "Panel damage / repair (breakage)", "crushed": "Crush damage"},
}


class OnnxClassifier:
    def __init__(self, path: Path, classes: list[str], imgsz: int):
        import onnxruntime as ort

        providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
        self.sess = ort.InferenceSession(str(path), providers=providers)
        self.inp = self.sess.get_inputs()[0].name
        self.classes, self.imgsz = classes, imgsz
        self.provider = self.sess.get_providers()[0]

    def _prep(self, img: Image.Image) -> np.ndarray:
        img = img.convert("RGB")
        w, h = img.size
        s = self.imgsz / min(w, h)
        img = img.resize((max(self.imgsz, round(w * s)), max(self.imgsz, round(h * s))), Image.BILINEAR)
        w, h = img.size
        left, top = (w - self.imgsz) // 2, (h - self.imgsz) // 2
        img = img.crop((left, top, left + self.imgsz, top + self.imgsz))
        a = np.asarray(img, dtype=np.float32) / 255.0
        return a.transpose(2, 0, 1)[None]

    def predict(self, path: str | Path) -> dict:
        out = self.sess.run(None, {self.inp: self._prep(Image.open(path))})[0][0]
        p = out if abs(out.sum() - 1) < 1e-3 and out.min() >= 0 else np.exp(out - out.max()) / np.exp(out - out.max()).sum()
        i = int(np.argmax(p))
        return {"class": self.classes[i], "p": round(float(p[i]), 3),
                "probs": {c: round(float(v), 3) for c, v in zip(self.classes, p)}}


def rust_mask(img: Image.Image, max_side: int = 512) -> np.ndarray:
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    hsv = rgb2hsv(np.asarray(img, dtype=np.float32) / 255.0)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = ((h > 0.015) & (h < 0.11) & (s > 0.38) & (v > 0.12) & (v < 0.82))
    m = ndimage.binary_opening(m, iterations=2)
    return ndimage.binary_closing(m, iterations=2)


class CorrosionModel:
    def __init__(self, calib: dict | None = None):
        self.scale = (calib or {}).get("share_for_score_10", 0.35)

    def analyse(self, path: str | Path) -> dict:
        img = Image.open(path)
        m = rust_mask(img)
        share = float(m.mean())
        lab, n = ndimage.label(m)
        H, W = m.shape
        sx, sy = img.size[0] / W, img.size[1] / H
        boxes = []
        for i, sl in enumerate(ndimage.find_objects(lab), start=1):
            if sl is None:
                continue
            area = float((lab[sl] == i).sum()) / m.size
            if area < 0.004:
                continue
            y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
            boxes.append({"x": round(x0 * sx), "y": round(y0 * sy), "w": round((x1 - x0) * sx), "h": round((y1 - y0) * sy),
                          "area_share": round(area, 4), "label": "corrosion"})
        boxes = sorted(boxes, key=lambda b: -b["area_share"])[:6]
        score = min(10.0, 10.0 * share / self.scale)  # 10 = the 90th percentile of the real corrosion photos
        return {"corrosion_score": round(score, 1), "rust_share": round(share, 4), "boxes": boxes,
                "level": "severe" if score >= 7 else ("moderate" if score >= 4 else ("light" if score >= 1.5 else "none"))}


def calibrate_corrosion(data_dir: Path, out: Path) -> dict:
    pos = sorted((data_dir / "images/corrosion/corrosion_industrial_metal").glob("*.jpg"))
    neg = sorted((data_dir / "images/vehicle_damage/f_normal").glob("*.jpg"))[:137]
    ps = np.array([rust_mask(Image.open(f)).mean() for f in pos])
    ns = np.array([rust_mask(Image.open(f)).mean() for f in neg])
    thr_grid = np.linspace(0.001, 0.3, 300)
    acc = [((ps >= t).mean() + (ns < t).mean()) / 2 for t in thr_grid]
    t_best = float(thr_grid[int(np.argmax(acc))])
    calib = {"share_for_score_10": float(np.percentile(ps, 90)), "decision_share": t_best,
             "balanced_accuracy": round(float(max(acc)), 3), "median_share_corrosion": round(float(np.median(ps)), 4),
             "median_share_clean_vehicle": round(float(np.median(ns)), 4), "n_pos": len(ps), "n_neg": len(ns)}
    (out / "corrosion_calibration.json").write_text(json.dumps(calib, indent=1))
    return calib


def annotate(src: str | Path, dst: Path, boxes: list[dict], banner: str, colour=(255, 122, 26)) -> Path:
    img = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(img)
    lw = max(2, img.size[0] // 200)
    try:
        font = ImageFont.load_default(size=max(14, img.size[0] // 40))
    except TypeError:
        font = ImageFont.load_default()
    for i, b in enumerate(boxes, start=1):
        d.rectangle([b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]], outline=colour, width=lw)
        d.rectangle([b["x"], max(0, b["y"] - 22), b["x"] + 26, b["y"]], fill=colour)
        d.text((b["x"] + 7, max(0, b["y"] - 21)), str(i), fill=(255, 255, 255), font=font)
    d.rectangle([0, 0, img.size[0], 30], fill=(7, 13, 26))
    d.text((10, 6), banner, fill=(34, 211, 238), font=font)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, quality=88)
    return dst


class VisionModels:
    def __init__(self, models_dir: Path):
        vdir = models_dir / "vision"
        meta = json.loads((vdir / "vision_metrics.json").read_text()) if (vdir / "vision_metrics.json").exists() else {}
        self.meta = meta
        self.cls: dict[str, OnnxClassifier] = {}
        for task in ("tyre", "damage"):
            f = vdir / f"{task}_cls.onnx"
            if f.exists() and task in meta:
                self.cls[task] = OnnxClassifier(f, meta[task]["classes"], meta[task]["imgsz"])
        cal = models_dir / "corrosion_calibration.json"
        self.corrosion = CorrosionModel(json.loads(cal.read_text()) if cal.exists() else None)

    def arch(self, task: str) -> str:
        """The fine-tuned base model, e.g. "YOLO11s-cls" for yolo11s-cls.pt."""
        return self.meta.get(task, {}).get("base", "yolo11n-cls.pt").removesuffix(".pt").replace("yolo", "YOLO")

    def classify(self, task: str, path: str | Path) -> dict:
        if task not in self.cls:
            return {"available": False, "reason": f"{task} model not trained - run `make train-vision`"}
        r = self.cls[task].predict(path)
        r.update(available=True, label=LABELS[task].get(r["class"], r["class"]), provider=self.cls[task].provider,
                 val_accuracy=self.meta.get(task, {}).get("top1_val_accuracy"), arch=self.arch(task))
        return r

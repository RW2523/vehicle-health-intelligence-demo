"""Loads trained models on first use and reports their status for the "under the hood" screen."""
from __future__ import annotations

import json
import logging
import threading
from functools import cached_property

from ..config import Settings

log = logging.getLogger("vhi.models")

CATALOGUE = [
    # key, title, how it runs, metrics file
    ("anpr_ocr", "ANPR + chassis OCR (PaddleOCR via onnxruntime)", "live_model", None),
    ("tyre", "Tyre condition ({arch}, fine-tuned)", "live_model", "vision/vision_metrics.json"),
    ("damage", "Body damage ({arch}, fine-tuned)", "live_model", "vision/vision_metrics.json"),
    ("corrosion", "Corrosion segmentation (calibrated colour-texture)", "live_logic", "corrosion_calibration.json"),
    ("enose", "E-nose classifier (XGBoost on UCI gas array)", "live_model", "enose_metrics.json"),
    ("acoustic", "Acoustic fault classifier + engine fingerprint", "live_model", "acoustic_metrics.json"),
    ("soh", "EV battery SOH + NASA fade model", "live_model", "soh_metrics.json"),
    ("fusion", "Health score, flood, next-fail (LightGBM + Weibull AFT)", "live_model", "fusion_metrics.json"),
    ("demand", "Demand forecast (LightGBM)", "live_model", "demand_metrics.json"),
    ("integrity", "Examiner integrity (z-score + Isolation Forest)", "live_model", None),
    ("pdm", "Lane equipment maintenance (Isolation Forest + trend)", "live_model", None),
    ("degradation", "Fleet degradation, anomalies, time to failure", "live_logic", None),
]


class ModelRegistry:
    def __init__(self, settings: Settings):
        self.s = settings
        self.dir = settings.models_dir
        self._lock = threading.Lock()

    def ensure_trained(self) -> None:
        from .train import missing, train_all

        todo = missing()
        if todo:
            log.info("training missing models: %s", todo)
            train_all(todo)

    def _metrics(self, rel: str | None, key: str) -> dict | None:
        if not rel or not (self.dir / rel).exists():
            return None
        m = json.loads((self.dir / rel).read_text())
        return m.get(key, m) if rel.endswith("vision_metrics.json") else m

    def status(self) -> list[dict]:
        out = []
        for key, title, how, rel in CATALOGUE:
            m = self._metrics(rel, key)
            ready = True
            if key in ("tyre", "damage"):
                ready = (self.dir / "vision" / f"{key}_cls.onnx").exists()
                base = (m or {}).get("base", "yolo11n-cls.pt")
                title = title.format(arch=base.removesuffix(".pt").replace("yolo", "YOLO"))
            out.append({"key": key, "title": title, "runs_as": how, "ready": ready, "metrics": m})
        return out

    @cached_property
    def enose(self):
        from .enose import ENoseModel
        return ENoseModel(self.dir / "enose.joblib", self.s.sessions_dir)

    @cached_property
    def acoustic(self):
        from .acoustic import AcousticModel
        return AcousticModel(self.dir / "acoustic.joblib")

    @cached_property
    def soh(self):
        from .soh import SOHModel
        return SOHModel(self.dir / "soh.joblib")

    @cached_property
    def fusion(self):
        from .fusion import FusionModels
        return FusionModels(self.dir)

    @cached_property
    def vision(self):
        from .vision import VisionModels
        return VisionModels(self.dir)

    @cached_property
    def demand(self):
        from .demand import DemandModel
        return DemandModel(self.dir / "demand_lgbm.txt")

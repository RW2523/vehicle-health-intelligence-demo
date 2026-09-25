"""Fine-tune YOLO11 classifiers on the curated images and export them to ONNX for the API.

Needs the training extras (``pip install ultralytics onnx onnxslim``), which the API itself does not: at runtime the
exported ``.onnx`` files run on onnxruntime (CPU, or CUDA on the DGX Spark).

    python -m vhi.ml.train_vision                 # tyre + damage, CPU-friendly settings
    python -m vhi.ml.train_vision --epochs 30 --imgsz 224 --device 0   # on the DGX Spark GPU
    python -m vhi.ml.train_vision --device 0 --epochs 40 --imgsz 224 --weights yolo11m-cls.pt --batch 64 --workers 8

Outputs (in app/backend/models/vision/): ``tyre_cls.onnx``, ``damage_cls.onnx`` and ``vision_metrics.json``.
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
from pathlib import Path

from ..config import get_settings

TASKS = {
    # task -> {class_name: [curated image folders]}
    "tyre": {"good": ["images/tyre/perfect"], "defective": ["images/tyre/defective"]},
    "damage": {
        "normal": ["images/vehicle_damage/f_normal", "images/vehicle_damage/r_normal"],
        "breakage": ["images/vehicle_damage/f_breakage", "images/vehicle_damage/r_breakage"],
        "crushed": ["images/vehicle_damage/f_crushed", "images/vehicle_damage/r_crushed"],
    },
}


def build_split(task: str, root: Path, val_frac: float = 0.2, seed: int = 0) -> Path:
    data = get_settings().data_dir
    out = root / task
    if out.exists():
        shutil.rmtree(out)
    rng = random.Random(seed)
    for cls, folders in TASKS[task].items():
        files = sorted(f for d in folders for f in (data / d).glob("*.jpg"))
        rng.shuffle(files)
        n_val = max(1, int(len(files) * val_frac))
        for split, part in (("val", files[:n_val]), ("train", files[n_val:])):
            dst = out / split / cls
            dst.mkdir(parents=True, exist_ok=True)
            for f in part:
                (dst / f"{f.parent.name}_{f.name}").symlink_to(f)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="tyre,damage")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--imgsz", type=int, default=160)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--weights", default="yolo11n-cls.pt")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    from ultralytics import YOLO

    s = get_settings()
    out_dir = s.models_dir / "vision"
    out_dir.mkdir(parents=True, exist_ok=True)
    work = s.var_dir / "vision_train"
    metrics_path = out_dir / "vision_metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    for task in args.tasks.split(","):
        ds = build_split(task, work / "datasets")
        model = YOLO(args.weights)
        model.train(data=str(ds), epochs=args.epochs, imgsz=args.imgsz, device=args.device, batch=args.batch,
                    workers=args.workers, project=str(work / "runs"), name=task, exist_ok=True, verbose=False, plots=False,
                    seed=0)
        val = model.val(data=str(ds), imgsz=args.imgsz, device=args.device, split="val", verbose=False, plots=False)
        onnx_path = Path(model.export(format="onnx", imgsz=args.imgsz, simplify=True, dynamic=False))
        dst = out_dir / f"{task}_cls.onnx"
        shutil.copy(onnx_path, dst)
        names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
        metrics[task] = {"top1_val_accuracy": round(float(val.top1), 4), "classes": [names[i] for i in sorted(names)],
                         "imgsz": args.imgsz, "epochs": args.epochs, "base": args.weights,
                         "n_val": sum(1 for _ in (ds / "val").rglob("*.jpg"))}
        metrics_path.write_text(json.dumps(metrics, indent=1))
        print(task, metrics[task])


if __name__ == "__main__":
    main()

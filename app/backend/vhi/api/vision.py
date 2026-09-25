"""AI vision: the 22 sample captures (pre-annotated) and live model runs on any image, including uploads, plus an
optional plain-words description of the same image from a vision-language model on the GPU."""
from __future__ import annotations

import asyncio
import json
import uuid
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..ml import ocr
from ..ml.vision import annotate
from ..runtime import rt

router = APIRouter(prefix="/api/vision", tags=["vision"])
TASKS = ("tyre", "damage", "corrosion", "plate")
SUBJECT = {"tyre": "a vehicle tyre", "damage": "a vehicle's body panels", "corrosion": "a metal surface on or under a vehicle",
           "plate": "a vehicle number plate"}
EXPLAIN = ("You are a vehicle inspection examiner in Malaysia. This photo shows {subject}. In two or three short sentences, "
           "describe what you can see - damage, wear, cracks, dents, rust, or nothing wrong - and whether it looks "
           "roadworthy. If the photo is unclear, say so. Plain words, no lists.")
EXPLAIN_PLATE = ("This photo shows a vehicle number plate. Reply with the registration number exactly as written, then one "
                 "short sentence on how clearly it can be read. If you cannot read it, say so.")


@lru_cache(maxsize=1)
def captures() -> dict:
    return json.loads((rt().settings.assets_dir / "captures" / "captures.json").read_text())


@router.get("/captures")
def list_captures():
    c = captures()
    return {"source": "Sample images: AI boxes pre-drawn on the capture, findings as labelled in the sample set",
            "rules": c["rules"], "cases": [{**x, "original_url": f"/media/assets/captures/{x['original']}",
                                             "ai_url": f"/media/assets/captures/{x['ai']}"} for x in c["cases"]]}


class AnalyseReq(BaseModel):
    task: str
    capture_id: int | None = None
    data_path: str | None = None  # a file under data/curated (e.g. images/tyre/defective/...)
    upload_id: str | None = None  # a photo sent to /upload earlier


def _image_path(req: AnalyseReq) -> Path:
    s = rt().settings
    if req.capture_id is not None:
        case = next((c for c in captures()["cases"] if c["id"] == req.capture_id), None)
        if case is None:
            raise HTTPException(404, "capture not found")
        return s.assets_dir / "captures" / case["original"]
    if req.data_path:
        path = (s.data_dir / req.data_path).resolve()
        if not path.is_relative_to(s.data_dir.resolve()) or not path.exists():
            raise HTTPException(400, "path must be an existing file under data/curated")
        return path
    if req.upload_id:
        path = s.evidence_dir / "uploads" / req.upload_id
        if Path(req.upload_id).name != req.upload_id or not path.exists():
            raise HTTPException(404, "upload not found")
        return path
    raise HTTPException(400, "give capture_id, data_path or upload_id")


def _run(task: str, path: Path) -> dict:
    m = rt().models
    out_dir = rt().settings.evidence_dir / "vision"
    out = out_dir / f"{task}_{uuid.uuid4().hex[:8]}.jpg"
    if task == "corrosion":
        r = m.vision.corrosion.analyse(path)
        annotate(path, out, r["boxes"], f"Corrosion {r['corrosion_score']}/10 ({r['level']})")
    elif task == "plate":
        r = ocr.read_plate(path)
        annotate(path, out, [], f"Plate: {r['plate'] or 'not read'} ({r['conf']:.0%})")
    else:
        r = m.vision.classify(task, path)
        annotate(path, out, [], f"{r.get('label', 'unavailable')} ({r.get('p', 0):.0%})")
    return {"task": task, "result": r, "annotated_url": f"/media/evidence/vision/{out.name}",
            "runs_as": "live logic" if task == "corrosion" else "live model", "vlm": rt().vlm.status()}


@router.post("/analyse")
async def analyse(req: AnalyseReq):
    if req.task not in TASKS:
        raise HTTPException(400, f"task must be one of {TASKS}")
    return await asyncio.to_thread(_run, req.task, _image_path(req))


@router.post("/explain")
async def explain(req: AnalyseReq):
    """Second opinion in plain words from the vision-language model (GPU), for the same image and task."""
    if req.task not in TASKS:
        raise HTTPException(400, f"task must be one of {TASKS}")
    path = _image_path(req)
    vlm = rt().vlm
    if not vlm.available():
        raise HTTPException(503, "No vision-language model is reachable (set VHI_VLM_URL and VHI_VLM_MODEL)")
    prompt = EXPLAIN_PLATE if req.task == "plate" else EXPLAIN.format(subject=SUBJECT[req.task])
    text = await asyncio.to_thread(vlm.describe, path, prompt)
    if not text:
        raise HTTPException(502, "The vision-language model did not answer - try again")
    return {"task": req.task, "text": text, "model": vlm.status()["backend"], "runs_as": "live model"}


@router.post("/upload")
async def upload(task: str, file: UploadFile = File(...)):
    if task not in TASKS:
        raise HTTPException(400, f"task must be one of {TASKS}")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "image too large")
    dst = rt().settings.evidence_dir / "uploads" / f"{uuid.uuid4().hex[:10]}{Path(file.filename or 'x.jpg').suffix or '.jpg'}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(data)
    try:
        return {**await asyncio.to_thread(_run, task, dst), "upload_id": dst.name}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not analyse the image: {e}") from e


@router.get("/samples")
def samples():
    """A few curated real images per task, for the 'try the live model' picker."""
    d = rt().settings.data_dir
    pick = lambda g, n: [str(p.relative_to(d)) for p in sorted(d.glob(g))[:n]]  # noqa: E731
    return {"tyre": pick("images/tyre/defective/*.jpg", 3) + pick("images/tyre/perfect/*.jpg", 3),
            "damage": pick("images/vehicle_damage/r_breakage/*.jpg", 3) + pick("images/vehicle_damage/f_crushed/*.jpg", 2)
            + pick("images/vehicle_damage/f_normal/*.jpg", 2),
            "corrosion": pick("images/corrosion/corrosion_industrial_metal/*.jpg", 4),
            "plate": pick("images/plates_my/real_plate_photo/*.jpg", 5)}

"""The demo image library (data/curated/images/vehiclesense_demo): every source inspection image with its mapping to the
app captures, the fleet vehicles it shows and its findings. The AI boxes are pre-drawn on the images (sample data)."""
from __future__ import annotations

import json
from functools import lru_cache

from ..config import get_settings

MANIFEST = "images/vehiclesense_demo/manifest.json"
KIND_ORDER = {"comparison": 0, "closeup": 1, "progression": 2}


@lru_cache(maxsize=1)
def library() -> dict:
    p = get_settings().data_dir / MANIFEST
    if not p.exists():
        return {"images": [], "counts": {}, "unmapped": []}
    m = json.loads(p.read_text())
    for e in m["images"]:
        e["full_url"], e["web_url"] = f"/media/data/{e['full']}", f"/media/data/{e['web']}"
        e["crop_urls"] = [f"/media/assets/{c}" for c in e["crops"]]
    return m


def for_vehicle(plate: str) -> list[dict]:
    """The images that show one fleet vehicle: inspection comparisons first, then close-ups and progressions."""
    return sorted((e for e in library()["images"] if plate in e["used_by_vehicles"]), key=lambda e: KIND_ORDER.get(e["kind"], 9))


def summary(e: dict) -> dict:
    """What a list or table needs to show a thumbnail and open the image viewer."""
    return {"id": e["id"], "kind": e["kind"], "title": e["title"], "web_url": e["web_url"], "findings": len(e["findings"])}

"""Photos of the ten main vehicles and of generic scenes, by image slot.

Every slot (``dmo-9006.hero``, ``vkr-3128.interior``, ``scene.flood`` ...) is listed in
data/curated/images/stock/prompts.json with where it shows in the app, its aspect ratio and a text-to-image prompt.
A slot shows, in this order:

1. an upload (Settings → Images, or a file saved as <VHI_VAR_DIR>/images/<slug>/<view>.jpg): re-encoded to JPEG at
   1600/960/480 px and served from /media/images/ with ?v=<mtime>. Uploads live in the var dir, which the runtime
   reset (vhi.seed.reset_runtime) does not touch; deleting one brings the stock photo back;
2. a stock photo from Wikimedia Commons (images/stock/manifest.json, fetched by scripts/fetch_stock_images.py): a
   representative photo of the model, not of the fictional vehicle, credited with author and licence; served from
   /media/data/;
3. nothing: the web app draws its vehicle illustration instead.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import get_settings

log = logging.getLogger("vhi.images")

SIZES = (1600, 960, 480)
QUALITY = 85
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 60_000_000
TYPES = {"image/jpeg": "JPEG", "image/jpg": "JPEG", "image/pjpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
DROP_IN = (".jpg", ".jpeg", ".png", ".webp")  # files saved by hand into the uploads folder
# the licences a stock photo may have: public domain, CC0, CC BY and CC BY-SA (never NC, ND, GFDL-only or fair use)
LICENCE_RE = re.compile(r"(CC0( 1\.0)?|Public domain|PD|PD[- ].*|Public Domain.*|CC BY(-SA)? \d\.\d( [A-Za-z-]{2,6})?)",
                        re.I)


class ImageError(ValueError):
    """An upload that cannot be used; ``status`` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ---- where things are
def stock_dir() -> Path:
    return get_settings().data_dir / "images" / "stock"


def uploads_dir() -> Path:
    p = get_settings().var_dir / "images"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _json(path: Path) -> dict:
    try:
        return _json_cached(str(path), path.stat().st_mtime)
    except FileNotFoundError:
        return {}


@lru_cache(maxsize=8)
def _json_cached(path: str, mtime: float) -> dict:  # noqa: ARG001 - mtime is the cache key
    return json.loads(Path(path).read_text())


def _registry() -> dict:
    return _json(stock_dir() / "prompts.json")


def _manifest() -> dict:
    return _json(stock_dir() / "manifest.json")


def _slots() -> list[dict]:
    return _registry().get("slots", [])


def _slot(slot_id: str) -> dict | None:
    return next((s for s in _slots() if s["id"] == slot_id), None)


def _stock_by_slot() -> dict[str, dict]:
    return {im["slot_id"]: im for im in _manifest().get("images", [])}


def _folder(slot: dict) -> str:
    return "scenes" if slot["group"] == "scenes" else slot["group"]


def _norm_plate(plate: str | None) -> str:
    return re.sub(r"\s+", " ", (plate or "").strip().upper())


# ---- photos
def _credit(author: str | None, licence: str | None) -> str:
    return " · ".join(x for x in (f"Photo: {author}" if author else None, licence, "Wikimedia Commons") if x)


def _stock_photo(slot: dict) -> dict | None:
    im = _stock_by_slot().get(slot["id"])
    if not im:
        return None
    if not (get_settings().data_dir / im["files"]["1600"]).exists():
        return None
    url = lambda size: "/media/data/" + im["files"][size]  # noqa: E731
    return {
        "url": url("1600"), "url_960": url("960"), "url_480": url("480"),
        "credit": _credit(im.get("author"), im.get("license")), "author": im.get("author"), "license": im.get("license"),
        "license_url": im.get("license_url"), "page_url": im.get("page_url"), "kind": "stock", "view": slot["view"],
        "label": slot["label"], "representative": True, "width": im.get("width"), "height": im.get("height"),
    }


def _paths(slot: dict) -> dict[int, Path]:
    d = uploads_dir() / _folder(slot)
    v = slot["view"]
    return {1600: d / f"{v}.jpg", 960: d / f"{v}.960.jpg", 480: d / f"{v}.480.jpg"}


def _normalise(slot: dict) -> dict[int, Path] | None:
    """The slot's upload, with its smaller copies made if a file was saved into the folder by hand (any of .jpg,
    .jpeg, .png or .webp, any size). None when there is no upload."""
    paths = _paths(slot)
    main = paths[1600]
    src = main if main.exists() else next((p for p in (main.with_suffix(e) for e in DROP_IN[1:]) if p.exists()), None)
    if src is None:
        return None
    fresh = src == main and all(p.exists() and p.stat().st_mtime >= main.stat().st_mtime for p in (paths[960], paths[480]))
    if fresh:
        return paths
    try:
        _write(_decode(src.read_bytes()), paths)
    except (ImageError, OSError) as e:
        log.warning("image slot %s: could not use %s (%s)", slot["id"], src, e)
        return None
    if src != main:
        src.unlink(missing_ok=True)
    return paths


def _uploaded_photo(slot: dict) -> dict | None:
    paths = _normalise(slot)
    if not paths:
        return None
    v = paths[1600].stat().st_mtime_ns // 1_000_000  # changes with every upload, so browsers fetch the new file
    rel = lambda p: f"/media/images/{_folder(slot)}/{p.name}?v={v}"  # noqa: E731
    try:
        with Image.open(paths[1600]) as im:
            w, h = im.size
    except OSError:
        w = h = None
    return {
        "url": rel(paths[1600]), "url_960": rel(paths[960]), "url_480": rel(paths[480]), "credit": "Your upload",
        "author": None, "license": None, "license_url": None, "page_url": None, "kind": "uploaded", "view": slot["view"],
        "label": slot["label"], "representative": False, "width": w, "height": h,
    }


def _current(slot: dict) -> dict | None:
    return _uploaded_photo(slot) or _stock_photo(slot)


def _public(slot: dict) -> dict:
    up, stock = _uploaded_photo(slot), _stock_photo(slot)
    return {"id": slot["id"], "group": slot["group"], "plate": slot.get("plate"), "view": slot["view"],
            "label": slot["label"], "where": slot["where"], "aspect": slot["aspect"], "prompt": slot["prompt"],
            "path": slot.get("path"), "current": up or stock, "stock": stock, "uploaded": up is not None}


def slots(group: str | None = None, plate: str | None = None) -> list[dict]:
    """Every slot (filtered by group - a vehicle's slug or "scenes" - or by plate) with its current photo."""
    p = _norm_plate(plate) if plate else None
    return [_public(s) for s in _slots()
            if (not group or s["group"] == group) and (not p or _norm_plate(s.get("plate")) == p)]


def slot(slot_id: str) -> dict | None:
    s = _slot(slot_id)
    return _public(s) if s else None


def _vehicle_slots(plate: str) -> list[dict]:
    p = _norm_plate(plate)
    order = _registry().get("views", [])
    found = [s for s in _slots() if s["group"] != "scenes" and _norm_plate(s.get("plate")) == p]
    return sorted(found, key=lambda s: order.index(s["view"]) if s["view"] in order else 99)


def hero(plate: str) -> dict | None:
    """The vehicle's front three-quarter photo (an upload, else the stock photo), None for other vehicles."""
    s = next((s for s in _vehicle_slots(plate) if s["view"] == "hero"), None)
    return _current(s) if s else None


def gallery(plate: str) -> list[dict]:
    """The vehicle's photos that exist, hero first."""
    return [ph for ph in (_current(s) for s in _vehicle_slots(plate)) if ph]


def scene(scene_id: str) -> dict | None:
    s = _slot(f"scene.{scene_id}")
    return _current(s) if s else None


def scenes() -> dict[str, dict | None]:
    return {s["view"]: _current(s) for s in _slots() if s["group"] == "scenes"}


def _vehicle(plate: str) -> dict:
    p = _norm_plate(plate)
    return next((v for v in _manifest().get("vehicles", {}).values() if _norm_plate(v.get("plate")) == p), {})


def paint(plate: str) -> dict:
    """{"paint": "white", "paint_hex": "#F4F4F2"} for a main vehicle (the colour its photos and prompts use)."""
    v = _vehicle(plate)
    return {"paint": v.get("paint"), "paint_hex": v.get("paint_hex")}


def vehicle_photos(plate: str) -> dict:
    v = _vehicle(plate)
    return {"plate": _norm_plate(plate), **paint(plate), "vtype": v.get("vtype"), "hero": hero(plate),
            "gallery": gallery(plate)}


def groups() -> list[dict]:
    """The slot groups in order (the ten vehicles, then the scenes) with what the image library heads them with:
    plate, make, model, year, vehicle type, paint, the hero photo and how many slots have a photo or an upload."""
    vehicles = _manifest().get("vehicles", {})
    order: list[str] = []
    for s in _slots():
        if s["group"] not in order:
            order.append(s["group"])
    out = []
    for g in order:
        items = [s for s in _slots() if s["group"] == g]
        ups = [_uploaded_photo(s) for s in items]
        cur = [u or _stock_photo(s) for u, s in zip(ups, items)]
        v = vehicles.get(g, {})
        hero_i = next((i for i, s in enumerate(items) if s["view"] == "hero"), None)
        out.append({"group": g, "plate": v.get("plate"), "make": v.get("make"), "model": v.get("model"),
                    "year": v.get("year"), "vtype": v.get("vtype"), "paint": v.get("paint"), "paint_hex": v.get("paint_hex"),
                    "title": f"{v['make']} {v['model']}" if v else "Scenes", "hero": cur[hero_i] if hero_i is not None else None,
                    "slots": len(items), "filled": sum(1 for c in cur if c), "uploaded": sum(1 for u in ups if u)})
    return out


# ---- uploads
def _decode(data: bytes, content_type: str | None = None) -> Image.Image:
    if content_type is not None and content_type.split(";")[0].strip().lower() not in TYPES:
        raise ImageError("Upload a JPEG, PNG or WebP image.", 415)
    if len(data) > MAX_BYTES:
        raise ImageError("The image is larger than 12 MB.", 413)
    if not data:
        raise ImageError("The file is empty.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in TYPES.values():
                raise ImageError("Upload a JPEG, PNG or WebP image.", 415)
            if probe.width * probe.height > MAX_PIXELS:
                raise ImageError("The image has too many pixels (60 megapixels at most).", 413)
        im = Image.open(io.BytesIO(data))
        im.load()
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as e:
        raise ImageError("This file is not an image that can be read.") from e
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        return bg
    return im.convert("RGB")


def _write(im: Image.Image, paths: dict[int, Path]) -> None:
    """1600, 960 and 480 px wide JPEGs (never enlarged), written atomically, without EXIF."""
    paths[1600].parent.mkdir(parents=True, exist_ok=True)
    for size in SIZES:  # largest first: the smaller copies are newer, which marks the set as complete
        out = im if im.width <= size else im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
        tmp = paths[size].with_name(paths[size].name + ".part")
        out.save(tmp, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        os.replace(tmp, paths[size])


def save_upload(slot_id: str, data: bytes, content_type: str | None = None) -> dict:
    """Use an uploaded image for a slot (it replaces the stock photo). Returns the slot as slots() lists it."""
    s = _slot(slot_id)
    if s is None:
        raise ImageError(f"No image slot {slot_id}.", 404)
    paths = _paths(s)
    _write(_decode(data, content_type), paths)
    for e in DROP_IN[1:]:  # an older hand-saved file would otherwise come back after a delete
        paths[1600].with_suffix(e).unlink(missing_ok=True)
    log.info("image slot %s: upload saved (%d bytes)", slot_id, len(data))
    return _public(s)


def delete_upload(slot_id: str) -> dict:
    """Remove a slot's upload: the stock photo shows again (or nothing, for a prompt-only slot)."""
    s = _slot(slot_id)
    if s is None:
        raise ImageError(f"No image slot {slot_id}.", 404)
    main = _paths(s)[1600]
    for p in [*_paths(s).values(), *(main.with_suffix(e) for e in DROP_IN[1:])]:
        p.unlink(missing_ok=True)
    return _public(s)


# ---- the prompts as a document
def prompts_markdown(status: bool = True) -> str:
    """All slots with where they show, aspect ratio, prompt and how to add the image (PROMPTS.md). With status, each
    slot also says what it shows now (stock photo, upload or nothing)."""
    reg = _registry()
    vehicles = _manifest().get("vehicles", {})
    lines = ["# Image prompts", "",
             "One photoreal text-to-image prompt per image slot of the ten main vehicles and the generic scenes. "
             "The prompts match the sample inspection images (bright Malaysian inspection hall, epoxy floor with yellow "
             "lane lines, camera gantries) and each vehicle's make, model, year and paint. Number plates are the "
             "fictional demo plates in Malaysian style (white characters on a black plate).", "",
             "**To use an image:** upload it in **Settings → Images** (it replaces the stock photo straight away), or "
             "save it on the API server as the path given (any size, JPEG/PNG/WebP; the API makes the 1600/960/480 px "
             "copies). Deleting the upload brings the stock photo back.", ""]
    stock = _stock_by_slot()
    groups: dict[str, list[dict]] = {}
    for s in reg.get("slots", []):
        groups.setdefault(s["group"], []).append(s)
    for g, items in groups.items():
        v = vehicles.get(g)
        title = f"{v['plate']} · {v['year']} {v['make']} {v['model']} · {v['paint']}" if v else "Scenes"
        lines += [f"## {title}", ""]
        for s in items:
            lines += [f"### `{s['id']}` · {s['label']}", "",
                      f"- **Shows in:** {s['where']}", f"- **Aspect ratio:** {s['aspect']}"]
            if status:
                up = _uploaded_photo(s) is not None
                now = "your upload" if up else ("stock photo (Wikimedia Commons)" if s["id"] in stock else "missing")
                lines.append(f"- **Now:** {now}")
            else:
                lines.append(f"- **Stock photo:** {'yes' if s['id'] in stock else 'no (prompt only)'}")
            lines += [f"- **Add it:** upload it in Settings → Images, or save it as `{s['path']}`", "",
                      "```text", s["prompt"], "```", ""]
    return "\n".join(lines)


if __name__ == "__main__":  # python -m vhi.services.images: rewrite data/curated/images/stock/PROMPTS.md
    out = stock_dir() / "PROMPTS.md"
    out.write_text(prompts_markdown(status=False))
    print("wrote", out)

"""ANPR and chassis-number OCR (features 5, 6): PaddleOCR models run through onnxruntime (RapidOCR).

The demo vehicles are fictional, so their plate and chassis-plate images are rendered at check-in and then read
back by the real OCR model; the real Malaysian plate photos in the curated data can be run through the same
endpoint (``/api/vision/ocr``).
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_CANDIDATES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                   "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/Library/Fonts/Arial Bold.ttf"]


def _font(size: int):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


@lru_cache(maxsize=1)
def engine():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def read_text(path: str | Path) -> list[dict]:
    res, _ = engine()(str(path))
    return [{"text": t, "conf": round(float(c), 3), "box": [[round(float(x), 1) for x in pt] for pt in b]}
            for b, t, c in (res or [])]


PLATE_RE = re.compile(r"^[A-Z]{1,3}\s?\d{1,4}\s?[A-Z]?$")
TO_LETTER = str.maketrans({"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G", "4": "A"})
TO_DIGIT = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"})


def parse_plate(raw: str) -> str | None:
    """Malaysian plate grammar: 1-3 letters, 1-4 digits, optional letter. Fixes 0/O, 1/I, 5/S ... by position."""
    t = re.sub(r"[^A-Z0-9]", "", raw.upper())
    if not t:
        return None
    m = re.match(r"^([A-Z0-9]*?[A-Z][A-Z0-9]*?)(\d[A-Z0-9]*)$", t) or re.match(r"^([A-Z]{1,3})(\d+)([A-Z]?)$", t)
    best = None
    for k in range(1, min(3, len(t) - 1) + 1):  # try every split: first k chars are the prefix
        pre, rest = t[:k].translate(TO_LETTER), t[k:]
        suffix = ""
        if rest and rest[-1].isalpha() and not rest[-1] in "OQDILSBZG":
            rest, suffix = rest[:-1], rest[-1]
        digits = rest.translate(TO_DIGIT)
        if pre.isalpha() and any(ch.isalpha() for ch in t[:k]) and digits.isdigit() and 1 <= len(digits) <= 4:
            cand = f"{pre} {digits}{suffix}"
            # prefer the split that needed the fewest substitutions and keeps more letters
            cost = sum(a != b for a, b in zip(t[:k], pre)) + sum(a != b for a, b in zip(rest, digits))
            if best is None or (cost, -k) < best[0]:
                best = ((cost, -k), cand)
    _ = m
    return best[1] if best else None


def normalise_plate(text: str) -> str:
    return parse_plate(text) or re.sub(r"[^A-Z0-9]", "", text.upper())


def read_plate(path: str | Path) -> dict:
    lines = read_text(path)
    frags = sorted(lines, key=lambda ln: ln["box"][0][0] if ln["box"] else 0)
    cands = []
    for ln in frags:
        p = parse_plate(ln["text"])
        if p:
            cands.append({"plate": p, "conf": ln["conf"], "from": "fragment"})
    if len(frags) > 1:
        # merge fragments: letters from the leftmost fragment, the longest digit run from any fragment
        lead = re.match(r"^[A-Z0-9]{1,3}", re.sub(r"[^A-Z0-9]", "", frags[0]["text"].upper()))
        digit_runs = [re.sub(r"[^0-9]", "", f["text"]) for f in frags]
        dig = max(digit_runs, key=len) if digit_runs else ""
        if lead and dig:
            letters = re.sub(r"[^A-Z]", "", lead.group(0).translate(TO_LETTER))
            if letters and 1 <= len(dig) <= 4:
                cands.append({"plate": f"{letters} {dig}", "conf": round(min(f["conf"] for f in frags), 3), "from": "merged"})
        joined = parse_plate("".join(f["text"] for f in frags))
        if joined:
            cands.append({"plate": joined, "conf": round(min(f["conf"] for f in frags), 3), "from": "joined"})
    cands = [c for c in cands if PLATE_RE.match(c["plate"])]
    # fragments that touch or overlap horizontally are pieces of one plate -> prefer the merged reading
    def span(f):
        xs = [pt[0] for pt in f["box"]] or [0]
        return min(xs), max(xs)
    touching = len(frags) > 1 and all(span(frags[i + 1])[0] - span(frags[i])[1] < 0.15 * (span(frags[i])[1] - span(frags[i])[0] + 1)
                                      for i in range(len(frags) - 1))
    best = max(cands, key=lambda c: ((c["from"] != "fragment") == touching, c["conf"])) if cands else None
    return {"plate": best["plate"] if best else None, "conf": best["conf"] if best else 0.0, "raw": lines,
            "candidates": cands}


def read_chassis(path: str | Path) -> dict:
    lines = read_text(path)
    cands = [re.sub(r"[^A-Z0-9]", "", ln["text"].upper()) for ln in lines]
    best = max((c for c in cands if len(c) >= 11), key=len, default=None)
    conf = max((ln["conf"] for ln in lines), default=0.0)
    return {"chassis_no": best, "conf": conf, "raw": lines}


def render_plate(text: str, dst: Path) -> Path:
    """A Malaysian-style plate (white characters on black) photographed at the lane camera."""
    img = Image.new("RGB", (640, 260), (60, 64, 70))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([60, 70, 580, 190], radius=10, fill=(12, 12, 12), outline=(200, 200, 200), width=4)
    f = _font(84)
    w = d.textlength(text, font=f)
    d.text(((640 - w) / 2, 82), text, font=f, fill=(245, 245, 245))
    img = img.rotate(-2.5, resample=Image.BICUBIC, fillcolor=(60, 64, 70)).filter(ImageFilter.GaussianBlur(0.8))
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, quality=90)
    return dst


def render_chassis_plate(chassis: str, dst: Path) -> Path:
    """Stamped chassis-number plate as seen by the handheld OCR camera."""
    img = Image.new("RGB", (900, 220), (168, 170, 172))
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 880, 200], outline=(90, 90, 92), width=3)
    f = _font(64)
    w = d.textlength(chassis, font=f)
    d.text(((900 - w) / 2, 75), chassis, font=f, fill=(40, 40, 42))
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, quality=90)
    return dst

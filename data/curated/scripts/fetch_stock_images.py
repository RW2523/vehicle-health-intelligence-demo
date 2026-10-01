#!/usr/bin/env python3
"""Stock photos for the ten main vehicles and the generic scenes, from Wikimedia Commons (no API key).

The photos are representative photos of each model (the right generation for the Malaysian market, in the vehicle's
paint where Commons has it), not photos of the fictional vehicles themselves. Only public domain, CC0, CC BY and
CC BY-SA files are accepted; everything else (NC, ND, GFDL-only, fair use, unknown) is rejected.

  # 1. find candidates: thumbnails, metadata and labelled contact sheets in a scratch folder (nothing in the repo)
  python data/curated/scripts/fetch_stock_images.py --search --out /tmp/stock-search [--group dmo-9006]

  # 2. look at the contact sheets, write the chosen files into images/stock/picks.json

  # 3. download exactly the picks: images/stock/<slug>/<view>.jpg (1600 px, plus .960.jpg and .480.jpg),
  #    images/stock/manifest.json and the "Stock photos" section of LICENSES.md
  python data/curated/scripts/fetch_stock_images.py --picks

Requests are sequential with short pauses, and a search run looks at no more than MAX_CANDIDATES files.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import math
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

UA = "VehicleSenseDemo/1.0 (demo image fetch; https://github.com/RW2523/vehicle-health-intelligence-demo)"
API = "https://commons.wikimedia.org/w/api.php"
CURATED = Path(__file__).resolve().parent.parent
STOCK = CURATED / "images" / "stock"
PICKS = STOCK / "picks.json"
MANIFEST = STOCK / "manifest.json"
LICENSES = CURATED / "LICENSES.md"
SIZES = (1600, 960, 480)
QUALITY = 85
MAX_CANDIDATES = 300
PAUSE_API, PAUSE_FILE = 0.6, 0.35
LIC_START, LIC_END = "<!-- stock-photos:start -->", "<!-- stock-photos:end -->"

# Search queries per group, with how many candidates each may add: a main vehicle's slug (vhi/services/showcase.py) or
# "scenes/<id>". Malaysian-market generations: Myvi 3rd gen (2018+), Bezza, Civic FC, Atto 3, Scania P-series
# tractor, Ranger T6 (PX), HiAce H200, Vios XP150, Innova AN140, NV350 Urvan. Where Commons has a series of one car
# (front, rear, interior), the query aims at it so a vehicle's views share one paint colour.
QUERIES: dict[str, list[tuple[str, int]]] = {
    "dmo-9001": [("Scania P410 tractor unit", 5), ("Scania P410 XT", 3), ("Scania semi-trailer truck P-series 2016", 5),
                 ("Scania P-series cab interior dashboard", 3), ("Scania P 360 tractor 2018", 2),
                 ("Scania P-series tractor unit white", 6), ("Scania P 410 B 4x2 tractor", 4), ("Scania truck cab interior", 3),
                 ('"Scania P410"', 10)],
    "dmo-9002": [('"BYD ATTO 3 in Brisbane"', 6), ('"BYD Atto 3 (SC2E) in South Tangerang"', 3), ("BYD Atto 3 Japan interior", 2),
                 ("BYD Atto 3 Premium", 5), ("BYD Atto 3 front", 4)],
    "dmo-9003": [('"Honda CIVIC SEDAN (DBA-FC1)"', 8), ("Honda Civic 1.5 ES FC1", 4), ("2017 Honda Civic FC 1.5TC sedan", 3),
                 ("Honda Civic sedan 2016 white", 5)],
    "dmo-9006": [('"2021 Perodua Myvi" Brunei', 12), ("Perodua Myvi 1.5 AV facelift", 3), ('"2019 Perodua Myvi 1.5 AV"', 5),
                 ("Perodua Myvi engine bay", 2)],
    "vjm-7412": [('"2021 Perodua Bezza" Brunei', 9), ("Perodua Bezza 1.0 G", 5), ("Perodua Bezza silver", 4)],
    "wxd-2291": [('"Ford Ranger (PX) XLT"', 6), ("Ford Ranger XLT 2019", 6), ("Ford Ranger 2.2 XLT 2020", 4),
                 ("Ford Ranger interior dashboard 2016", 4), ("Ford Ranger interior", 5)],
    "bhy-7783": [('"Toyota HiAce (TRH201R) LWB van"', 2), ('"Toyota HiAce (KDH201R) LWB van"', 4), ("Toyota Hiace H200 van white", 8),
                 ("Toyota Hiace H200 interior dashboard", 3), ("Toyota HiAce DX van Japan", 3),
                 ("Toyota HiAce interior dashboard Japan", 4), ("Toyota Hiace H200 cockpit", 2)],
    "vkr-3128": [('"2021 Toyota Vios" Brunei', 3), ('"Toyota Vios NSP151" white', 8), ("ViosNSP151 089", 3), ('"2021 Toyota Vios GR-S (Malaysia)"', 4),
                 ('"2019 Toyota Vios 1.5" interior', 5), ("Toyota Vios interior dashboard", 4), ("Toyota Yaris Ativ interior", 2),
                 ("Toyota Vios engine bay", 2)],
    "pke-4410": [('"2019 Toyota Innova 2.0 G"', 8), ("Toyota Innova White Pearl Crystal Shine", 5), ("Toyota Kijang Innova 2.0 white", 4),
                 ("Toyota Innova interior dashboard", 3)],
    "jtr-5510": [('"Nissan NV350 CARAVAN"', 8), ("Nissan NV350 Urvan", 6), ("Nissan NV350 rear white", 3),
                 ("Nissan NV350 interior dashboard", 3)],
    "scenes/hub": [("Fahrzeugprüfhalle", 2), ("vehicle inspection station building", 4),
                   ("Motor Vehicle Inspection and Registration Office", 4), ("Strassenverkehrsamt Prüfhalle", 4),
                   ("MOT testing station", 4), ("vehicle inspection office Japan lane", 3), ("Kfz-Prüfstelle", 3)],
    "scenes/lane": [("roller brake tester", 4), ("Pista mixta de inspección", 2), ("Bremsenprüfstand", 4), ("Rollenprüfstand Fahrzeug", 4),
                    ("vehicle inspection lane Japan", 3)],
    "scenes/pit": [('"Inspection pits in Presidio Division"', 3), ("car inspection pit garage", 4), ("car on lift underside exhaust", 4),
                   ("Montagegrube Werkstatt", 3)],
    "scenes/flood": [('incategory:"December_2021_Malaysian_floods"', 8), ('incategory:"Floods_in_Malaysia"', 4), ("flood Shah Alam", 4)],
    "scenes/tyre": [('incategory:"Automobile_tire_treads"', 6), ('incategory:"Tyre_tread_patterns"', 6)],
    "scenes/login": [("Kuala Lumpur night highway", 5), ("Kuala Lumpur light trails", 5), ("Kuala Lumpur skyline dusk traffic", 6),
                     ("Kuala Lumpur skyline night", 5), ("Kuala Lumpur expressway night", 4), ("Malaysia highway sunset", 3)],
}


# ---- licences
def licence_ok(short: str | None, url: str | None, nonfree: str | None = None) -> bool:
    """Public domain, CC0, CC BY and CC BY-SA only. NC, ND, GFDL-only, fair use and unknown licences are rejected."""
    if not short or (nonfree or "").strip().lower() in ("true", "1", "yes"):
        return False
    s = short.strip()
    if re.search(r"\b(NC|ND)\b|GFDL|fair use|non-?free", s, re.I):
        return False
    if re.fullmatch(r"(CC0|CC0 1\.0|CC-0|Public domain|PD|PD[- ].*|Public Domain.*)", s, re.I):
        return True
    return bool(re.fullmatch(r"CC BY(-SA)? \d\.\d( [A-Za-z-]{2,6})?", s)) and bool(url)


def strip_html(s: str | None) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


# ---- HTTP
CACHE: Path | None = None  # --search keeps every response in <out>/cache, so a second run asks Commons only for what is new


def _get(url: str, pause: float) -> bytes:
    hit = CACHE / hashlib.sha1(url.encode()).hexdigest() if CACHE else None
    if hit and hit.exists():
        return hit.read_bytes()
    data = _fetch(url, pause)
    if hit:
        hit.write_bytes(data)
    return data


def _fetch(url: str, pause: float) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            time.sleep(pause)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(url)


def api(params: dict) -> dict:
    q = {"format": "json", "formatversion": "2", **params}
    return json.loads(_get(API + "?" + urllib.parse.urlencode(q), PAUSE_API))


def _clean_url(u: str) -> str:
    return u.split("?")[0] if u else u


IIPROPS = "url|size|mime|extmetadata"
META = "LicenseShortName|LicenseUrl|Artist|ImageDescription|NonFree|ObjectName"


def _info(page: dict) -> dict | None:
    ii = (page.get("imageinfo") or [None])[0]
    if not ii:
        return None
    m = ii.get("extmetadata") or {}
    v = lambda k: (m.get(k) or {}).get("value")  # noqa: E731
    return {
        "title": page["title"], "page_url": ii.get("descriptionurl"), "width": ii.get("width"), "height": ii.get("height"),
        "mime": ii.get("mime"), "thumb_url": _clean_url(ii.get("thumburl") or ii.get("url")), "original_url": _clean_url(ii.get("url")),
        "license": (v("LicenseShortName") or "").strip(), "license_url": (v("LicenseUrl") or "").strip(),
        "author": strip_html(v("Artist")), "description": strip_html(v("ImageDescription"))[:400], "nonfree": v("NonFree"),
    }


# ---- search
def search(out: Path, only: list[str] | None) -> None:
    global CACHE
    out.mkdir(parents=True, exist_ok=True)
    CACHE = out / "cache"
    CACHE.mkdir(exist_ok=True)
    (out / "thumbs").mkdir(exist_ok=True)
    (out / "sheets").mkdir(exist_ok=True)
    seen: set[str] = set()
    found: dict[str, list[dict]] = {}
    total = rejected = 0
    for group, queries in QUERIES.items():
        if only and group not in only and group.split("/")[0] not in only:
            continue
        rows: list[dict] = []
        for q, want_q in queries:
            if total >= MAX_CANDIDATES:
                break
            want = len(rows) + want_q
            res = api({"action": "query", "generator": "search", "gsrsearch": f"{q} filetype:bitmap filew:>1599",
                       "gsrnamespace": "6", "gsrlimit": str(min(50, max(12, 2 * want_q))), "prop": "imageinfo", "iiprop": IIPROPS,
                       "iiurlwidth": "330", "iiextmetadatafilter": META})
            pages = sorted((res.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 99))
            for p in pages:
                if len(rows) >= want or total >= MAX_CANDIDATES:
                    break
                info = _info(p)
                if not info or info["title"] in seen:
                    continue
                seen.add(info["title"])
                if info["mime"] not in ("image/jpeg", "image/png", "image/webp") or not licence_ok(info["license"], info["license_url"], info["nonfree"]):
                    rejected += 1
                    continue
                n = len(rows) + 1
                fn = out / "thumbs" / f"{group.replace('/', '_')}_{n:02d}.jpg"
                try:
                    fn.write_bytes(_get(info["thumb_url"], PAUSE_FILE))
                except Exception as e:  # noqa: BLE001
                    print("  skip", info["title"], e, file=sys.stderr)
                    continue
                total += 1
                rows.append({"n": n, "query": q, "thumb": str(fn), **info})
        found[group] = rows
        sheet(rows, out / "sheets" / f"{group.replace('/', '_')}.jpg", group)
        print(f"{group:14s} {len(rows):3d} candidates  (total {total}, rejected by licence/type {rejected})")
    (out / "candidates.json").write_text(json.dumps(found, indent=1, ensure_ascii=False))
    print(f"\n{total} candidates, contact sheets in {out / 'sheets'}; metadata in {out / 'candidates.json'}")


def _font(size: int):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def sheet(rows: list[dict], path: Path, group: str, cols: int = 4, tw: int = 330, th: int = 230) -> None:
    if not rows:
        return
    lab = 44
    W, H = cols * (tw + 8) + 8, math.ceil(len(rows) / cols) * (th + lab + 8) + 40
    im = Image.new("RGB", (W, H), (245, 247, 250))
    d = ImageDraw.Draw(im)
    big, small = _font(16), _font(11)
    d.text((10, 10), group, fill=(15, 23, 42), font=big)
    for i, r in enumerate(rows):
        x, y = 8 + (i % cols) * (tw + 8), 40 + (i // cols) * (th + lab + 8)
        try:
            t = ImageOps.contain(Image.open(r["thumb"]).convert("RGB"), (tw, th))
            im.paste(t, (x + (tw - t.width) // 2, y + (th - t.height) // 2))
        except Exception:  # noqa: BLE001
            d.rectangle((x, y, x + tw, y + th), outline=(200, 0, 0))
        d.rectangle((x, y, x + 34, y + 22), fill=(37, 99, 235))
        d.text((x + 5, y + 3), f"{r['n']:02d}", fill="white", font=big)
        d.text((x, y + th + 3), f"{r['license']} · {r['width']}x{r['height']}", fill=(30, 41, 59), font=small)
        d.text((x, y + th + 18), r["title"][5:5 + 52], fill=(71, 85, 105), font=small)
    im.save(path, quality=88)


# ---- picks
def _bucket(original_w: int, need: int) -> int:
    for b in (1920, 3840):
        if b >= need:
            return min(b, original_w)
    return original_w


def _resize_w(im: Image.Image, w: int) -> Image.Image:
    return im if im.width == w else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def _blur(im: Image.Image, boxes: list[list[float]]) -> Image.Image:
    """Make number plates (or other details) unreadable: each box is [left, top, right, bottom] as fractions."""
    for b in boxes:
        box = (round(b[0] * im.width), round(b[1] * im.height), round(b[2] * im.width), round(b[3] * im.height))
        part = im.crop(box)
        small = part.resize((max(1, part.width // 14), max(1, part.height // 14)), Image.BILINEAR)
        im.paste(small.resize(part.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(max(2, part.height // 10))), box)
    return im


def _save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=QUALITY, optimize=True, progressive=True)  # no exif= argument: EXIF is not written


def fetch_picks() -> None:
    cfg = json.loads(PICKS.read_text())
    picks: list[dict] = cfg["picks"]
    vehicles: dict = cfg.get("vehicles", {})
    infos: dict[str, dict] = {}
    titles = [p["title"] for p in picks]
    for i in range(0, len(titles), 40):  # the original sizes first, to choose the thumbnail size each crop needs
        res = api({"action": "query", "titles": "|".join(titles[i:i + 40]), "prop": "imageinfo", "iiprop": IIPROPS,
                   "iiextmetadatafilter": META})
        for p in (res.get("query") or {}).get("pages") or []:
            if "imageinfo" in p:
                infos[p["title"]] = _info(p)
    for t in titles:  # titles come back normalised: match them up again
        if t not in infos:
            alt = next((k for k in infos if k.replace("_", " ") == t.replace("_", " ")), None)
            if alt:
                infos[t] = infos[alt]
    images, missing = [], []
    for p in picks:
        info = infos.get(p["title"])
        if not info:
            missing.append(p["title"])
            continue
        if not licence_ok(info["license"], info["license_url"], info["nonfree"]):
            print("  REJECTED licence", info["license"], p["title"], file=sys.stderr)
            missing.append(p["title"])
            continue
        crop = p.get("crop") or [0, 0, 1, 1]
        need = math.ceil(SIZES[0] / max(0.05, crop[2] - crop[0]))
        w = _bucket(info["width"], need)
        if w >= info["width"]:
            url = info["original_url"]
        else:
            res = api({"action": "query", "titles": info["title"], "prop": "imageinfo", "iiprop": "url", "iiurlwidth": str(w)})
            url = _clean_url(res["query"]["pages"][0]["imageinfo"][0]["thumburl"])
        im = Image.open(io.BytesIO(_get(url, PAUSE_FILE)))
        im = ImageOps.exif_transpose(im).convert("RGB")
        if crop != [0, 0, 1, 1]:
            im = im.crop((round(crop[0] * im.width), round(crop[1] * im.height), round(crop[2] * im.width), round(crop[3] * im.height)))
        if p.get("blur"):
            im = _blur(im, p["blur"])
        group, view = p["slot"].split(".", 1)
        folder = STOCK / ("scenes" if group == "scene" else group)
        files = {}
        for size in SIZES:
            name = f"{view}.jpg" if size == SIZES[0] else f"{view}.{size}.jpg"
            out = _resize_w(im, size) if im.width > size or size == SIZES[0] else im
            _save(out, folder / name)
            files[str(size)] = str((folder / name).relative_to(CURATED))
            if size == SIZES[0]:
                width, height = out.width, out.height
        sha1 = hashlib.sha1((folder / f"{view}.jpg").read_bytes()).hexdigest()
        v = vehicles.get(group, {})
        images.append({
            "slot_id": p["slot"], "group": "scenes" if group == "scene" else group, "plate": v.get("plate"), "view": view,
            "files": files, "width": width, "height": height, "title": info["title"], "page_url": info["page_url"],
            "author": info["author"] or "Unknown author", "license": info["license"], "license_url": info["license_url"] or None,
            "source": "Wikimedia Commons", "sha1": sha1, "representative": True,
            "note": "Representative photo of the model, not the actual vehicle" if v else "Representative photo",
            **({"paint": p.get("paint", v.get("paint")), "paint_hex": p.get("paint_hex", v.get("paint_hex"))} if v else {}),
            **({"crop": crop} if crop != [0, 0, 1, 1] else {}), **({"blurred": "number plate"} if p.get("blur") else {}),
        })
        print(f"  {p['slot']:22s} {width}x{height}  {info['license']:14s} {info['title'][5:70]}")
    manifest = {
        "about": "Stock photos from Wikimedia Commons: representative photos of each model (the vehicle's generation "
                 "and, where Commons has it, its paint), not photos of the fictional vehicles. Paths are relative to "
                 "data/curated and are served by the API under /media/data/. Re-download with "
                 "scripts/fetch_stock_images.py --picks.",
        "source": "Wikimedia Commons", "licences_allowed": ["Public domain", "CC0", "CC BY", "CC BY-SA"],
        "sizes": list(SIZES), "vehicles": vehicles, "count": len(images), "images": images,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    write_licences(images, vehicles)
    total = sum(f.stat().st_size for f in STOCK.rglob("*.jpg"))
    print(f"\n{len(images)} photos, {total / 1e6:.1f} MB in {STOCK}")
    if missing:
        print("not found or rejected:", *missing, sep="\n  ", file=sys.stderr)
        sys.exit(1)


def write_licences(images: list[dict], vehicles: dict) -> None:
    rows = []
    for im in images:
        who = vehicles.get(im["group"], {}).get("plate") or "Scene"
        lic = f"[{im['license']}]({im['license_url']})" if im["license_url"] else im["license"]
        title = im["title"].replace("|", "\\|")
        rows.append(f"| `{im['files']['1600'].removeprefix('images/stock/')}` | {who} · {im['view']} | "
                    f"[{title}]({im['page_url']}) | {im['author'].replace('|', '/')} | {lic} |")
    section = "\n".join([
        LIC_START, "", "## Stock photos", "",
        "`images/stock/` holds representative photos of the ten main vehicles' models and of generic scenes, from "
        "[Wikimedia Commons](https://commons.wikimedia.org/). They show the model, not the fictional vehicle. Only public "
        "domain, CC0, CC BY and CC BY-SA files are used; each is credited in the app next to the photo. CC BY-SA photos "
        "that are cropped or resized are shared under the same licence. Fetched with `scripts/fetch_stock_images.py --picks` "
        "(the list is `images/stock/picks.json`, the metadata `images/stock/manifest.json`).", "",
        "| File | Used for | Source | Author | Licence |", "|---|---|---|---|---|", *rows, "", LIC_END, ""])
    text = LICENSES.read_text()
    if LIC_START in text:
        text = text[:text.index(LIC_START)] + section + text[text.index(LIC_END) + len(LIC_END):].lstrip("\n")
    else:
        text = text.rstrip("\n") + "\n\n" + section
    LICENSES.write_text(text)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--search", action="store_true", help="find candidates and write contact sheets to --out")
    g.add_argument("--picks", action="store_true", help="download the files listed in images/stock/picks.json")
    ap.add_argument("--out", type=Path, default=Path(tempfile.gettempdir()) / "vehiclesense-stock-search")
    ap.add_argument("--group", action="append", help="search only these groups (slug, 'scenes' or 'scenes/<id>')")
    ap.add_argument("--cache", type=Path, help="--picks: keep the downloads here (re-runs while adjusting crops ask Commons once)")
    a = ap.parse_args()
    global CACHE
    if a.cache:
        a.cache.mkdir(parents=True, exist_ok=True)
        CACHE = a.cache
    if a.search:
        search(a.out, a.group)
    else:
        fetch_picks()


if __name__ == "__main__":
    main()

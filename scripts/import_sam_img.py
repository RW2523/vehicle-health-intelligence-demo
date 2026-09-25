#!/usr/bin/env python3
"""Import the VehicleSense demo image set (the `sam_img` folder) into the repo, de-duplicated, with a mapping.

    python scripts/import_sam_img.py /path/to/sam_img [--dest data/curated/images/vehiclesense_demo]

Creates, under the destination:
  full/      full-resolution PNGs (the 16 fleet/lane comparisons, the extra lane case, the 9 close-up/progression sheets)
  web/       web-size JPGs of the same images (from sam_img/_small and sam_img/1/_small, or generated)
  series/    the crops used by the app (n1o/n1a ... n9_2), as delivered in sam_img/1/_small
  manifest.json   one entry per image: what it shows, where it came from (every duplicate path), which app capture
                  and fleet vehicles use it, sizes and SHA-1 checksums
  README.md       the same mapping as a table

It also (re)creates the app capture crops for "Lane 3 · Case 2" (c17o.jpg / c17a.jpg) from the split-screen image, using
the same crop geometry as the other lane captures. Re-run it whenever images are added; unknown images are listed under
"unmapped" in the manifest instead of being dropped.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
CAPTURES = REPO / "app/backend/assets/captures"

# number -> (slug, kind, title) for sam_img/<n>.png ; ids 1..16 are the source of app captures cNN (same number)
SHEETS = {
    1: ("fleet-case-07_windshield-crack", "Fleet case 7 · windshield crack"),
    2: ("fleet-case-08_headlamp-haze_panel-misalignment", "Fleet case 8 · headlamp haze, panel misalignment"),
    3: ("fleet-case-09_tyre-uneven-wear_sidewall-bulge", "Fleet case 9 · uneven tyre wear, sidewall bulge"),
    4: ("fleet-case-10_van-tail-lamp-crack_door-misalignment", "Fleet case 10 · tail lamp crack, rear door misalignment"),
    5: ("fleet-case-11_interior-flood-water-ingress", "Fleet case 11 · flood / water ingress in the cabin"),
    6: ("fleet-case-12_underbody-heat-shield_bracket-corrosion", "Fleet case 12 · loose heat shield, bracket corrosion"),
    7: ("fleet-case-01_sedan-dent-scratch-rust", "Fleet case 1 · sedan dent, scratch, rust"),
    8: ("fleet-case-02_van-dent-scratch-rust", "Fleet case 2 · panel van dent, scratch, rust"),
    9: ("fleet-case-03_pickup-underbody-fluid-leak", "Fleet case 3 · pickup underbody fluid leak"),
    10: ("fleet-case-04_hatchback-roof-dent", "Fleet case 4 · hatchback roof dent"),
    11: ("fleet-case-05_interior-wear-stains", "Fleet case 5 · interior wear and stains"),
    12: ("fleet-case-06_mpv-scratch", "Fleet case 6 · MPV scratch"),
    13: ("lane-case-5_pit-fluid-leak", "Lane 3 · Case 5 · pit camera fluid leak"),
    14: ("lane-case-4_roof-dent_VJM7412", "Lane 3 · Case 4 · roof dent (VJM 7412)"),
    15: ("lane-case-3_rear-scratch_VJM7412", "Lane 3 · Case 3 · rear scratch (VJM 7412)"),
    16: ("lane-case-1_front-dent-scratch-rust_VJM3287", "Lane 3 · Case 1 · dent, scratch, rust (VJM 3287)"),
}
# the extra lane case that only exists under VehicleSense_Full_Demo/assets
EXTRA = {"split_screen_ai_vehicle_inspection.png": (17, "lane-case-2_rear-dent-scratch-rust_VJM7412",
                                                    "Lane 3 · Case 2 · rear dent, scratch, rust (VJM 7412)")}
# sam_img/1/i<k>.png : close-ups (k=1..6, app captures n<k>o/a) and month-by-month progressions (k=7..9)
SERIES = {
    1: ("closeup-brakes_disc-scoring_VKR3128", "closeup", "Close-up · brakes: disc scoring, uneven pad wear (VKR 3128)"),
    2: ("closeup-emissions_smoke-soot_BHY7783", "closeup", "Close-up · emissions: visible smoke, soot (BHY 7783)"),
    3: ("closeup-suspension_oil-wet-shock_JTR5510", "closeup", "Close-up · suspension: oil-wet shock, cracked bush (JTR 5510)"),
    4: ("closeup-adas-camera-tilt_PKE4410", "closeup", "Close-up · ADAS camera mount tilted (PKE 4410)"),
    5: ("closeup-12v-battery-corrosion_VJM7412", "closeup", "Close-up · 12 V battery terminal corrosion, swelling (VJM 7412)"),
    6: ("closeup-brake-pads-5mm_WVA1209", "closeup", "Close-up · brake pads at 5 mm (WVA 1209)"),
    7: ("progression-rust_jan-may-sep-2026_VJM3287", "progression", "Progression · rust at the wheel arch, Jan → May → Sep 2026 (VJM 3287)"),
    8: ("progression-tread-wear_nov2025-apr-sep-2026_WXD2291", "progression", "Progression · tyre tread wear, Nov 2025 → Apr → Sep 2026 (WXD 2291)"),
    9: ("progression-windscreen-crack_mar-jun-sep-2026_BPR7730", "progression", "Progression · windscreen crack growth, Mar → Jun → Sep 2026 (BPR 7730)"),
}
LANE_CROP_ORIG, LANE_CROP_AI, CROP_SIZE = (0, 204, 720, 1085), (728, 204, 1448, 1085), (560, 685)


def sha1(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def fleet_usage() -> dict[str, list[str]]:
    """capture file -> plates that use it (from the fleet seed's hero vehicles)."""
    import sys
    sys.path.insert(0, str(REPO / "app/backend"))
    from vhi.seed.fleet import HEROES  # noqa: E402
    use: dict[str, list[str]] = {}
    for h in HEROES:
        for f in [h.get("photo"), *h.get("evidence", []), *(h.get("photos") or {}).values()]:
            if f:
                use.setdefault(f, []).append(h["plate"])
    return {k: sorted(set(v)) for k, v in use.items()}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("--dest", type=Path, default=REPO / "data/curated/images/vehiclesense_demo")
    a = ap.parse_args()
    src, dest = a.src.resolve(), a.dest.resolve()
    for sub in ("full", "web", "series"):
        (dest / sub).mkdir(parents=True, exist_ok=True)

    # every image in the source folder, grouped by content (duplicates share one entry)
    by_hash: dict[str, list[str]] = {}
    for p in sorted(src.rglob("*")):
        if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg"):
            by_hash.setdefault(sha1(p), []).append(str(p.relative_to(src)))
    usage = fleet_usage()
    captures = json.loads((CAPTURES / "captures.json").read_text())
    case_by_file = {c["original"]: c for c in captures["cases"]}
    used: set[str] = set()
    entries = []

    def add(num_id: str, kind: str, slug: str, title: str, full_src: Path, web_src: Path | None, app: dict | None,
            crops: list[str], findings: list | None, vehicle: str | None, camera: str | None):
        full_rel = f"full/{num_id}_{slug}.png"
        shutil.copy2(full_src, dest / full_rel)
        web_rel = f"web/{num_id}_{slug}.jpg"
        if web_src and web_src.exists():
            shutil.copy2(web_src, dest / web_rel)
        else:  # generate a web copy
            im = Image.open(full_src).convert("RGB")
            im.thumbnail((1400, 1400))
            im.save(dest / web_rel, quality=85)
        h = sha1(full_src)
        sources = by_hash.get(h, [str(full_src.relative_to(src))])
        used.update(sources)
        if web_src and web_src.exists():
            used.update(by_hash.get(sha1(web_src), []))
        w, hgt = Image.open(full_src).size
        plates = sorted({pl for c in crops for pl in usage.get(c, [])})
        entries.append({
            "id": num_id, "kind": kind, "title": title,
            "full": f"images/vehiclesense_demo/{full_rel}", "web": f"images/vehiclesense_demo/{web_rel}",
            "width": w, "height": hgt, "sha1": h, "source_files": sources,
            "app_capture": app, "crops": [f"captures/{c}" for c in crops], "used_by_vehicles": plates,
            "vehicle": vehicle, "camera": camera, "findings": findings or [],
        })

    # 1..16 comparisons + the extra lane case
    for n, (slug, title) in SHEETS.items():
        c = case_by_file.get(f"c{n:02d}o.jpg")
        add(f"{n:02d}", "comparison", slug, title, src / f"{n}.png", src / "_small" / f"{n}.jpg",
            c and {"capture_id": c["id"], "original": c["original"], "ai": c["ai"]}, [f"c{n:02d}o.jpg", f"c{n:02d}a.jpg"],
            c and c["findings"], c and c["vehicle"], c and c["camera"])
    for fname, (n, slug, title) in EXTRA.items():
        p = next(src.rglob(fname), None)
        if p is None:
            continue
        # app capture crops for this case, same geometry as the other lane captures
        im = Image.open(p).convert("RGB")
        im.crop(LANE_CROP_ORIG).resize(CROP_SIZE, Image.LANCZOS).save(CAPTURES / f"c{n}o.jpg", quality=88)
        im.crop(LANE_CROP_AI).resize(CROP_SIZE, Image.LANCZOS).save(CAPTURES / f"c{n}a.jpg", quality=88)
        c = case_by_file.get(f"c{n}o.jpg")
        add(f"{n:02d}", "comparison", slug, title, p, None, c and {"capture_id": c["id"], "original": c["original"], "ai": c["ai"]},
            [f"c{n}o.jpg", f"c{n}a.jpg"], c and c["findings"], c and c["vehicle"], c and c["camera"])
    # close-ups and progressions
    for k, (slug, kind, title) in SERIES.items():
        full = src / "1" / f"i{k}.png"
        if not full.exists():
            continue
        small = src / "1" / "_small"
        web = small / (f"n{k}full.jpg" if kind == "closeup" else f"n{k}.jpg")
        crops = [f"n{k}o.jpg", f"n{k}a.jpg"] if kind == "closeup" else [f"n{k}_0.jpg", f"n{k}_1.jpg", f"n{k}_2.jpg"]
        for c in crops:  # series crops as delivered
            if (small / c).exists():
                shutil.copy2(small / c, dest / "series" / c)
                used.update(by_hash.get(sha1(small / c), []))
        c = case_by_file.get(f"n{k}o.jpg")
        add(f"i{k}", kind, slug, title, full, web, c and {"capture_id": c["id"], "original": c["original"], "ai": c["ai"]},
            crops, c and c["findings"], c and c["vehicle"], c and c["camera"])

    unmapped = sorted(f for fs in by_hash.values() for f in fs if f not in used)
    manifest = {
        "about": "VehicleSense demo image set: sample inspection images with AI boxes pre-drawn (not model output). "
                 "Paths are relative to data/curated and are served by the API under /media/data/.",
        "source_folder": "sam_img (imported with scripts/import_sam_img.py)",
        "counts": {"images": len(entries), "series_crops": len(list((dest / "series").glob("*.jpg"))),
                   "source_files": sum(len(v) for v in by_hash.values()), "unique_source_images": len(by_hash)},
        "images": entries, "unmapped": unmapped,
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))

    rows = ["| ID | Image | Kind | App capture | Used by vehicles | Original file(s) in sam_img |", "|---|---|---|---|---|---|"]
    for e in entries:
        cap = f"#{e['app_capture']['capture_id']} (`{e['app_capture']['original']}`)" if e["app_capture"] else "—"
        rows.append(f"| {e['id']} | [{e['title']}]({e['full'].split('vehiclesense_demo/')[1]}) | {e['kind']} | {cap} | "
                    f"{', '.join(e['used_by_vehicles']) or '—'} | {'<br>'.join(f'`{s}`' for s in e['source_files'])} |")
    (dest / "README.md").write_text(
        "# VehicleSense demo images\n\n"
        "Sample inspection images used by the VehicleSense AI demo. The AI boxes and labels are **pre-drawn on the images** "
        "(sample data, not model output); the app labels them as *Sample images*.\n\n"
        "- `full/` full-resolution PNGs · `web/` web-size JPGs · `series/` the crops the app shows\n"
        "- `manifest.json` has the same mapping in machine-readable form, plus findings, sizes and SHA-1 checksums\n"
        "- Re-import after adding images: `python scripts/import_sam_img.py /path/to/sam_img`\n\n"
        + "\n".join(rows) + "\n\n"
        + (f"Unmapped source files (kept out of the app): {', '.join(f'`{u}`' for u in unmapped)}\n" if unmapped else "")
    )
    print(json.dumps(manifest["counts"]), "unmapped:", len(unmapped))


if __name__ == "__main__":
    main()

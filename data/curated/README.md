# PUSPAKOM Vehicle Health Intelligence — Demo Dataset v1

This folder holds the collected and curated data for the DGX Spark demo, captured on 24 Sep 2026. It has four layers:

1. **Real public data (collected from the web):**
    - 3,134 images: corrosion, vehicle damage, tyres, Malaysian plates
    - 1,346 audio clips: normal and knocking engines, and 40+ labelled fault sounds
    - Gas-sensor e-nose data, NASA EV battery ageing data and real OBD-II driving logs
    - US salvage auctions with flood/damage/age/mileage fields, UK MOT failure rates, insurance claims and JPJ 2025 registrations
2. **Live Malaysian open data:** `web_live/` holds today's snapshots of fuel price, weather forecast and warnings, and JPS flood stations, plus a fetcher that polls these live on the DGX Spark.
3. **Synthetic demo world:** 5,000 fictional vehicles, 3 years of inspections, insurance claims, bookings, lane telemetry and roadside remote sensing. It is calibrated to the real data and carries hidden ground-truth faults for the AI to find.
4. **Six scripted demo sessions (S1–S6):** each has real-time sensor streams and references to the real media.

| Folder | What |
|---|---|
| `images/` | Real images by domain / label |
| `audio/` | Real audio clips by label |
| `sensors/` | E-nose (UCI), EV battery (NASA), OBD logs + DTC dictionaries |
| `tabular/` | Salvage/flood auctions, UK MOT, insurance claims, used cars, Malaysia registrations/traffic |
| `synthetic/` | Demo fleet, inspections, claims, bookings, telemetry, remote sensing |
| `sessions/` | S1–S6 session files + streams + e-nose signature library |
| `web_live/` | Live data fetcher + today's snapshots |
| `reports/` | Pattern comparison charts |
| `scripts/` | Everything needed to rebuild: source list, clone, curate, generate, analyse |
| `manifest.csv` | One row per curated file: source, licence, original path, label |

Read next: `CATALOG.md` for what is in each folder and the known gaps, `PATTERNS.md` for the age/insurance/flood/damage comparisons, and `LICENSES.md` before any use outside the demo.

## Rebuild from scratch (on the DGX Spark)

```
cd scripts
cat sources.tsv more.tsv | xargs -P 8 -L 1 ./clone.sh     # ~5.3 GB raw from GitHub
python curate.py && python gen_synthetic.py && python gen_sessions.py && python patterns.py
python ../web_live/fetch_live.py --loop                    # live feeds every 15 min
```

The scripts assume `/home/claude/dl` as the base path. Edit `BASE` / `RAW` / `OUT` at the top of each script.

## Filling the gaps (needs a browser login, not reachable from this workspace)

These public sets would close the flood and vehicle-corrosion image gaps. Download them on the DGX Spark, or with your browser, into `raw/`, then rerun `curate.py`:
- Kaggle: "Car Damage Severity Dataset", "Vehicle rust / corrosion detection", "Flooded vehicle images", "Tyre Quality Classification" (full set)
- Roboflow Universe: search "car rust", "underbody corrosion", "flooded car", "car damage segmentation"
- CarDD (Car Damage Detection, USTC): 4,000 images, 6 damage classes, research licence
- Mendeley "TyreNet": annotated tyre defects
- data.gov.my: full `cars_2025/2026.parquet` registrations (the fetcher downloads these when online)

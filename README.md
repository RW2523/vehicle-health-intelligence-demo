# VehicleSense AI — Vehicle Health Intelligence demo

A working end-to-end concept demo of an AI-assisted vehicle inspection platform. It runs locally on an NVIDIA DGX Spark or on a laptop. Simulated lane sensors stream into a live pipeline. There, real trained models and rule logic score the vehicle. An examiner decides the ranked alerts and issues a tamper-evident report that a buyer can verify. The demo also includes the fleet, HQ, regulator and owner apps, all built on the same data.

**Independent concept work. It is not an official product of any inspection body.** All vehicles, owners, examiners and fleets are fictional (demo plates use the prefix `DMO`). Every panel in the UI is labelled with how its content is produced: *live model*, *live logic*, *simulated*, *synthetic data*, *real public data*, *sample images* or *mock*.

---

## Quick start (laptop, no Docker)

Requirements: Python 3.11+, Node 20+ (22 recommended) and about 2 GB of disk.

```bash
make setup      # .venv + pip install + npm ci
make start      # seeds the database (first run ~1–2 min), trains any missing models, builds the web app, starts both servers
open http://localhost:3000
```

`make stop`, `make restart`, `make status` and `make logs` manage the two servers. The same commands are available as `scripts/dev.sh <command>`.

It runs out of the box with SQLite, an in-process message bus and the built-in template engine for the assistant. The trained model files are committed in `app/backend/models/`.

## On the DGX Spark (Docker)

```bash
make up         # docker compose: TimescaleDB + Mosquitto (MQTT) + API + web
make up-llm     # the same, plus Ollama on the GPU and a pull of qwen3:32b for the assistant and report summaries
```

Open `http://<spark-host>:3000`. The browser also opens the live WebSocket on port **8000**, so keep that port reachable.

- **Multi-arch images.** Everything builds natively for `linux/arm64`, the Grace CPU in the DGX Spark:
  - `python:3.11-slim`
  - `node:22-slim`
  - `timescale/timescaledb`
  - `eclipse-mosquitto`
  - `ollama/ollama`

  No NGC base image is needed, because inference runs on onnxruntime, LightGBM and scikit-learn.
- **Ollama and the GPU.** The Ollama service reserves the GPU through the NVIDIA container runtime, which is preinstalled on DGX OS.
- **Using a different Ollama.** Set `VHI_OLLAMA_URL` (for example `http://host.docker.internal:11434`) and `VHI_OLLAMA_MODEL` in a `.env` file next to `docker-compose.yml`.
- **Report QR codes.** The QR codes on reports point to `VHI_PUBLIC_BASE_URL`. Set it to `http://<spark-host>:3000` so a phone can scan them.
- **Lane sensors.** Real or simulated lane sensors can publish JSON to the broker on port 1883, on topics `lane/<lane_id>/<sensor>`. The player uses the same topics.
- **Retraining the vision models on the GPU:**

  ```bash
  .venv/bin/pip install ultralytics onnx onnxslim
  make train-vision DEVICE=0
  ```

  This defaults to 30 epochs at 224 px. It writes `app/backend/models/vision/*.onnx`.

## The demo: six sessions

Start from **Demo control** (`/`). Lane sessions replay real-time sensor streams. You can play, pause, change speed, jump to a step, inject changes live, or **Fast-forward** to the end instantly. Everything downstream is computed live from those streams.

| Session | What happens | Where to look |
|---|---|---|
| **S1** DMO 9001 · Scania prime mover | E-nose ammonia slip and hot brake smell, thermal hot hub, particle number showing a removed DPF, roller-brake imbalance, a tyre defect from the image model and wheel-bearing noise. Health score 37; verdict **FAIL**. | Lane → Examiner → Report → Verify |
| **S2** DMO 9002 · EV, flood history | Flood-damage evidence (cabin image, e-nose musty signal, insurance claim), BMS pack state of health and module spread, EV fault codes. Verdict **CONDITIONAL**. | Lane, Examiner |
| **S3** DMO 9003 · ownership transfer | The plate is read (OCR), and the chassis-plate OCR and engine-sound fingerprint disagree with the vehicle's history. The inspection is routed to a senior examiner; verdict **REFERRED**. | Examiner |
| **S4** HQ | Examiner integrity (VE017 and VE044 flagged), lane-equipment predictive maintenance (BR00 lane 3 roller tester), 14-day demand forecast and roster, and a hash-chain audit with a live tamper test. | HQ |
| **S5** Fleet + regulator | Five operators plus FLEET07: degradation history per vehicle, anomalies, time-to-limit forecasts, pattern reports, bulk booking and next-Berkala fail risk. The regulator view shows real JPJ registrations and live data.gov.my feeds. | Fleet, Vehicle history, Regulator |
| **S6** Owner app | An assistant in BM, English and Chinese; GEAR slot booking with a mock payment and check-in QR; a self-check (tint and headlamp fail, then pass); the Health Passport. | Owner app |

### Suggested 10-minute walkthrough

1. Demo control: start **S1** at 4×.
2. Open the **Lane** console and watch the sensors and alerts arrive.
3. Go to the **Examiner** console:
   - Confirm the alerts. Dismissing one needs a reason.
   - Issue the report.
   - Open "What the buyer sees" to show the verification page.
4. **Fleet**: filter by *With photos*, then open VKR 3128 to show its brake-imbalance history, the anomaly and the forecast. Send the pattern report and book an inspection.
5. **HQ**: click *Run tamper test*.
6. **Owner app**: ask the assistant in BM, run the self-check twice, then book a slot.

## Architecture

```
simulated lane streams (data/curated/sessions/S1–S3)          Next.js web apps (app/web, :3000)
        │ SessionPlayer (real-time, overrides, seek)            ▲  REST via /api rewrites, media via /media
        ▼                                                       │  live updates over WebSocket :8000/ws
  message bus: in-process or MQTT (lane/<lane>/<sensor>) ──► StreamProcessor ──► WebSocket hub
                                                                │  per-lane workers, models in threads
                                                                ▼
  models (app/backend/models) ──► alerts ▸ ranking ▸ fusion health score ▸ rules ▸ evidence hash chain
                                                                │
                                         SQLite / PostgreSQL + TimescaleDB (readings hypertable)
```

- **Backend** `app/backend`: FastAPI, SQLAlchemy 2 and Pydantic settings (`VHI_*` environment variables). OpenAPI docs are at `/docs`.
- **Frontend** `app/web`: Next.js 15, React 19 and Tailwind. The charts are custom SVG with no charting library.
- **Data** `data/curated`: real public datasets plus a synthetic world and the session scripts. See `data/curated/README.md`, `CATALOG.md`, `PATTERNS.md` and `LICENSES.md`.
- **Demo images** `data/curated/images/vehiclesense_demo`: the 26 source inspection images (full-resolution PNG + web JPG + the crops the app shows), de-duplicated. `manifest.json` / `README.md` there map each image to its original file name(s), the app capture, the fleet vehicles that use it, and its findings. They appear on the AI vision page under *Image library*, and at `GET /api/vision/library`. To add more: `python scripts/import_sam_img.py /path/to/sam_img`.

### Models (all run live; metrics are from held-out data)

| Model | What it does | Result |
|---|---|---|
| Tyre classifier | YOLO11n-cls fine-tuned on curated tyre images, run with ONNX Runtime | 93.9% validation accuracy |
| Body-damage classifier | YOLO11n-cls, 3 classes (normal / breakage / crushed) | 75.4% validation accuracy |
| Corrosion | HSV rust segmentation, calibrated on rust vs clean photos | 89% balanced accuracy |
| Plate / chassis OCR | RapidOCR (PaddleOCR via ONNX) with Malaysian plate grammar | — |
| E-nose | XGBoost on the UCI gas-sensor array, plus a Bayesian context prior | 99.4% random split; 72.3% on later batches (sensor drift) |
| Engine / fault sound | Log-mel features → logistic regression (9 classes); PCA fingerprint | CV accuracy 76.5%; fingerprint EER 13% |
| EV battery SOH | BMS modules plus a NASA capacity-fade model | MAE 1.0 SOH points |
| Health score | LightGBM with SHAP factors, plus a transparent rule layer | AUC 0.989 (time split) |
| Next-fail / survival | LightGBM plus Weibull AFT (lifelines) | AUC 0.687, concordance 0.70 |
| Flood damage | LightGBM on physical evidence only; claim history added as a rule | AUC 0.974 |
| Demand forecast | LightGBM with holidays and lags | 14-day MAPE 6.3% (naive: 10.3%) |
| Examiner integrity / equipment | z-score plus Isolation Forest; vibration trend to limit | — |
| Degradation analysis | Theil-Sen wear model; spike, step, rate-change, new-damage and repair detection; forecast with a range | — |

Retrain everything except vision with `make train` (a few minutes on CPU).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VHI_DATABASE_URL` | SQLite in `app/backend/var/` | e.g. `postgresql+psycopg://vhi:vhi@db:5432/vhi`; uses TimescaleDB when the extension exists |
| `VHI_MQTT_URL` | in-process bus | e.g. `mqtt://mqtt:1883` |
| `VHI_OLLAMA_URL` / `VHI_OLLAMA_MODEL` | none / `qwen3:32b` | local LLM for the assistant and report summaries; falls back to the template engine (labelled in the UI) |
| `VHI_PUBLIC_BASE_URL` | `http://localhost:3000` | base URL encoded in report QR codes |
| `VHI_DATA_DIR`, `VHI_VAR_DIR` | repo `data/curated`, `app/backend/var` | data and runtime-state locations |
| `VHI_API_INTERNAL` | `http://127.0.0.1:8000` | where the web server forwards `/api` (fixed at `next build` time) |
| `NEXT_PUBLIC_WS_URL` | `ws://<page host>:8000/ws` | override the WebSocket address, e.g. behind a reverse proxy |

## Tests

```bash
make test                                                          # 27 backend tests (SQLite)
VHI_DATABASE_URL=postgresql+psycopg://... make test                # the same suite on PostgreSQL (add VHI_MQTT_URL=... for MQTT)
make e2e                                                           # 12 Playwright end-to-end tests (needs `make start`;
                                                                   # first time: cd app/web && npx playwright install chromium)
```

The end-to-end tests drive the real UI through all six sessions:
- **S1:** examiner decisions → report → public verification.
- **S2:** flood evidence. **S3:** routing to a senior examiner.
- **S4:** HQ tamper test.
- **S5:** fleet pattern report and booking, FLEET07 risk, the regulator view.
- **S6:** assistant, self-check and paid booking.
- The live vision model.

## Troubleshooting

- **"The API is not reachable" on Demo control.** Run `make status`, then `make logs`. The first start seeds the database, which takes 1–2 minutes.
- **Live updates don't arrive.** The browser needs port 8000 for the WebSocket. Behind a proxy, set `NEXT_PUBLIC_WS_URL` and rebuild the web app.
- **Start over with a clean demo.** Run `make reset`. It clears issued reports, bookings, lane sessions, chats and evidence, keeps the seeded world, and restarts. With Docker, run `docker compose exec api python -m vhi.seed --reset-runtime && docker compose restart api`.
- **Rebuild the whole world.** Run `make seed`, or delete `app/backend/var/vhi.db`. With Docker, use `docker compose down -v`.
- **Fonts look plain offline.** The UI loads Sora and IBM Plex from Google Fonts and falls back to system fonts without internet.

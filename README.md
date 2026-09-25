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

## On the DGX Spark, always on (no Docker, GPU models)

```bash
make setup      # once
make spark      # = scripts/spark.sh install: systemd user services for the API (:8120, localhost) and web (:3120)
make spark-status
```

Open `http://<spark-host>:3120` (LAN or Tailscale address). The services start at boot (with `loginctl enable-linger`) and restart on failure; `scripts/spark.sh restart | logs | uninstall` manage them. Settings live in `~/.config/vehiclesense/env`. The first install writes it with the GPU model servers on the Spark:

- **Assistant and report summaries:** `nvidia/Qwen3-30B-A3B-FP4` (NVFP4 mixture-of-experts) on TensorRT-LLM (`trtllm-serve`, port 8355), about 1-2 s per answer in BM, English or Chinese. Any OpenAI-compatible server works (vLLM, NIM): set `VHI_LLM_URL` and `VHI_LLM_MODEL`.
- **Photo explanations:** a vision-language model (`Qwen2.5-VL-7B-Instruct` on vLLM) gives a plain-words second opinion next to the image classifiers on the AI vision page. Set `VHI_VLM_URL` and `VHI_VLM_MODEL`, or leave them empty to switch it off.
- **Report QR codes:** links and QR codes use the address the visitor opened (LAN, Tailscale or the public URL below); the web server forwards it to the API. `VHI_PUBLIC_BASE_URL` (the Spark's Tailscale address) is the fallback for direct API calls.

If a model server is down, the assistant and reports fall back to the template engine and the photo explanation is not offered. The UI labels which one answered.

**Public URL.** `scripts/spark.sh tunnel` (or `make spark-tunnel`) adds a third always-on service: a Cloudflare quick tunnel that serves the apps at a public `https://<random-words>.trycloudflare.com` address, with the live WebSocket and QR codes working through it. No Cloudflare account is needed.

- `scripts/spark.sh url` prints the current address and checks it end to end; `scripts/spark.sh tunnel off` removes it.
- The hostname changes whenever the tunnel service restarts, for example after a reboot. Restarting the API or web keeps it. A fixed hostname needs a named tunnel on your own Cloudflare domain.
- Anyone with the link can use the demo; there is no login. `scripts/spark.sh reset` clears what visitors did (reports, bookings, lane sessions, evidence) and keeps the seeded world.

## On the DGX Spark (Docker)

```bash
make up         # docker compose: TimescaleDB + Mosquitto (MQTT) + API + web
make up-llm     # the same, plus Ollama on the GPU and a pull of qwen3:32b for the assistant and report summaries
```

Open `http://<spark-host>:3000`. The web server also proxies the live WebSocket (`/ws`) to the API, so only port 3000 needs to be reachable.

- **Multi-arch images.** Everything builds natively for `linux/arm64`, the Grace CPU in the DGX Spark:
  - `python:3.11-slim`
  - `node:22-slim`
  - `timescale/timescaledb`
  - `eclipse-mosquitto`
  - `ollama/ollama`

  No NGC base image is needed, because inference runs on onnxruntime, LightGBM and scikit-learn.
- **Ollama and the GPU.** The Ollama service reserves the GPU through the NVIDIA container runtime, which is preinstalled on DGX OS.
- **Using a different Ollama.** Set `VHI_OLLAMA_URL` (for example `http://host.docker.internal:11434`) and `VHI_OLLAMA_MODEL` in a `.env` file next to `docker-compose.yml`.
- **Report QR codes.** The QR codes on reports point to the address the page was opened at (the web service forwards it), so open the apps at `http://<spark-host>:3000` rather than `localhost` when a phone should scan them. `VHI_PUBLIC_BASE_URL` is the fallback.
- **Lane sensors.** Real or simulated lane sensors can publish JSON to the broker on port 1883, on topics `lane/<lane_id>/<sensor>`. The player uses the same topics.
- **Retraining the vision models on the GPU.** Use a separate environment with the CUDA build of PyTorch (arm64, CUDA 13 on the GB10):

  ```bash
  uv venv --python python3.12 .venv-train      # or: python3 -m venv .venv-train
  uv pip install --python .venv-train/bin/python torch torchvision --index-url https://download.pytorch.org/whl/cu130
  uv pip install --python .venv-train/bin/python ultralytics onnx onnxslim onnxruntime pydantic-settings pandas
  # the committed models (a minute or two each on the GB10):
  make train-vision DEVICE=0 TASKS=tyre EPOCHS=50 IMGSZ=224 WEIGHTS=yolo11m-cls.pt BATCH=64 WORKERS=6
  make train-vision DEVICE=0 TASKS=damage EPOCHS=60 IMGSZ=320 WEIGHTS=yolo11s-cls.pt BATCH=64 WORKERS=6
  ```

  This writes `app/backend/models/vision/*.onnx` and `vision_metrics.json`. At runtime the classifiers run on onnxruntime (15-25 ms per image on the Grace CPU), so the API does not need PyTorch.

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

Demo control shows this walkthrough as a **guided demo** with live progress, and every page's header links to the next step. The navigation groups the apps by who uses them: *inspection lane* (lane, examiner, reports, AI vision), *fleets and owners* (fleet intelligence, vehicle history, owner app) and *oversight* (HQ, regulator). It becomes an icon rail on small laptops and a menu drawer on phones and tablets.

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

### Models (all run live; metrics are from held-out data)

| Model | What it does | Result |
|---|---|---|
| Tyre classifier | YOLO11m-cls fine-tuned on the curated tyre images on the DGX Spark GPU (224 px), run with ONNX Runtime | 97.8% validation accuracy (YOLO11n on CPU: 93.9%) |
| Body-damage classifier | YOLO11s-cls fine-tuned on the GPU at 320 px, 3 classes (normal / breakage / crushed) | 83.8% validation accuracy (YOLO11n on CPU: 75.4%) |
| Assistant and report summaries | Qwen3-30B-A3B NVFP4 on TensorRT-LLM (GPU), grounded on the retrieved knowledge base; or Ollama; or the template engine | — |
| Photo explanations | Qwen2.5-VL-7B-Instruct on vLLM (GPU): a plain-words second opinion on the same image | — |
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
| `VHI_LLM_URL` / `VHI_LLM_MODEL` | none | OpenAI-compatible LLM server on the GPU (TensorRT-LLM, vLLM, NIM), e.g. `http://127.0.0.1:8355/v1` / `nvidia/Qwen3-30B-A3B-FP4`; takes precedence over Ollama |
| `VHI_OLLAMA_URL` / `VHI_OLLAMA_MODEL` | none / `qwen3:32b` | local LLM for the assistant and report summaries; falls back to the template engine (labelled in the UI) |
| `VHI_VLM_URL` / `VHI_VLM_MODEL` | none | optional vision-language model (OpenAI-compatible) for photo explanations on the AI vision page |
| `VHI_PUBLIC_BASE_URL` | `http://localhost:3000` | base URL for report and check-in links and QR codes when a request does not carry the visitor's address (the web server forwards it) |
| `VHI_DATA_DIR`, `VHI_VAR_DIR` | repo `data/curated`, `app/backend/var` | data and runtime-state locations |
| `VHI_API_INTERNAL` | `http://127.0.0.1:8000` | where the web server forwards `/api` (fixed at `next build` time) |
| `NEXT_PUBLIC_WS_URL` | `ws://<page host>/ws` (proxied to the API by the web server) | override the WebSocket address |

## Tests

```bash
make test                                                          # 31 backend tests (SQLite)
VHI_DATABASE_URL=postgresql+psycopg://... make test                # the same suite on PostgreSQL (add VHI_MQTT_URL=... for MQTT)
make e2e                                                           # 16 Playwright end-to-end tests (needs `make start`;
                                                                   # first time: cd app/web && npx playwright install chromium)
```

The end-to-end tests drive the real UI through all six sessions:
- **S1:** examiner decisions → report → public verification.
- **S2:** flood evidence. **S3:** routing to a senior examiner.
- **S4:** HQ tamper test.
- **S5:** fleet pattern report and booking, FLEET07 risk, the regulator view.
- **S6:** assistant, self-check and paid booking.
- The live vision model, the live WebSocket through the web port, and the photo explanation (when a vision-language model is configured).
- The guided demo's next-step links, and the phone menu drawer (no sideways scrolling at 390 px).

## Troubleshooting

- **"The API is not reachable" on Demo control.** Run `make status`, then `make logs`. The first start seeds the database, which takes 1–2 minutes.
- **Live updates don't arrive.** The browser opens the WebSocket at `/ws` on the web port, and the web server proxies it to the API. A reverse proxy in front must pass WebSocket upgrades; otherwise set `NEXT_PUBLIC_WS_URL` and rebuild the web app.
- **Start over with a clean demo.** Run `make reset`. It clears issued reports, bookings, lane sessions, chats and evidence, keeps the seeded world, and restarts. With Docker, run `docker compose exec api python -m vhi.seed --reset-runtime && docker compose restart api`.
- **Rebuild the whole world.** Run `make seed`, or delete `app/backend/var/vhi.db`. With Docker, use `docker compose down -v`.
- **Fonts look plain offline.** The UI loads Sora and IBM Plex from Google Fonts and falls back to system fonts without internet.

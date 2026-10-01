# VehicleSense AI — Vehicle Health Intelligence demo

A working end-to-end concept demo of an AI-assisted vehicle inspection platform. It runs locally on an NVIDIA DGX Spark or on a laptop. Simulated lane sensors stream into a live pipeline. There, real trained models and rule logic score the vehicle. An examiner decides the ranked alerts and issues a tamper-evident report that a buyer can verify. The demo also includes the fleet, HQ, regulator and owner apps, all built on the same data.

**Independent concept work. It is not an official product of any inspection body.** All vehicles, owners, examiners and fleets are fictional (demo plates use the prefix `DMO`). Every panel in the UI is labelled with how its content is produced: *live model*, *live logic*, *simulated*, *synthetic data*, *real public data*, *sample images* or *mock*.

---

## Quick start (laptop, no Docker)

Requirements: Python 3.11+, Node 20+ (22 recommended) and about 2 GB of disk. If the system Node is older, unpack the nodejs.org tarball into `~/.local/opt/node22` (or set `NODE_HOME`); `scripts/dev.sh` uses it automatically.

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

**Public URL.** Two ways to put the demo on the internet, with the live WebSocket and QR codes working through both:

- **Fixed address: Tailscale Funnel.** `scripts/spark.sh funnel` (or `make spark-funnel`) publishes the apps at `https://<machine>.<tailnet>.ts.net` (the Spark's name on your tailnet). It is free, never changes, and Tailscale keeps it on across reboots. One-time setup: the tailnet admin allows Funnel for the machine (the command prints the link), and `sudo tailscale set --operator=$USER` lets the script manage it. `scripts/spark.sh funnel off` removes it. If another app on the machine already publishes port 443, use `FUNNEL_PORT=8443 scripts/spark.sh funnel` (or 10000) for `https://<machine>.<tailnet>.ts.net:8443`; the script remembers the port and never takes one that another app publishes.
- **Quick tunnel: Cloudflare.** `scripts/spark.sh tunnel` (or `make spark-tunnel`) adds an always-on service that serves the apps at `https://<random-words>.trycloudflare.com`. No account is needed, but the hostname changes whenever the tunnel service restarts, for example after a reboot; restarting the API or web keeps it. `scripts/spark.sh tunnel off` removes it.

`scripts/spark.sh url` prints the addresses and checks them end to end. A fixed hostname on your own domain needs a named Cloudflare tunnel on a domain whose DNS Cloudflare manages.

Every app is behind a login (see *Logins* below), so a public link shows only the login page and the buyer's QR verification page. `scripts/spark.sh reset` clears what visitors did (reports, bookings, lane sessions, evidence) and keeps the seeded world.

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

## The demo: nine end-to-end use cases

Log in as the **Demo presenter** and start from **Demo control** (`/`). It opens with what the product does and one
*Start the recommended demo* button, then lists nine **use cases**. Each card gives the vehicle, the scenario, the
expected outcome, the time it takes and where its data comes from. *Start* opens the first screen of the journey.
From then on the header of every page shows the running use case, its step and a link to the next one. Each
inspection screen shows the **inspection in context**: vehicle, inspection type and ID, hub and lane, examiner, time,
status, outcome, the journey stepper and one primary next action. Progress is read from the live system (the lane
inspection, the examiner's decisions, the report, a booking, an invitation, an HQ action) and from the screens the
presenter has shown (`vhi/services/usecases.py`, `GET /api/usecases`). *Restart* resets only the scenario state the
use case owns: open bookings of its vehicle, its flood invitation and the HQ exception states. It never touches the
seeded data.

| Use case | Journey | Outcome |
|---|---|---|
| **UC-01** Commercial vehicle: emissions and brake failure (DMO 9001, Scania prime mover) | Demo control → lane → examiner → report → fleet record | The examiner confirms the particle-number, hot-hub, fault-code and Tyre AI findings: **FAIL**. |
| **UC-02** EV flood-risk inspection (DMO 9002, BYD Atto 3) | lane → examiner → report → vehicle history | Cabin corrosion, a weak HV isolation reading, battery health and a flood claim: **CONDITIONAL** EV Health Certificate. |
| **UC-03** Odometer rollback and senior review (DMO 9003, Honda Civic) | lane → examiner → referral → senior sign-off → history | Identity checks disagree. The case is referred to the senior examiner, whose sign-off and reasons are in the report. |
| **UC-04** Clean inspection (DMO 9006, Perodua Myvi) | lane → examiner → report → health passport | No anomalies, nothing to decide: **PASS**. |
| **UC-05** Owner self-check, booking and inspection (DMO 9006) | self-check → booking (mock payment) → check-in → lane → report → passport | The booking is checked in by the plate camera, and the certificate appears in the owner's passport. |
| **UC-06** Fleet predictive maintenance (DMO 9001) | attention list → vehicle history (tread wear speeding up) → booking → lane → report → fleet record | The truck is booked before it reaches the limit, and the fleet view shows its new result. |
| **UC-07** HQ exception investigation | exceptions → evidence → recorded action → HQ updated | Examiner integrity, a failing brake tester and a capacity gap: each has a reason, its evidence and actions that are recorded and hash-chained (work orders and rosters are mock). |
| **UC-08** Flood watch to inspection invitation (DMO 9002) | the December 2025 flood view → at-risk EV → invitation (mock) → lane → result in flood watch | The invitation is recorded; the inspection result closes the loop. |
| **UC-09** Used-vehicle buyer trust (DMO 9003) | listings → full record and red flags → latest report → public verification (no login) | *Genuine, unaltered report*. A seeded, clearly labelled synthetic report keeps this runnable on a fresh system. |

The lane replays behind them are scripted inspections at the **Central Inspection Hub** (lanes 3, 2, 1 and 4 for
S1, S2, S3 and S7). Their simulated sensor streams play in real time: play, pause, change speed, jump to a step, change a
value live or **Fast-forward** to the end (Demo control › *Presenter controls*). Everything downstream is computed live
from those streams. S7 (`data/curated/scripts/gen_s7.py`) is the clean replay. When the car has a paid booking, the
lane takes the booked inspection type.

**The presentation rules the apps follow** (`app/web/lib/present.ts`):
- **Provenance.** One label set on every card, chart and result: LIVE FEED, PUBLIC DATA (a stored snapshot of real
  public data), LIVE MODEL, LIVE LOGIC, SIMULATED, SYNTHETIC, SAMPLE, MOCK and FUTURE R&D. The label text says it (not
  only the colour), a tooltip explains it, and *Data labels* in the header opens the legend.
- **Severity.** Normal, Attention and Critical everywhere. A critical finding needs a decision before the report can be
  issued.
- **Model confidence** appears only for a trained model's own output, never for a limit check or a rule.
- **The Vehicle Health / Risk Score** is labelled an application estimate. It shows the status and the main reason,
  the systems that apply to the vehicle (EV battery only for an EV; click one to filter the findings), and model
  factors kept apart from rule deductions.

**The examiner workspace.** A finding queue (critical first) and one finding in focus:
- *Why was this flagged?*, the measured value against its limit and the difference, the evidence source, earlier
  inspections, the health-score deduction and the evidence media.
- *Confirm*, *Dismiss* or *Defer*, with a reason required to dismiss or defer. After a decision the next open finding
  opens.
- Decision progress, and the report blocked until the critical findings are decided. When identity checks disagree,
  a banner says why and the primary action becomes *Refer to the senior examiner*.
- **Ask about this inspection**: a context-aware assistant (`POST /api/inspections/{id}/ask`). It lists the facts it
  retrieved from the record, numbered, apart from the explanation. The local LLM only rephrases them, and without it
  a template does. It says plainly when something is not on record.

**Used-vehicle sales.** The owner app's *Sale* tab and *Oversight › Used-vehicle sales* (`/sales`) list 55 cars and
motorcycles for sale, each with its whole record: every inspection, the odometer readings with rollback detection, OBD
fault codes, insurance claims and policy, photos and the latest verifiable report, summed up for the buyer. The
listings, the 15 motorcycles and their inspections are synthetic (`vhi/seed/sales.py`).

### Logins

One demo account per role. `VHI_DEMO_PASSWORD` opens them all; `VHI_VIEWER_PASSWORD` opens the read-only viewer.

| Account | Sees |
|---|---|
| Demo presenter | every app, including Demo control; starts the use cases |
| Arjun Ismail (Examiner) / Priya Hassan (Senior Examiner) | the lane console, examiner workspace, reports and AI vision of the Central Inspection Hub; decisions and sign-off are recorded as themselves |
| Operations manager | every hub's lanes (read only), HQ with its exceptions, fleets, regulator, used-vehicle sales, flood watch |
| Regulator officer | the regulator view, used-vehicle sales and flood watch |
| Fleet manager | fleet intelligence and vehicle history |
| Nurul Aina (Vehicle Owner, DMO 9006) | the owner app for her own vehicle |
| Guest viewer | every app, read only (may still ask the assistants and try the photo models) |

The API enforces the same rules (`vhi/auth.py`). Open without a login: the buyer's verification page and the lane
check-in scan, both reached through a QR code.

### Neutral branding

The apps carry no client branding. Inspection hubs are fictional: Central, North, East, South and West Inspection Hub
in the Klang Valley, and "<city> Inspection Hub" elsewhere. Inspection types have plain names: Commercial Periodic,
Ownership Transfer, Financing, Voluntary, EV Health Check and Special Inspection (`vhi/terms.py`). Next-day premium
slots are *Express* slots, and the vehicle registry at check-in is a mock registry. An end-to-end test reads every
page and fails on client-specific names or service codes. Genuine public data keeps its source:
- data.gov.my for the national registrations
- JPS Public InfoBanjir for river levels

References that remain but are not shown in the apps:
- The old service codes in the curated synthetic data file (`inspections.parquet`), mapped to the neutral codes when
  the database is seeded (`vhi/terms.py`).
- The internal name `gear` of the Express-slot field and column.
- The stakeholder review document at the repository root.

### Flood watch

**Flood watch** (`/flood`, under *oversight*) sets river levels (JPS Public InfoBanjir) against the registered vehicles. It shows which vehicles need a flood-damage inspection or an underbody corrosion check, and why.

- **River levels and rainfall (real).** Every state's water-level and rainfall tables come from [JPS Public InfoBanjir](https://publicinfobanjir.water.gov.my/). They are fetched in parallel (about 8 s) and kept for 15 minutes. Opening the page starts a new fetch in the background once the data is older than that; *Refresh river levels* fetches at most every two minutes. The page says when the data was last updated, and says so plainly when the live feed is unavailable and it shows the stored snapshot.
- **Station status.** Each station is read against its own JPS thresholds (normal, alert, warning, danger). A 0.00 m level under a positive normal level, or a reading more than a day old, counts as *no reading*.
- **History.** Every fetch is recorded, so the page shows how the levels moved. A station's own 7-day series also comes from JPS when the site answers.
- **Offline.** Without the site, the page uses the last stored fetch, or else the committed snapshot `app/backend/assets/web_snapshots/jps_water_levels.json`. The UI labels this "PUBLIC DATA · Stored JPS snapshot, fetched …" (a live fetch is "LIVE FEED"). Station positions come from the JPS station list on data.gov.my (`jps_stations.json`); stations without one are drawn near their district's main town. `python -m vhi.services.jps` (in `app/backend`) refreshes both files.
- **Vehicles (synthetic).** Each vehicle gets a synthetic district of its state (`vehicle_locations`, seeded by `vhi.seed.floodwatch`).
- **Past floods.** These are the flood dates in the synthetic insurance claims. Dec 2021 and Nov 2024 match real floods, which are labelled as public record.
- **Risk.** Transparent scoring logic, with every factor given as a reason in plain words:
  - exposure of the district (a station at alert, warning or danger, very heavy rain, or a past flood)
  - raised or lowered by the vehicle (age, ground clearance, EV or hybrid battery, corrosion found before, earlier flood claims)
  - combined with the LightGBM flood model for vehicles with an inspection history
- **Invitation (mock).** *Invite the owner for a flood inspection* only records the invitation; no message is sent. The vehicle's detail then shows the result of the inspection that follows. The address holds the view and the vehicle (`/flood?scope=event:2025-12-10&vehicle=DMO 9002`).
- **API.** `/api/floodwatch` (`/stations`, `/areas`, `/vehicles`, `/vehicles/{plate}`, `/refresh`, `/invitations`); see `/docs`.

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
- **Demo images** `data/curated/images/vehiclesense_demo`: the 26 source inspection images (full-resolution PNG + web JPG + the crops the app shows), de-duplicated. `manifest.json` / `README.md` there map each image to its original file name(s), the app capture, the fleet vehicles that use it, and its findings. They appear in the AI vision *Image library* tab, on each fleet vehicle's history (*Inspection images*), in the fleet table's evidence column and on Demo control, and open in a full-screen viewer with their findings (arrow keys to step through, `?img=i7` to link one). The API serves them at `GET /api/vision/library`, and fleet vehicles carry theirs in `images`. To add more: `python scripts/import_sam_img.py /path/to/sam_img`.

### Models (all run live; metrics are from held-out data)

| Model | What it does | Result |
|---|---|---|
| Tyre AI | YOLO11m-cls fine-tuned on the curated tyre images on the DGX Spark GPU (224 px), run with ONNX Runtime | 97.8% validation accuracy (YOLO11n on CPU: 93.9%) |
| Above-carriage AI (body damage) | YOLO11s-cls fine-tuned on the GPU at 320 px, 3 classes (normal / breakage / crushed) | 83.8% validation accuracy (YOLO11n on CPU: 75.4%) |
| Assistant and report summaries | Qwen3-30B-A3B NVFP4 on TensorRT-LLM (GPU), grounded on the retrieved knowledge base; or Ollama; or the template engine | — |
| Photo explanations | Qwen2.5-VL-7B-Instruct on vLLM (GPU): a plain-words second opinion on the same image | — |
| Undercarriage AI / cabin corrosion | HSV rust segmentation, calibrated on rust vs clean photos | 89% balanced accuracy |
| Plate / chassis OCR | RapidOCR (PaddleOCR via ONNX) with Malaysian plate grammar | — |
| E-nose (future R&D preview, not in the result) | XGBoost on the UCI gas-sensor array, plus a Bayesian context prior | 99.4% random split; 72.3% on later batches (sensor drift) |
| Engine / fault sound | Log-mel features → logistic regression (9 classes); PCA fingerprint | CV accuracy 76.5%; fingerprint EER 13% |
| EV battery SOH | BMS modules plus a NASA capacity-fade model | MAE 1.0 SOH points |
| Health score | LightGBM with SHAP factors, plus a transparent rule layer | AUC 0.989 (time split) |
| Next-fail / survival | Regularised LightGBM, read against vehicles of the same age and class that pass today; Weibull AFT (lifelines) | AUC 0.698, Brier 0.173; concordance 0.70 |
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
| `VHI_OLLAMA_URL` / `VHI_OLLAMA_MODEL` | none / `qwen3:32b` | local LLM for the assistant and report summaries; falls back to the template engine (labelled in the UI). Use a model that can answer without a reasoning pass: `qwen3:32b` or `qwen3:30b-a3b-instruct-2507-q4_K_M` (fast MoE). The tag `qwen3:30b-a3b` now resolves to the Thinking-2507 model, which always reasons first. For photo explanations through Ollama, set `VHI_VLM_URL=http://127.0.0.1:11434/v1` and `VHI_VLM_MODEL=qwen2.5vl:7b` |
| `VHI_VLM_URL` / `VHI_VLM_MODEL` | none | optional vision-language model (OpenAI-compatible) for photo explanations on the AI vision page |
| `VHI_LLM_KEEP_ALIVE` | none | keep the Ollama models loaded, e.g. `30m`: sent with every call and renewed every 4 minutes while the API runs, so the first answer after a quiet spell does not wait ~10 s for the model to load (TensorRT-LLM and vLLM keep theirs loaded anyway) |
| `VHI_DEMO_PASSWORD` / `VHI_VIEWER_PASSWORD` | none | the login passwords: every role account / the read-only viewer (defaults to the demo password). `make e2e` reads them from `app/backend/.env` |
| `VHI_ENOSE_IN_RESULTS` | `false` | use the e-nose as a live lane sensor (alerts, health points, flood evidence) instead of a research preview |
| `VHI_PUBLIC_BASE_URL` | `http://localhost:3000` | base URL for report and check-in links and QR codes when a request does not carry the visitor's address (the web server forwards it) |
| `VHI_DATA_DIR`, `VHI_VAR_DIR` | repo `data/curated`, `app/backend/var` | data and runtime-state locations |
| `VHI_API_INTERNAL` | `http://127.0.0.1:8000` | where the web server forwards `/api` (fixed at `next build` time) |
| `NEXT_PUBLIC_WS_URL` | `ws://<page host>/ws` (proxied to the API by the web server) | override the WebSocket address |

## Tests

```bash
make test                                                          # 70 backend tests (SQLite)
VHI_DATABASE_URL=postgresql+psycopg://... make test                # the same suite on PostgreSQL (add VHI_MQTT_URL=... for MQTT)
make e2e                                                           # 38 Playwright end-to-end tests (needs `make start`;
                                                                   # first time: cd app/web && npx playwright install chromium)
```

The backend tests cover the use-case engine: every journey's progress read from the live system, the restarts, the
HQ exceptions with hash-chained actions, the inspection assistant, the synthetic report and the clean S7 replay. The
end-to-end tests drive the real UI:
- **Demo control:** the nine use-case cards, starting one with the keyboard, and the data-label legend.
- **UC-01:**
  - critical findings first, and a reason required to dismiss
  - the arrow keys in the finding queue, and the report blocked until the critical findings are decided
  - the FAIL report, the fleet record and public verification
- **UC-02 to UC-09** each reach their outcome: the CONDITIONAL certificate, the senior sign-off, the clean PASS, the owner journey from self-check to passport, the fleet booking, the HQ action, the flood invitation and its result, and the buyer's verification without a login.
- **Across the apps:**
  - the inspection context on every inspection screen
  - a branding audit that reads every page
  - loading states and a zero-result filter
  - no sideways scrolling at 390 and 360 px
  - the logins and roles
  - the live vision model and the WebSocket

## Troubleshooting

- **"The API is not reachable" on Demo control.** Run `make status`, then `make logs`. The first start seeds the database, which takes 1–2 minutes.
- **Live updates don't arrive.** The browser opens the WebSocket at `/ws` on the web port, and the web server proxies it to the API. A reverse proxy in front must pass WebSocket upgrades; otherwise set `NEXT_PUBLIC_WS_URL` and rebuild the web app.
- **Start over with a clean demo.** Run `make reset`. It clears issued reports, bookings, lane sessions, chats and evidence, keeps the seeded world, and restarts. With Docker, run `docker compose exec api python -m vhi.seed --reset-runtime && docker compose restart api`.
- **Rebuild the whole world.** Run `make seed`, or delete `app/backend/var/vhi.db`. With Docker, use `docker compose down -v`.
- **Fonts look plain offline.** The UI loads Sora and IBM Plex from Google Fonts and falls back to system fonts without internet.

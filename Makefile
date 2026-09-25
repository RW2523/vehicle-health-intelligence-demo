# VehicleSense AI demo - common tasks. `make` or `make help` lists them.
.PHONY: help setup start stop restart status seed reset train train-vision test test-pg e2e logs up up-llm down docker-logs

help:
	@echo "Local (no Docker):"
	@echo "  make setup         create .venv and install Python + Node dependencies"
	@echo "  make start         seed, train missing models, build and start API :8000 + web :3000"
	@echo "  make stop | restart | status | logs"
	@echo "  make seed          re-seed vehicles, history and fleets from data/curated"
	@echo "  make reset         clear reports, bookings, lane sessions and evidence, then start fresh"
	@echo "  make train         retrain tabular/audio models (e-nose, acoustic, SOH, fusion, demand, corrosion)"
	@echo "  make train-vision  fine-tune the YOLO11 tyre/damage classifiers and export ONNX (GPU: DEVICE=0)"
	@echo "  make test          backend tests (SQLite)      make e2e   Playwright tests against the running app"
	@echo "Docker (DGX Spark):"
	@echo "  make up            TimescaleDB + Mosquitto + API + web      make up-llm   ... plus Ollama on the GPU"
	@echo "  make down | docker-logs"

setup:   ; scripts/dev.sh setup
start:   ; scripts/dev.sh start
stop:    ; scripts/dev.sh stop
restart: ; scripts/dev.sh restart
status:  ; scripts/dev.sh status
logs:    ; scripts/dev.sh logs
seed:    ; scripts/dev.sh seed
reset:   ; scripts/dev.sh reset
train:   ; scripts/dev.sh train
test:    ; scripts/dev.sh test
e2e:     ; scripts/dev.sh e2e

# Training extras are not needed at runtime: pip install ultralytics onnx onnxslim
DEVICE ?= cpu
EPOCHS ?= $(if $(filter cpu,$(DEVICE)),12,30)
IMGSZ ?= $(if $(filter cpu,$(DEVICE)),160,224)
train-vision:
	cd app/backend && ../../.venv/bin/python -m vhi.ml.train_vision --device $(DEVICE) --epochs $(EPOCHS) --imgsz $(IMGSZ)

up:          ; docker compose up -d --build
up-llm:      ; docker compose --profile llm up -d --build && docker compose exec ollama ollama pull $${VHI_OLLAMA_MODEL:-qwen3:32b}
down:        ; docker compose --profile llm down
docker-logs: ; docker compose logs -f --tail 100 api web

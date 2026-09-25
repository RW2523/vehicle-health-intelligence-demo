# VehicleSense AI - API (FastAPI + models). Multi-arch: builds on the DGX Spark (linux/arm64) and on x86-64.
# Build context is the repository root:  docker build -f app/backend/Dockerfile -t vhi-api .
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    VHI_DATA_DIR=/data VHI_VAR_DIR=/var/lib/vhi
# libgomp: LightGBM/XGBoost; libgl + libglib: OpenCV used by RapidOCR; curl: health check
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY app/backend/requirements.txt .
RUN pip install -r requirements.txt
COPY app/backend/vhi ./vhi
COPY app/backend/models ./models
COPY app/backend/assets ./assets
COPY app/backend/tests ./tests
COPY app/backend/pytest.ini .

# data/curated is mounted read-only at /data (see docker-compose.yml); database/evidence live in /var/lib/vhi
VOLUME ["/var/lib/vhi"]
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=10 CMD curl -fs http://127.0.0.1:8000/api/health || exit 1
# Train only models whose files are missing (all are committed, so normally a no-op), then serve.
CMD ["sh", "-c", "python -m vhi.ml.train --missing >/dev/null && exec uvicorn vhi.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]

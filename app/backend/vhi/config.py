"""Runtime configuration. Every value can be overridden with an environment variable (prefix VHI_)."""
from __future__ import annotations

import re
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VHI_", env_file=".env", extra="ignore")

    # Where the curated demo data lives (the repo's data/curated folder).
    data_dir: Path = REPO_DIR / "data" / "curated"
    # Runtime state: trained models, evidence files, the SQLite database for local runs.
    var_dir: Path = BACKEND_DIR / "var"
    assets_dir: Path = BACKEND_DIR / "assets"

    # postgresql+psycopg://vhi:vhi@db:5432/vhi on the DGX Spark; SQLite for a laptop run.
    database_url: str = ""

    # mqtt://mosquitto:1883 on the DGX Spark. Empty = in-process message bus.
    mqtt_url: str = ""

    # Local LLM (Ollama). Empty or unreachable = built-in template engine (labelled as such in the UI).
    ollama_url: str = ""
    ollama_model: str = "qwen3:32b"
    # Or an OpenAI-compatible server on the GPU - TensorRT-LLM (trtllm-serve), vLLM or NVIDIA NIM - which takes
    # precedence over Ollama, e.g. http://127.0.0.1:8355/v1 serving nvidia/Qwen3-30B-A3B-FP4 on the DGX Spark.
    llm_url: str = ""
    llm_model: str = ""
    llm_timeout_s: float = 60.0
    # Optional vision-language model on an OpenAI-compatible server (e.g. Qwen2.5-VL-7B on vLLM): plain-words
    # descriptions of inspection photos on the AI vision page. Empty = not offered.
    vlm_url: str = ""
    vlm_model: str = ""

    # Session player defaults
    player_speed: float = 1.0
    player_tick_s: float = 0.25

    # Public base URL used inside QR codes (the verify page) when a request does not say which address the visitor used.
    public_base_url: str = "http://localhost:3000"
    cors_origins: str = "*"

    timezone: str = "Asia/Kuala_Lumpur"
    # "Today" for the synthetic world. The curated data was generated on 24 Sep 2026.
    demo_today: str = "2026-09-25"

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.var_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.var_dir / 'vhi.db'}"

    # Trained model artifacts (small; committed so the demo runs out of the box, retrain with `make train`).
    models_path: Path = BACKEND_DIR / "models"

    @property
    def models_dir(self) -> Path:
        self.models_path.mkdir(parents=True, exist_ok=True)
        return self.models_path

    @property
    def evidence_dir(self) -> Path:
        p = self.var_dir / "evidence"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"


@lru_cache
def get_settings() -> Settings:
    return Settings()


# The address the current request came in on, set by vhi.main.RequestBaseURL.
request_base_url: ContextVar[str | None] = ContextVar("request_base_url", default=None)
HOST_RE = re.compile(r"[A-Za-z0-9.-]+(:\d{1,5})?")


def base_url_from(host: str | None, proto: str | None) -> str | None:
    """"https://abc.trycloudflare.com" from forwarded host/proto headers; None when they are missing or malformed."""
    proto = (proto or "http").split(",")[0].strip().lower()
    if not host or not HOST_RE.fullmatch(host) or proto not in ("http", "https"):
        return None
    return f"{proto}://{host}"


def public_base_url() -> str:
    """Base URL for links and QR codes: the address the visitor used (LAN, Tailscale or a public tunnel), else
    VHI_PUBLIC_BASE_URL."""
    return request_base_url.get() or get_settings().public_base_url

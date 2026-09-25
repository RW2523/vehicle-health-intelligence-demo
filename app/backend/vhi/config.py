"""Runtime configuration. Every value can be overridden with an environment variable (prefix VHI_)."""
from __future__ import annotations

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
    llm_timeout_s: float = 60.0

    # Session player defaults
    player_speed: float = 1.0
    player_tick_s: float = 0.25

    # Public base URL used inside QR codes (the verify page).
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

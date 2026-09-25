"""FastAPI application: REST + WebSocket for all apps. Run with ``uvicorn vhi.main:app``."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .runtime import build_runtime

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("vhi")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from . import seed
    from .ml.registry import ModelRegistry
    from .pipeline.processor import StreamProcessor
    from .services.llm import LLM, VLM
    from .sim.player import SessionManager

    r = build_runtime()
    await asyncio.to_thread(seed.run)
    r.models = ModelRegistry(r.settings)
    await asyncio.to_thread(r.models.ensure_trained)
    r.llm = LLM(r.settings)
    r.vlm = VLM(r.settings)
    await r.bus.start()
    r.processor = StreamProcessor(r)
    r.player = SessionManager(r)
    await r.processor.start()
    from .services import fleet as fleet_svc
    warm = asyncio.create_task(asyncio.to_thread(fleet_svc.warm))  # pre-compute fleet analyses in the background
    log.info("VHI API ready (db=%s, bus=%s, llm=%s, vlm=%s)", r.settings.db_url.split(":")[0], r.bus.kind,
             r.llm.status()["backend"], r.vlm.status()["backend"])
    try:
        yield
    finally:
        warm.cancel()
        await r.player.stop_all()
        await r.processor.stop()
        await r.bus.stop()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Vehicle Health Intelligence API", version="1.0.0", lifespan=lifespan,
                  description="Concept demo. Fictional vehicles; every output is labelled live model, "
                              "live logic, real public data or simulated.")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in s.cors_origins.split(",")],
                       allow_methods=["*"], allow_headers=["*"])
    from .api import (evidence, fleet, hq, inspections, owner, reference, regulator, reports, sessions, system,
                      vision)
    for m in (system, reference, sessions, inspections, reports, evidence, vision, owner, fleet, hq, regulator):
        app.include_router(m.router)
    app.mount("/media/data", StaticFiles(directory=str(s.data_dir)), name="data")
    app.mount("/media/assets", StaticFiles(directory=str(s.assets_dir)), name="assets")
    app.mount("/media/evidence", StaticFiles(directory=str(s.evidence_dir)), name="evidence")
    return app


app = create_app()

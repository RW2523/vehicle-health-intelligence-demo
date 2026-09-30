"""FastAPI application: REST + WebSocket for all apps. Run with ``uvicorn vhi.main:app``."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import presenter
from .config import base_url_from, get_settings, request_base_url
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

    async def keep_models_loaded() -> None:  # VHI_LLM_KEEP_ALIVE: load the Ollama models now, renew every 4 minutes
        while True:
            for m in (r.llm, r.vlm):
                await asyncio.to_thread(m.keep_loaded)
            await asyncio.sleep(240)

    loaded = asyncio.create_task(keep_models_loaded()) if r.settings.llm_keep_alive else None
    log.info("VHI API ready (db=%s, bus=%s, llm=%s, vlm=%s)", r.settings.db_url.split(":")[0], r.bus.kind,
             r.llm.status()["backend"], r.vlm.status()["backend"])
    try:
        yield
    finally:
        warm.cancel()
        if loaded:
            loaded.cancel()
        await r.player.stop_all()
        await r.processor.stop()
        await r.bus.stop()


class RequestBaseURL:
    """Links and QR codes point to the address the visitor used: the web server forwards it as X-Forwarded-Host (and a
    Cloudflare tunnel adds X-Forwarded-Proto: https). Direct API calls fall back to VHI_PUBLIC_BASE_URL."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        h = {k.lower(): v.decode("latin-1") for k, v in scope["headers"]}
        token = request_base_url.set(base_url_from(h.get(b"x-forwarded-host"), h.get(b"x-forwarded-proto")))
        try:
            await self.app(scope, receive, send)
        finally:
            request_base_url.reset(token)


class PresenterOnly:
    """VHI_PRESENTER_PIN: changes to the demo need the presenter PIN (vhi.presenter); reading stays open."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not presenter.guards(scope["method"], scope["path"]):
            return await self.app(scope, receive, send)
        pin = next((v.decode("latin-1") for k, v in scope["headers"] if k.lower() == presenter.HEADER.encode()), None)
        result = presenter.gate.check(pin)
        if result == "ok":
            return await self.app(scope, receive, send)
        code, detail = presenter.MESSAGES[result]
        await JSONResponse({"detail": detail, "code": "presenter_pin"}, status_code=code)(scope, receive, send)


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Vehicle Health Intelligence API", version="1.0.0", lifespan=lifespan,
                  description="Concept demo. Fictional vehicles; every output is labelled live model, "
                              "live logic, real public data or simulated.")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in s.cors_origins.split(",")],
                       allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(RequestBaseURL)
    app.add_middleware(PresenterOnly)
    from .api import (evidence, fleet, floodwatch, hq, inspections, owner, reference, regulator, reports, sessions,
                      system, vision)
    for m in (system, reference, sessions, inspections, reports, evidence, vision, owner, fleet, hq, regulator,
              floodwatch):
        app.include_router(m.router)
    app.mount("/media/data", StaticFiles(directory=str(s.data_dir)), name="data")
    app.mount("/media/assets", StaticFiles(directory=str(s.assets_dir)), name="assets")
    app.mount("/media/evidence", StaticFiles(directory=str(s.evidence_dir)), name="evidence")
    return app


app = create_app()

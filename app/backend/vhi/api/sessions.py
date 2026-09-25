"""Demo control: start / pause / seek / speed / override the scripted sessions."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..runtime import rt
from ..sim.player import LANE_SESSIONS, session_catalogue

router = APIRouter(prefix="/api/sessions", tags=["demo control"])


class StartReq(BaseModel):
    speed: float | None = None
    overrides: dict = {}
    fast: bool = False  # play the whole session instantly


class SeekReq(BaseModel):
    t: float | None = None
    step: str | None = None


class SpeedReq(BaseModel):
    speed: float


class OverrideReq(BaseModel):
    overrides: dict
    replace: bool = False


def _player(sid: str):
    try:
        return rt().player.get(sid)
    except KeyError as e:
        raise HTTPException(404, f"{sid} is not a lane session (lane sessions: {', '.join(LANE_SESSIONS)})") from e


@router.get("")
def catalogue():
    players = {p["session_id"]: p for p in rt().player.state_all()}
    return [{**s, "player": players.get(s["session_id"])} for s in session_catalogue()]


@router.get("/{sid}")
def get_session(sid: str):
    sid = sid.upper()
    meta = json.loads((rt().settings.sessions_dir / f"{sid}.json").read_text())
    out = {"session_id": sid, "meta": meta}
    if sid in LANE_SESSIONS:
        out["player"] = _player(sid).snapshot()
    return out


@router.post("/{sid}/start")
async def start(sid: str, req: StartReq):
    p = _player(sid)
    if req.fast:
        iid = await rt().player.run_to_end(sid.upper(), req.overrides)
        await rt().processor.idle(iid)
        return p.snapshot()
    await p.start(req.speed, req.overrides)
    return p.snapshot()


@router.post("/{sid}/pause")
async def pause(sid: str):
    p = _player(sid)
    await p.pause()
    return p.snapshot()


@router.post("/{sid}/resume")
async def resume(sid: str):
    p = _player(sid)
    await p.resume()
    return p.snapshot()


@router.post("/{sid}/speed")
async def speed(sid: str, req: SpeedReq):
    p = _player(sid)
    await p.set_speed(req.speed)
    return p.snapshot()


@router.post("/{sid}/seek")
async def seek(sid: str, req: SeekReq):
    p = _player(sid)
    if req.step:
        try:
            await p.seek_step(req.step)
        except KeyError as e:
            raise HTTPException(400, f"unknown step {req.step}") from e
    elif req.t is not None:
        await p.seek(req.t)
    return p.snapshot()


@router.post("/{sid}/overrides")
async def overrides(sid: str, req: OverrideReq):
    p = _player(sid)
    await p.set_overrides(req.overrides, req.replace)
    return p.snapshot()


@router.post("/{sid}/stop")
async def stop(sid: str):
    p = _player(sid)
    await p.stop()
    p.state.status = "idle"
    return p.snapshot()

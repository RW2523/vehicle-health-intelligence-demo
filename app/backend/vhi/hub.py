"""WebSocket fan-out to the web apps.

Clients connect to ``/ws?channels=lane:BR00-L3,inspection:LI123,fleet`` (or send ``{"subscribe": [...]}``)
and receive ``{"channel": ..., "type": ..., "data": ...}`` messages. The channel ``*`` receives everything.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("vhi.hub")


@dataclass(eq=False)
class Client:
    ws: WebSocket
    channels: set[str] = field(default_factory=set)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=2000))


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()
        self.sent = 0
        # Last message per (channel, type) so a console that opens mid-session catches up at once.
        self._last: dict[tuple[str, str], dict[str, Any]] = {}

    def wants(self, c: Client, channel: str) -> bool:
        if "*" in c.channels or channel in c.channels:
            return True
        prefix = channel.split(":", 1)[0]
        return f"{prefix}:*" in c.channels

    async def broadcast(self, channel: str, type_: str, data: Any, *, remember: bool = True) -> None:
        msg = {"channel": channel, "type": type_, "data": data}
        if remember:
            self._last[(channel, type_)] = msg
        for c in list(self.clients):
            if self.wants(c, channel):
                if c.queue.full():
                    with contextlib.suppress(asyncio.QueueEmpty):
                        c.queue.get_nowait()
                c.queue.put_nowait(msg)

    def snapshot(self, channels: set[str]) -> list[dict[str, Any]]:
        probe = Client(ws=None, channels=channels)  # type: ignore[arg-type]
        return [m for (ch, _), m in self._last.items() if self.wants(probe, ch)]

    def patch_remembered(self, type_: str, key: str, data: dict[str, Any]) -> None:
        """Update cached messages of ``type_`` that describe the same object (e.g. an alert that was just decided)."""
        for (ch, t), m in self._last.items():
            if t == type_ and isinstance(m.get("data"), dict) and m["data"].get(key) == data.get(key):
                m["data"] = {**m["data"], **data}

    def forget(self, channel: str) -> None:
        for key in [k for k in self._last if k[0] == channel]:
            self._last.pop(key, None)

    async def serve(self, ws: WebSocket, channels: set[str]) -> None:
        await ws.accept()
        client = Client(ws=ws, channels=channels or {"*"})
        self.clients.add(client)
        for m in self.snapshot(client.channels):
            client.queue.put_nowait(m)

        async def sender() -> None:
            while True:
                msg = await client.queue.get()
                await ws.send_text(json.dumps(msg, default=str))
                self.sent += 1

        async def receiver() -> None:
            while True:
                raw = await ws.receive_text()
                with contextlib.suppress(ValueError, TypeError, AttributeError):
                    req = json.loads(raw)
                    if "subscribe" in req:
                        new = set(req["subscribe"])
                        client.channels |= new
                        for m in self.snapshot(new):
                            client.queue.put_nowait(m)
                    if "unsubscribe" in req:
                        client.channels -= set(req["unsubscribe"])
                    if req.get("ping"):
                        client.queue.put_nowait({"channel": "system", "type": "pong", "data": req["ping"]})

        tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
            self.clients.discard(client)

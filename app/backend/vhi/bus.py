"""Message bus used between the session player (sensor simulators) and the stream processor.

Topics follow the MQTT layout from the build plan, e.g. ``lane/AM-03/enose``. Two implementations:

* :class:`InMemoryBus` - asyncio fan-out in one process (default, laptop/tests).
* :class:`MqttBus` - Eclipse Mosquitto via aiomqtt (DGX Spark, ``VHI_MQTT_URL=mqtt://mosquitto:1883``).

Both expose the same ``publish`` / ``subscribe`` API so nothing else changes.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any, AsyncIterator
from urllib.parse import urlparse

log = logging.getLogger("vhi.bus")


def topic_matches(pattern: str, topic: str) -> bool:
    """MQTT wildcard matching: ``+`` = one level, ``#`` = the rest."""
    p, t = pattern.split("/"), topic.split("/")
    for i, part in enumerate(p):
        if part == "#":
            return True
        if i >= len(t):
            return False
        if part not in ("+", t[i]):
            return False
    return len(p) == len(t)


class InMemoryBus:
    kind = "in-process"

    def __init__(self) -> None:
        self._subs: list[tuple[str, asyncio.Queue]] = []
        self.published = 0

    async def start(self) -> None:  # parity with MqttBus
        return None

    def backlog(self) -> int:
        return sum(q.qsize() for _, q in self._subs)

    async def stop(self) -> None:
        return None

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        self.published += 1
        for pattern, q in list(self._subs):
            if topic_matches(pattern, topic):
                if q.qsize() > 5000:  # a stalled consumer must not grow memory without bound
                    with contextlib.suppress(asyncio.QueueEmpty):
                        q.get_nowait()
                q.put_nowait((topic, payload))

    async def subscribe(self, pattern: str) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        q: asyncio.Queue = asyncio.Queue()
        entry = (pattern, q)
        self._subs.append(entry)
        try:
            while True:
                yield await q.get()
        finally:
            with contextlib.suppress(ValueError):
                self._subs.remove(entry)


class MqttBus:
    kind = "mqtt"

    def __init__(self, url: str) -> None:
        u = urlparse(url)
        self.host, self.port = u.hostname or "localhost", u.port or 1883
        self.published = 0
        self._client = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        import aiomqtt

        self._client = aiomqtt.Client(self.host, self.port, identifier="vhi-api-pub")
        await self._client.__aenter__()
        log.info("MQTT connected to %s:%s", self.host, self.port)

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.__aexit__(None, None, None)

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        assert self._client is not None, "MqttBus.start() not called"
        self.published += 1
        await self._client.publish(topic, json.dumps(payload, default=str), qos=0)

    async def subscribe(self, pattern: str) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        import aiomqtt

        async with aiomqtt.Client(self.host, self.port) as client:
            await client.subscribe(pattern)
            async for msg in client.messages:
                try:
                    yield str(msg.topic), json.loads(msg.payload)
                except (ValueError, TypeError):
                    log.warning("bad payload on %s", msg.topic)


def make_bus(mqtt_url: str):
    if mqtt_url:
        return MqttBus(mqtt_url)
    return InMemoryBus()

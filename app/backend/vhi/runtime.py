"""Process-wide singletons wired together at start-up (see ``vhi.main.lifespan``)."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .bus import InMemoryBus, MqttBus, make_bus
from .config import Settings, get_settings
from .hub import Hub


@dataclass
class Runtime:
    settings: Settings
    bus: InMemoryBus | MqttBus
    hub: Hub
    started_at: float = field(default_factory=time.time)
    player: Any = None      # vhi.sim.player.SessionManager
    processor: Any = None   # vhi.pipeline.processor.StreamProcessor
    models: Any = None      # vhi.ml.registry.ModelRegistry
    llm: Any = None         # vhi.services.llm.LLM
    stats: dict[str, Any] = field(default_factory=dict)


_rt: Runtime | None = None


def build_runtime() -> Runtime:
    global _rt
    s = get_settings()
    _rt = Runtime(settings=s, bus=make_bus(s.mqtt_url), hub=Hub())
    return _rt


def rt() -> Runtime:
    if _rt is None:
        return build_runtime()
    return _rt

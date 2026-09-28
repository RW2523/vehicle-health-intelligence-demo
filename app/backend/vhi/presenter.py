"""View-only mode for a public link (``VHI_PRESENTER_PIN``).

With a PIN set, requests that change the demo must carry it in the ``X-Presenter-Pin`` header (the web apps ask for
it once per browser). Reading stays open, and so do questions to the models that change nothing other visitors see.
Wrong PINs are rate-limited for everyone, so a PIN of 8 digits cannot be guessed over the internet.
"""
from __future__ import annotations

import hmac
import time
from collections import deque

from .config import get_settings

HEADER = "x-presenter-pin"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Asking the assistant and running the photo models on the curated images: open in view-only mode.
OPEN_PATHS = {"/api/owner/assistant", "/api/vision/analyse", "/api/vision/explain", "/api/system/presenter"}
MAX_FAILS, WINDOW_S = 10, 60.0


def required() -> bool:
    return bool(get_settings().presenter_pin)


def guards(method: str, path: str) -> bool:
    """Whether this request needs the presenter PIN."""
    return required() and method not in SAFE_METHODS and path.startswith("/api/") and path not in OPEN_PATHS


class Gate:
    def __init__(self) -> None:
        self._fails: deque[float] = deque()

    def check(self, pin: str | None) -> str:
        """"ok", "denied", or "locked" after too many wrong PINs in the last minute (then no PIN is even compared)."""
        want = get_settings().presenter_pin
        if not want:
            return "ok"
        now = time.monotonic()
        while self._fails and now - self._fails[0] > WINDOW_S:
            self._fails.popleft()
        if len(self._fails) >= MAX_FAILS:
            return "locked"
        if pin is None:
            return "denied"
        if hmac.compare_digest(pin.encode(), want.encode()):
            return "ok"
        self._fails.append(now)
        return "denied"


gate = Gate()

MESSAGES = {"denied": (403, "View-only link: enter the presenter PIN to change the demo."),
            "locked": (429, "Too many wrong PINs - wait a minute and try again.")}

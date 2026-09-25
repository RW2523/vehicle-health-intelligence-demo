"""Local LLM access (feature 4 assistant, feature 24 report narrative).

Uses Ollama when ``VHI_OLLAMA_URL`` is set and reachable (on the DGX Spark: a Malay-capable model such as
SEA-LION or Qwen3). Otherwise a deterministic template engine answers from the retrieved knowledge base - the
apps show which one answered, so nothing is presented as an LLM when it is not.
"""
from __future__ import annotations

import json
import logging
import re
import time
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from ..config import Settings

log = logging.getLogger("vhi.llm")
KB_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "kb.json"
MS_WORDS = {"saya", "nak", "kereta", "apa", "boleh", "esok", "pemeriksaan", "bila", "berapa", "ada", "tak", "untuk",
            "macam", "mana", "perlu", "jual", "hari", "bayaran", "cawangan", "lulus", "gagal", "kenderaan", "tolong",
            "terima", "kasih", "sila", "bawa"}


def detect_lang(text: str) -> str:
    if re.search(r"[一-鿿]", text):
        return "zh"
    words = set(re.findall(r"[a-z]+", text.lower()))
    return "ms" if len(words & MS_WORDS) >= 1 else "en"


@lru_cache(maxsize=1)
def kb() -> dict:
    return json.loads(KB_PATH.read_text(encoding="utf-8"))


class Retriever:
    def __init__(self):
        items = kb()["items"]
        self.items = items
        docs = [" ".join([*it["keywords"], *it["q"].values(), *it["a"].values()]) for it in items]
        self.vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True).fit(docs)
        self.mat = self.vec.transform(docs)

    def search(self, text: str, k: int = 2) -> list[tuple[dict, float]]:
        q = self.vec.transform([text])
        sims = (self.mat @ q.T).toarray().ravel()
        low = text.lower()
        for i, it in enumerate(self.items):  # keyword boost keeps short BM questions on target
            if any(kw in low for kw in it["keywords"]):
                sims[i] += 0.35
        order = np.argsort(sims)[::-1][:k]
        return [(self.items[i], float(sims[i])) for i in order]


class LLM:
    def __init__(self, settings: Settings):
        self.s = settings
        self._ok: bool | None = None
        self._checked = 0.0
        self.retriever = Retriever()

    def available(self) -> bool:
        if not self.s.ollama_url:
            return False
        if self._ok is None or time.time() - self._checked > 60:
            try:
                r = httpx.get(f"{self.s.ollama_url}/api/tags", timeout=2.0)
                names = [m.get("name") for m in r.json().get("models", [])]
                self._ok = r.status_code == 200 and any(self.s.ollama_model.split(":")[0] in (n or "") for n in names)
            except (httpx.HTTPError, ValueError):
                self._ok = False
            self._checked = time.time()
        return bool(self._ok)

    def status(self) -> dict:
        ok = self.available()
        return {"backend": f"ollama:{self.s.ollama_model}" if ok else "template",
                "ollama_url": self.s.ollama_url or None, "reachable": ok,
                "note": None if ok else "No local LLM reachable - answers come from the built-in template engine."}

    def chat(self, system: str, messages: list[dict], max_tokens: int = 400) -> str | None:
        if not self.available():
            return None
        try:
            r = httpx.post(f"{self.s.ollama_url}/api/chat", timeout=self.s.llm_timeout_s, json={
                "model": self.s.ollama_model, "stream": False, "think": False,
                "options": {"temperature": 0.3, "num_predict": max_tokens},
                "messages": [{"role": "system", "content": system}, *messages]})
            r.raise_for_status()
            text = r.json().get("message", {}).get("content", "").strip()
            return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip() or None
        except (httpx.HTTPError, ValueError) as e:
            log.warning("ollama call failed: %s", e)
            self._ok = False
            return None

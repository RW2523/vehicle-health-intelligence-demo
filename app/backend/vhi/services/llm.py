"""Local LLM access (feature 4 assistant, feature 24 report narrative).

Uses an OpenAI-compatible server when ``VHI_LLM_URL`` is set (TensorRT-LLM, vLLM or NIM on the DGX Spark GPU),
else Ollama when ``VHI_OLLAMA_URL`` is set and reachable (a Malay-capable model such as SEA-LION or Qwen3).
Otherwise a deterministic template engine answers from the retrieved knowledge base - the apps show which one
answered, so nothing is presented as an LLM when it is not.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
from PIL import Image
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


# owned_by in an OpenAI-compatible /models listing -> the engine named in the UI
ENGINES = {"tensorrt_llm": "trtllm", "vllm": "vllm"}
# Qwen <|im_end|> and <|endoftext|>: trtllm-serve does not end the turn on <|im_end|> by itself and keeps writing.
QWEN_STOP_IDS = [151645, 151643]


class OpenAIServer:
    """A chat model behind an OpenAI-compatible server: TensorRT-LLM (trtllm-serve), vLLM or NVIDIA NIM."""

    def __init__(self, url: str, model: str, timeout: float):
        self.url, self.model, self.timeout = url.rstrip("/"), model, timeout
        self.engine = "openai"
        self.name = model  # the underlying model for the UI; vLLM reports it as "root" when served under an alias
        self._extras = True  # Qwen chat-template and stop-token fields; dropped if the server rejects them

    def probe(self) -> bool:
        r = httpx.get(f"{self.url}/models", timeout=2.0)
        m = next((m for m in r.json().get("data", []) if m.get("id") == self.model), None)
        if m:
            self.engine = ENGINES.get(m.get("owned_by", ""), "openai")
            self.name = m.get("root") or self.model
        return r.status_code == 200 and m is not None

    def chat(self, msgs: list[dict], max_tokens: int, temperature: float = 0.3) -> str:
        body = {"model": self.model, "messages": msgs, "max_tokens": max_tokens, "temperature": temperature, "top_p": 0.8}
        qwen = self._extras and "qwen" in self.model.lower()
        if qwen:  # answer directly (no <think> block) and stop at the end of the turn
            body.update(chat_template_kwargs={"enable_thinking": False}, stop_token_ids=QWEN_STOP_IDS)
        r = httpx.post(f"{self.url}/chat/completions", json=body, timeout=self.timeout)
        if r.status_code == 400 and qwen:  # a strict server that only takes the standard OpenAI fields
            self._extras = False
            return self.chat(msgs, max_tokens, temperature)
        r.raise_for_status()
        return r.json()["choices"][0]["message"].get("content") or ""


class _Probed:
    """Checks at most once a minute whether the model server answers, so a dead server costs nothing per request."""

    _ok: bool | None = None
    _checked = 0.0

    def _configured(self) -> bool:
        raise NotImplementedError

    def _probe(self) -> bool:
        raise NotImplementedError

    def available(self) -> bool:
        if not self._configured():
            return False
        if self._ok is None or time.time() - self._checked > 60:
            try:
                self._ok = self._probe()
            except (httpx.HTTPError, ValueError):
                self._ok = False
            self._checked = time.time()
        return bool(self._ok)


class LLM(_Probed):
    def __init__(self, settings: Settings):
        self.s = settings
        self.server = OpenAIServer(settings.llm_url, settings.llm_model, settings.llm_timeout_s) if settings.llm_url else None
        self.retriever = Retriever()

    @property
    def model(self) -> str:
        return self.server.name if self.server else self.s.ollama_model

    def _configured(self) -> bool:
        return bool(self.server or self.s.ollama_url)

    def _probe(self) -> bool:
        if self.server:
            return self.server.probe()
        r = httpx.get(f"{self.s.ollama_url}/api/tags", timeout=2.0)
        names = [m.get("name") for m in r.json().get("models", [])]
        return r.status_code == 200 and any(self.s.ollama_model.split(":")[0] in (n or "") for n in names)

    def status(self) -> dict:
        ok = self.available()
        engine = self.server.engine if self.server else "ollama"
        return {"backend": f"{engine}:{self.model}" if ok else "template", "engine": engine if ok else None,
                "model": self.model if ok else None, "url": self.s.llm_url or self.s.ollama_url or None, "reachable": ok,
                "note": None if ok else "No local LLM reachable - answers come from the built-in template engine."}

    def chat(self, system: str, messages: list[dict], max_tokens: int = 400) -> str | None:
        if not self.available():
            return None
        msgs = [{"role": "system", "content": system}, *messages]
        try:
            text = self.server.chat(msgs, max_tokens) if self.server else self._chat_ollama(msgs, max_tokens)
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
            log.warning("LLM call failed: %s", e)
            self._ok = False
            return None
        return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip() or None

    def _chat_ollama(self, msgs: list[dict], max_tokens: int) -> str:
        r = httpx.post(f"{self.s.ollama_url}/api/chat", timeout=self.s.llm_timeout_s, json={
            "model": self.s.ollama_model, "stream": False, "think": False,
            "options": {"temperature": 0.3, "num_predict": max_tokens}, "messages": msgs})
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "")


class VLM(_Probed):
    """Vision-language model on the GPU (``VHI_VLM_URL``, e.g. Qwen2.5-VL on vLLM) that describes an inspection photo
    in plain words, as a second opinion next to the image classifiers. Optional: without it the apps do not offer it."""

    def __init__(self, settings: Settings):
        self.server = OpenAIServer(settings.vlm_url, settings.vlm_model, settings.llm_timeout_s) if settings.vlm_url else None

    def _configured(self) -> bool:
        return self.server is not None

    def _probe(self) -> bool:
        return self.server.probe()

    def status(self) -> dict:
        ok = self.available()
        return {"backend": f"{self.server.engine}:{self.server.name}" if ok else None, "reachable": ok,
                "url": self.server.url if self.server else None}

    def describe(self, path: str | Path, prompt: str, max_tokens: int = 200) -> str | None:
        if not self.available():
            return None
        img = Image.open(path).convert("RGB")
        img.thumbnail((768, 768))  # enough detail for a description; keeps the vision prompt small and fast
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        msgs = [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": uri}}, {"type": "text", "text": prompt}]}]
        try:
            return self.server.chat(msgs, max_tokens, temperature=0.2).strip() or None
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
            log.warning("VLM call failed: %s", e)
            self._ok = False
            return None

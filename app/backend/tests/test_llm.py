"""LLM / VLM clients for OpenAI-compatible GPU servers (TensorRT-LLM, vLLM, NIM), with httpx stubbed out."""
import httpx
from PIL import Image

from vhi.config import Settings
from vhi.services import llm as llm_mod

QWEN = "nvidia/Qwen3-30B-A3B-FP4"


class _Resp:
    def __init__(self, status: int, payload: dict):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(f"HTTP {self.status_code}", request=None, response=None)


def _models(owned_by="tensorrt_llm", model=QWEN, root=None):
    return lambda url, timeout: _Resp(200, {"data": [{"id": model, "owned_by": owned_by, "root": root}]})


def _answer(text):
    return _Resp(200, {"choices": [{"message": {"content": text}}]})


def test_trtllm_backend_sends_qwen_fields_and_strips_thinking(monkeypatch):
    bodies = []

    def post(url, json, timeout):
        assert url == "http://gpu:8355/v1/chat/completions"
        bodies.append(json)
        return _answer("<think>plan</think> Slot esok: 09:00, 10:30.")

    monkeypatch.setattr(llm_mod.httpx, "get", _models())
    monkeypatch.setattr(llm_mod.httpx, "post", post)
    m = llm_mod.LLM(Settings(llm_url="http://gpu:8355/v1/", llm_model=QWEN, ollama_url=""))
    st = m.status()
    assert st["backend"] == f"trtllm:{QWEN}" and st["reachable"]
    assert m.chat("sys", [{"role": "user", "content": "slot esok?"}], max_tokens=50) == "Slot esok: 09:00, 10:30."
    b = bodies[0]
    assert b["model"] == QWEN and b["max_tokens"] == 50 and b["messages"][0] == {"role": "system", "content": "sys"}
    assert b["stop_token_ids"] == llm_mod.QWEN_STOP_IDS and b["chat_template_kwargs"] == {"enable_thinking": False}


def test_strict_server_gets_plain_openai_fields_and_outage_falls_back(monkeypatch):
    bodies = []

    def post(url, json, timeout):
        bodies.append(json)
        return _Resp(400, {}) if "stop_token_ids" in json else _answer("ok")

    monkeypatch.setattr(llm_mod.httpx, "get", _models(owned_by="vllm"))
    monkeypatch.setattr(llm_mod.httpx, "post", post)
    m = llm_mod.LLM(Settings(llm_url="http://gpu:8100/v1", llm_model=QWEN, ollama_url=""))
    assert m.chat("sys", [{"role": "user", "content": "x"}]) == "ok"
    assert "stop_token_ids" not in bodies[-1] and m.status()["backend"] == f"vllm:{QWEN}"

    def down(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(llm_mod.httpx, "post", down)
    assert m.chat("sys", [{"role": "user", "content": "x"}]) is None
    assert m.status()["backend"] == "template"  # the apps label the answer as the template engine


def test_unlisted_model_is_not_used(monkeypatch):
    monkeypatch.setattr(llm_mod.httpx, "get", _models(model="some-other-model"))
    m = llm_mod.LLM(Settings(llm_url="http://gpu:8355/v1", llm_model=QWEN, ollama_url=""))
    assert not m.available() and m.chat("sys", []) is None


def test_vlm_sends_the_photo_inline(monkeypatch, tmp_path):
    img = tmp_path / "tyre.jpg"
    Image.new("RGB", (1600, 1200), (40, 40, 40)).save(img)
    bodies = []

    def post(url, json, timeout):
        bodies.append(json)
        return _answer("The tread is worn and there is a crack in the sidewall.")

    monkeypatch.setattr(llm_mod.httpx, "get", _models(owned_by="vllm", model="vision", root="Qwen/Qwen2.5-VL-7B-Instruct"))
    monkeypatch.setattr(llm_mod.httpx, "post", post)
    v = llm_mod.VLM(Settings(vlm_url="http://gpu:8101/v1", vlm_model="vision"))
    assert v.status()["backend"] == "vllm:Qwen/Qwen2.5-VL-7B-Instruct"  # the alias "vision" is still what is requested
    assert v.describe(img, "Describe this tyre.").startswith("The tread is worn")
    assert bodies[0]["model"] == "vision"
    content = bodies[0]["messages"][0]["content"]
    assert content[0]["image_url"]["url"].startswith("data:image/jpeg;base64,") and content[1]["text"] == "Describe this tyre."
    assert not llm_mod.VLM(Settings(vlm_url="")).available()

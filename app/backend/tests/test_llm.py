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


def test_ollama_needs_the_exact_tag_and_template_opened_thinking_is_dropped(monkeypatch):
    tags = lambda url, timeout: _Resp(200, {"models": [{"name": "qwen3:30b-a3b"}, {"name": "llama3.2:3b"}]})
    monkeypatch.setattr(llm_mod.httpx, "get", tags)
    # another qwen3 being installed does not make the configured one answer (its chat would 404 on every request)
    assert not llm_mod.LLM(Settings(ollama_url="http://ollama:11434", ollama_model="qwen3:30b-a3b-instruct-2507-q4_K_M")).available()
    m = llm_mod.LLM(Settings(ollama_url="http://ollama:11434/", ollama_model="qwen3:30b-a3b"))
    assert m.status()["backend"] == "ollama:qwen3:30b-a3b"
    # a thinking model whose chat template already opened the <think> block returns only its closing tag
    monkeypatch.setattr(llm_mod.httpx, "post", lambda url, json, timeout: _Resp(200, {"message": {
        "content": "The user wants slots. Context lists 10:40.\n</think>\n\nSlot esok: 10:40."}}))
    assert m.chat("sys", [{"role": "user", "content": "slot esok?"}]) == "Slot esok: 10:40."


def test_ollama_models_are_kept_loaded(monkeypatch):
    posts = []

    def get(url, timeout):
        if url.endswith("/api/tags"):
            return _Resp(200, {"models": [{"name": "qwen3:30b-a3b-instruct-2507-q4_K_M"}]})
        return _Resp(200, {"data": [{"id": "qwen2.5vl:7b", "owned_by": "library"}]})  # Ollama's /v1/models

    def post(url, json, timeout):
        posts.append((url, json))
        return _Resp(200, {"message": {"content": "ok"}})

    monkeypatch.setattr(llm_mod.httpx, "get", get)
    monkeypatch.setattr(llm_mod.httpx, "post", post)
    s = Settings(ollama_url="http://ollama:11434", ollama_model="qwen3:30b-a3b-instruct-2507-q4_K_M",
                 vlm_url="http://ollama:11434/v1", vlm_model="qwen2.5vl:7b", llm_keep_alive="30m")
    llm, vlm = llm_mod.LLM(s), llm_mod.VLM(s)
    # an empty generate request loads the model and sets how long it stays loaded, on Ollama's native API
    assert llm.keep_loaded() and vlm.keep_loaded() and vlm.status()["backend"] == "ollama:qwen2.5vl:7b"
    assert posts == [("http://ollama:11434/api/generate", {"model": "qwen3:30b-a3b-instruct-2507-q4_K_M", "keep_alive": "30m"}),
                     ("http://ollama:11434/api/generate", {"model": "qwen2.5vl:7b", "keep_alive": "30m"})]
    llm.chat("sys", [{"role": "user", "content": "x"}])
    assert posts[-1][1]["keep_alive"] == "30m"  # every answer renews it too
    # not set: Ollama's default applies; TensorRT-LLM / vLLM keep their model loaded anyway
    assert not llm_mod.LLM(Settings(ollama_url="http://ollama:11434", ollama_model="qwen3:30b-a3b-instruct-2507-q4_K_M")).keep_loaded()
    monkeypatch.setattr(llm_mod.httpx, "get", _models(owned_by="vllm"))
    assert not llm_mod.LLM(Settings(llm_url="http://gpu:8100/v1", llm_model=QWEN, llm_keep_alive="30m")).keep_loaded()
    assert len(posts) == 3


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

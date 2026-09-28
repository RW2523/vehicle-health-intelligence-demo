"""View-only public link: with VHI_PRESENTER_PIN set, changing the demo needs the PIN; looking around does not."""
import pytest

from vhi import presenter
from vhi.config import get_settings

PIN = "40718253"


@pytest.fixture
def pin_set(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "presenter_pin", PIN)
    presenter.gate._fails.clear()
    yield client
    presenter.gate._fails.clear()


def test_open_by_default(client):
    assert client.get("/api/system/status").json()["presenter"] == {"required": False}
    assert client.post("/api/system/presenter", json={"pin": "anything"}).json()["ok"]


def test_view_only_without_the_pin(pin_set):
    c = pin_set
    assert c.get("/api/system/status").json()["presenter"] == {"required": True}
    assert c.get("/api/sessions").status_code == 200 and c.get("/api/fleet/overview").status_code == 200
    r = c.post("/api/sessions/S3/pause")
    assert r.status_code == 403 and r.json()["code"] == "presenter_pin"
    assert c.post("/api/evidence/tamper-test").status_code == 403
    assert c.post("/api/owner/self-check", json={}).status_code == 403
    # questions to the models change nothing other visitors see
    a = c.post("/api/owner/assistant", json={"conversation": "t-view", "text": "What does an EV inspection check?"})
    assert a.status_code == 200 and a.json()["kb_item"] == "ev"
    caps = c.get("/api/vision/captures").json()["cases"]
    assert c.post("/api/vision/analyse", json={"task": "damage", "capture_id": caps[0]["id"]}).status_code == 200


def test_the_pin_unlocks_and_wrong_pins_are_rate_limited(pin_set):
    c = pin_set
    assert c.post("/api/system/presenter", json={"pin": PIN}).json() == {"ok": True, "required": True}
    assert c.post("/api/sessions/S3/pause", headers={presenter.HEADER: PIN}).status_code == 200
    assert c.post("/api/system/presenter", json={"pin": "0000"}).status_code == 403
    for _ in range(presenter.MAX_FAILS - 1):
        c.post("/api/sessions/S3/pause", headers={presenter.HEADER: "1234"})
    # locked for a minute: not even the right PIN is compared, so guessing gets nowhere
    r = c.post("/api/sessions/S3/pause", headers={presenter.HEADER: PIN})
    assert r.status_code == 429 and r.json()["code"] == "presenter_pin"
    assert c.post("/api/system/presenter", json={"pin": PIN}).status_code == 429

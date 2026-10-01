"""The Chat Bot (operations copilot): entities and intents, grounded answers with numbered facts and links, the vehicle in
focus across turns, Malay, the conversations of each account, and who may ask. The tests run without an LLM, so every
answer comes from the template engine."""
import os
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from vhi import auth
from vhi.main import app
from vhi.services import copilot

PASSWORD = os.environ["VHI_DEMO_PASSWORD"]  # set by conftest


def login(username):
    c = TestClient(app)  # its own cookie jar; the app and runtime are the session client's
    r = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c


def ask(c, message, cid=None, plate=None):
    r = c.post("/api/copilot/chat", json={"message": message, "conversation_id": cid, "plate": plate})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "template"  # no LLM in the tests: the template engine answers, and says so
    assert len(d["suggestions"]) == 3
    for f in d["facts"]:
        assert f["n"] and f["text"] and f["kind"]
    return d


@pytest.fixture(autouse=True)
def fresh_gate():
    auth.gate._fails.clear()
    yield
    auth.gate._fails.clear()


@pytest.mark.parametrize("text,plates", [
    ("Why did DMO 9001 fail?", ["DMO 9001"]), ("why did dmo9001 fail", ["DMO 9001"]), ("DMO-9002 report", ["DMO 9002"]),
    ("Show the history of the Myvi", ["DMO 9006"]), ("How is the Civic?", ["DMO 9003"]), ("Honda", ["DMO 9003"]),
    ("BYD battery", ["DMO 9002"]), ("the Atto 3", ["DMO 9002"]), ("Is the Scania done?", ["DMO 9001"]),
    ("Where is the truck?", ["DMO 9001"]), ("the prime mover", ["DMO 9001"]), ("Ranger tread", ["WXD 2291"]),
    ("Hiace", ["BHY 7783"]), ("Vios brakes", ["VKR 3128"]), ("Innova", ["PKE 4410"]), ("Bezza", ["VJM 7412"]),
    ("NV350", ["JTR 5510"]), ("the Urvan", ["JTR 5510"]), ("Nurul Aina's car", ["DMO 9006"]),
    ("Compare the Myvi and the Civic", ["DMO 9006", "DMO 9003"]), ("WXD 2291 and VKR3128", ["WXD 2291", "VKR 3128"]),
    # a vehicle class, not the Scania; and words with numbers that are not plates
    ("What is the brake efficiency limit for a prime mover?", []), ("Any trucks waiting?", []), ("lane 3 is at 50%", []),
])
def test_plates_and_aliases(client, text, plates):
    assert copilot.vehicles_in(text) == plates


def test_lanes_intents_and_language(client):
    assert copilot.lanes_in("What's on lane 3 right now?") == [3]
    assert copilot.lanes_in("and L2?") == [2]
    assert copilot.lanes_in("lorong 4") == [4]
    assert copilot.intents_of("Summarise today at the hub") == ["today"]
    assert copilot.intents_of("Which fleet vehicle will reach its tread limit first?") == ["trend"]
    assert copilot.intents_of("What is the tread depth limit?") == ["rules"]
    assert "booking" in copilot.intents_of("Which vehicles have appointments this week?")
    assert copilot.intents_of("What can you do?") == ["help"]
    assert copilot.lang_of("Kenapa DMO 9001 gagal?") == "ms"
    assert copilot.lang_of("Tunjukkan sejarah Myvi") == "ms"
    assert copilot.lang_of("Ringkaskan hari ini di hab") == "ms"
    assert copilot.lang_of("Why did DMO 9001 fail?") == "en"


def test_today_summary(client):
    d = ask(client, "Summarise today at the hub")
    kinds = {f["kind"] for f in d["facts"]}
    assert "hub" in kinds and "lane" in kinds
    hub = next(f for f in d["facts"] if f["kind"] == "hub")
    assert hub["href"] == "/" and "vehicles on today's plan" in hub["text"]
    assert "[1]" in d["answer"] and d["intents"] == ["today"] and d["vehicle"] is None
    assert any(lk["href"] for lk in d["links"])
    # one lane
    d = ask(client, "What's on lane 3 right now?")
    assert any(f["text"].startswith("Lane 3") for f in d["facts"])
    assert all("Lane 1:" not in f["text"] for f in d["facts"])


def test_live_inspection_findings(client, s1):
    d = ask(client, "What are DMO 9001's open findings?")
    assert d["vehicle"] == "DMO 9001"
    insp = next(f for f in d["facts"] if f["kind"] == "inspection")
    assert insp["href"] == f"/inspection/{s1['inspection_id']}"
    assert any(f["kind"] in ("finding", "verdict") for f in d["facts"])


def test_vehicle_history(client):
    d = ask(client, "Show the history of the Myvi")
    assert d["vehicle"] == "DMO 9006" and "history" in d["intents"]
    kinds = {f["kind"] for f in d["facts"]}
    assert {"vehicle", "history", "odometer", "claim"} <= kinds
    assert any(f["href"] == f"/vehicles/{quote('DMO 9006')}" for f in d["facts"])
    assert "Nurul Aina" in d["facts"][0]["text"]


def test_rules_question(client):
    d = ask(client, "What is the brake efficiency limit for a prime mover?")
    assert d["intents"] == ["rules"] and d["vehicle"] is None
    texts = " ".join(f["text"] for f in d["facts"])
    assert "45%" in texts and "50%" in texts
    assert any(f["text"] == "For a heavy vehicle: the brake efficiency minimum is 45%." for f in d["facts"])
    d = ask(client, "Why does a dark tint fail?")
    assert d["intents"][0] == "rules" and any("front side windows at least 50%" in f["text"] for f in d["facts"])


def test_fleet_forecast(client):
    d = ask(client, "Which fleet vehicle will reach its tread limit first?")
    first = d["facts"][0]
    assert first["kind"] == "forecast" and "tread depth" in first["text"] and first["href"].endswith("?tab=health")
    assert first["text"].startswith("WXD 2291")  # the Ranger's tread is forecast to reach 1.6 mm first


def test_appointments(client):
    d = ask(client, "Which vehicles have appointments this week?")
    assert "booking" in d["intents"]
    assert all(f["href"] == "/appointments" for f in d["facts"] if f["kind"] == "booking")


def test_multi_turn_focus(client):
    d = ask(client, "Why did DMO 9001 fail?")
    cid = d["conversation_id"]
    assert d["vehicle"] == "DMO 9001" and d["intents"] == ["fail"]
    d = ask(client, "Show its history", cid)
    assert d["vehicle"] == "DMO 9001" and d["focus_used"] and "history" in d["intents"]
    assert any(f["kind"] == "history" or f["kind"] == "vehicle" for f in d["facts"])
    d = ask(client, "What about the Civic?", cid)  # the last question again, for another vehicle
    assert d["vehicle"] == "DMO 9003" and "history" in d["intents"] and not d["focus_used"]
    d = ask(client, "Summarise today at the hub", cid)  # a hub question does not drop the vehicle in focus
    assert d["vehicle"] == "DMO 9003"
    # a vehicle chip scopes the question
    d = ask(client, "What is its battery health?", plate="DMO 9002")
    assert d["vehicle"] == "DMO 9002"
    # "it" with nothing in focus: ask which vehicle
    d = ask(client, "Why did it fail?")
    assert not d["facts"] and "Which vehicle" in d["answer"]


def test_malay(client):
    d = ask(client, "Kenapa DMO 9001 gagal?")
    assert d["lang"] == "ms" and d["vehicle"] == "DMO 9001"
    d = ask(client, "Ringkaskan hari ini di hab")
    assert d["lang"] == "ms" and "kenderaan hari ini" in d["answer"]
    assert d["suggestions"][0] == "Siapa dalam barisan?"


def test_help_and_unknown(client):
    d = ask(client, "What can you do?")
    assert d["intents"] == ["help"] and "Inspection rules" in d["answer"] and not d["facts"]
    d = ask(client, "What's the exchange rate of the yen?")
    assert not d["facts"] and "couldn't find" in d["answer"]


def test_conversations_list_get_delete(client):
    d = ask(client, "Show the history of the Myvi")
    cid = d["conversation_id"]
    ask(client, "Does it have an appointment?", cid)
    convs = client.get("/api/copilot/conversations").json()
    c = next(x for x in convs if x["id"] == cid)
    assert c["title"] == "Show the history of the Myvi" and c["count"] == 4 and c["updated_at"].endswith("Z")
    assert convs[0]["id"] == cid  # newest first
    full = client.get(f"/api/copilot/conversations/{cid}").json()
    assert [m["role"] for m in full["messages"]] == ["user", "assistant", "user", "assistant"]
    assert full["messages"][1]["facts"] and full["messages"][1]["source"] == "template"
    assert client.delete(f"/api/copilot/conversations/{cid}").status_code == 200
    assert client.get(f"/api/copilot/conversations/{cid}").status_code == 404
    assert cid not in {x["id"] for x in client.get("/api/copilot/conversations").json()}
    assert client.delete(f"/api/copilot/conversations/{cid}").status_code == 404
    assert client.get("/api/copilot/conversations/../../etc").status_code == 404


def test_conversations_belong_to_their_account(client):
    ex = login("examiner")
    d = ask(ex, "Summarise today at the hub")
    assert d["conversation_id"] in {x["id"] for x in ex.get("/api/copilot/conversations").json()}
    assert d["conversation_id"] not in {x["id"] for x in client.get("/api/copilot/conversations").json()}  # the presenter's
    assert client.get(f"/api/copilot/conversations/{d['conversation_id']}").status_code == 404
    hq = login("hq")
    assert hq.post("/api/copilot/chat", json={"message": "Which fleet vehicles need attention?"}).status_code == 200


def test_who_may_ask(client):
    viewer = login("viewer")  # reads, but asking stores a conversation: the UI says so
    assert viewer.get("/api/copilot/conversations").status_code == 200
    assert viewer.post("/api/copilot/chat", json={"message": "Summarise today at the hub"}).status_code == 403
    owner = login("owner")  # the owner has their own assistant in the mobile app
    assert owner.get("/api/copilot/conversations").status_code == 403
    assert owner.post("/api/copilot/chat", json={"message": "hi"}).status_code == 403
    assert len(client.get("/api/copilot/vehicles").json()) == 10

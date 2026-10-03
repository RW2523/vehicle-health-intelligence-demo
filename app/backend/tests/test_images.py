"""Image slots: stock photos of the ten main vehicles, uploads that replace them, reverting, licences, the prompts."""
import hashlib
import io
import json
import os
import shutil
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from vhi.config import get_settings
from vhi.services import images
from vhi.services.showcase import MAIN, MAIN_PLATES

END = "no text overlays, no logos, no watermarks, no brand names on signage"
VIEWS = ["hero", "rear", "side", "interior", "underbody", "tyre", "engine"]
# slots a few vehicles have besides the seven views: lane camera frames of DMO 9003's damage, the owners' plate photos
EXTRA = {"dmo-9003": ["damage_left", "damage_rear", "plate"], "dmo-9006": ["plate"], "dmo-9002": ["plate"]}
SCENES = {"hub", "lane", "pit", "flood", "tyre", "login", "brake_light"}


def _png(w=2000, h=1250, colour=(30, 120, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(buf, "PNG")
    return buf.getvalue()


def _served(client, url: str) -> Image.Image:
    r = client.get(url)
    assert r.status_code == 200, (url, r.status_code)
    assert r.headers["content-type"].startswith("image/jpeg")
    return Image.open(io.BytesIO(r.content))


def test_every_main_plate_has_a_hero(client):
    for plate in MAIN_PLATES:
        d = client.get(f"/api/images/vehicle/{plate}").json()
        assert d["plate"] == plate and d["paint"] and d["paint_hex"].startswith("#"), d
        h = d["hero"]
        assert h and h["view"] == "hero" and h["kind"] in ("stock", "uploaded"), plate
        if h["kind"] == "stock":
            assert h["url"].startswith("/media/data/images/stock/") and h["representative"] is True
            assert h["credit"].startswith("Photo: ") and "Wikimedia Commons" in h["credit"] and h["page_url"]
        assert _served(client, h["url_480"]).width == 480
        assert d["gallery"][0] == h and all(p["url"] for p in d["gallery"])
    # a vehicle without photos: empty, so the web app draws its illustration
    other = client.get("/api/images/vehicle/WXY 1234").json()
    assert other["hero"] is None and other["gallery"] == [] and other["paint"] is None


def test_slot_listing(client):
    rows = client.get("/api/images/slots").json()
    assert len(rows) == len(MAIN) * len(VIEWS) + sum(map(len, EXTRA.values())) + len(SCENES)
    ids = {r["id"] for r in rows}
    assert ({f"{m['slug']}.{v}" for m in MAIN for v in VIEWS} | {f"{g}.{v}" for g, vs in EXTRA.items() for v in vs}
            | {f"scene.{s}" for s in SCENES}) == ids
    for r in rows:
        assert {"id", "group", "plate", "view", "label", "where", "aspect", "prompt", "current", "stock", "uploaded"} <= r.keys()
        assert END in r["prompt"] and r["where"] and r["aspect"] in ("4:3", "16:9", "1:1", "21:9")
        if r["plate"]:
            assert r["plate"] in r["prompt"]  # the fictional plate is part of the prompt
    mine = client.get("/api/images/slots", params={"plate": "DMO 9006"}).json()
    assert [r["view"] for r in mine] == VIEWS + EXTRA["dmo-9006"] and all(r["group"] == "dmo-9006" for r in mine)
    scenes = client.get("/api/images/slots", params={"group": "scenes"}).json()
    assert {r["view"] for r in scenes} == SCENES and all(r["plate"] is None for r in scenes)
    assert sum(1 for r in rows if r["stock"]) >= 30  # most slots that matter have a stock photo
    groups = client.get("/api/images/groups").json()
    assert [g["plate"] for g in groups[:-1]] == MAIN_PLATES and groups[-1]["group"] == "scenes"
    assert all(g["hero"] and g["make"] and g["vtype"] and g["slots"] == len(VIEWS) + len(EXTRA.get(g["group"], [])) for g in groups[:-1])
    sc = client.get("/api/images/scenes").json()
    assert set(sc) == SCENES and sc["login"] and sc["login"]["kind"] in ("stock", "uploaded")
    md = client.get("/api/images/prompts.md")
    assert md.status_code == 200 and md.headers["content-type"].startswith("text/markdown")
    assert all(f"`{i}`" in md.text for i in ids) and "Settings → Images" in md.text


def test_upload_is_served_and_current_then_delete_reverts_to_stock(client):
    before = client.get("/api/images/vehicle/DMO 9006").json()["hero"]
    assert before["kind"] == "stock"
    r = client.post("/api/images/slots/dmo-9006.hero", files={"file": ("myvi.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["uploaded"] is True and s["stock"]["kind"] == "stock"
    cur = s["current"]
    assert cur["kind"] == "uploaded" and cur["url"].startswith("/media/images/dmo-9006/hero.jpg?v=")
    assert cur["representative"] is False and cur["credit"] == "Your upload"
    assert _served(client, cur["url"]).size == (1600, 1000)
    assert _served(client, cur["url_960"]).width == 960 and _served(client, cur["url_480"]).width == 480
    assert client.get("/api/images/vehicle/DMO 9006").json()["hero"]["url"] == cur["url"]
    # a second upload gets a new address, so browsers show it at once
    r2 = client.post("/api/images/slots/dmo-9006.hero", files={"file": ("b.jpg", _png(800, 600, (200, 40, 40)), "image/jpeg")})
    assert r2.status_code == 200 and r2.json()["current"]["url"] != cur["url"]
    assert _served(client, r2.json()["current"]["url"]).size == (800, 600)  # never enlarged

    d = client.delete("/api/images/slots/dmo-9006.hero")
    assert d.status_code == 200
    assert d.json()["uploaded"] is False and d.json()["current"] == before
    assert client.get("/api/images/vehicle/DMO 9006").json()["hero"] == before
    assert client.get(cur["url"].split("?")[0]).status_code == 404

    # a prompt-only slot: an upload fills it, deleting it leaves it empty again
    r = client.post("/api/images/slots/dmo-9001.underbody", files={"file": ("u.webp", _webp(), "image/webp")})
    assert r.status_code == 200 and r.json()["current"]["kind"] == "uploaded"
    assert client.delete("/api/images/slots/dmo-9001.underbody").json()["current"] is None


def _webp() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (90, 90, 90)).save(buf, "WEBP")
    return buf.getvalue()


def test_a_file_saved_by_hand_is_picked_up(client):
    folder = get_settings().var_dir / "images" / "scenes"
    folder.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (3000, 1500), (10, 60, 90)).save(folder / "pit.png")
    try:
        ph = client.get("/api/images/scenes").json()["pit"]
        assert ph["kind"] == "uploaded" and ph["url"].startswith("/media/images/scenes/pit.jpg?v=")
        assert _served(client, ph["url"]).size == (1600, 800)
    finally:
        client.delete("/api/images/slots/scene.pit")
    assert client.get("/api/images/scenes").json()["pit"]["kind"] == "stock"


@pytest.mark.parametrize("name,data,ctype,status", [
    ("notes.txt", b"hello", "text/plain", 415),
    ("fake.png", b"this is not a png at all", "image/png", 400),
    ("anim.gif", None, "image/gif", 415),
    ("huge.jpg", b"\xff\xd8" + b"0" * (12 * 1024 * 1024), "image/jpeg", 413),
    ("empty.jpg", b"", "image/jpeg", 400),
])
def test_a_bad_file_is_rejected(client, name, data, ctype, status):
    if data is None:
        buf = io.BytesIO()
        Image.new("RGB", (10, 10)).save(buf, "GIF")
        data = buf.getvalue()
    r = client.post("/api/images/slots/vkr-3128.hero", files={"file": (name, data, ctype)})
    assert r.status_code == status, r.text
    assert client.get("/api/images/vehicle/VKR 3128").json()["hero"]["kind"] == "stock"


def test_a_gif_sent_as_png_is_rejected(client):
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "GIF")
    assert client.post("/api/images/slots/vkr-3128.hero", files={"file": ("x.png", buf.getvalue(), "image/png")}).status_code == 415


def test_unknown_slot(client):
    assert client.post("/api/images/slots/abc.hero", files={"file": ("a.png", _png(), "image/png")}).status_code == 404
    assert client.delete("/api/images/slots/abc.hero").status_code == 404


def test_only_hq_and_presenter_may_change(client):
    password = os.environ["VHI_DEMO_PASSWORD"]  # set by conftest
    for user, ok in (("viewer", False), ("examiner", False), ("owner", False), ("hq", True)):
        c = TestClient(client.app)
        assert c.post("/api/auth/login", json={"username": user, "password": password}).status_code == 200
        assert c.get("/api/images/slots", params={"group": "scenes"}).status_code == 200  # everyone may look
        r = c.post("/api/images/slots/scene.tyre", files={"file": ("t.png", _png(400, 400), "image/png")})
        assert r.status_code == (200 if ok else 403), (user, r.status_code)
        if ok:
            assert c.delete("/api/images/slots/scene.tyre").status_code == 200


def test_every_stock_licence_is_allowed():
    m = json.loads((images.stock_dir() / "manifest.json").read_text())
    assert m["images"] and m["count"] == len(m["images"])
    data = get_settings().data_dir
    for im in m["images"]:
        assert images.LICENCE_RE.fullmatch(im["license"]), im["license"]
        assert not any(x in im["license"].upper() for x in ("NC", "ND", "GFDL")), im["license"]
        assert im["source"] == "Wikimedia Commons" and im["page_url"].startswith("https://commons.wikimedia.org/")
        assert im["representative"] is True and im["author"]
        assert im["license"].upper().startswith(("CC0", "PUBLIC", "PD")) or im["license_url"]
        for size, rel in im["files"].items():
            with Image.open(data / rel) as f:
                assert f.width == int(size) and f.format == "JPEG" and not f.getexif(), rel
        assert hashlib.sha1((data / im["files"]["1600"]).read_bytes()).hexdigest() == im["sha1"]
    assert {im["plate"] for im in m["images"] if im["view"] == "hero"} == set(MAIN_PLATES)


def test_runtime_reset_keeps_uploads(client, monkeypatch):
    """scripts/spark.sh reset (vhi.seed.reset_runtime) clears the runtime state; it must leave the uploads alone. The
    database deletes and the folder removal are recorded instead of run, so the other tests keep their data."""
    import vhi.seed as seed

    assert client.post("/api/images/slots/scene.hub", files={"file": ("h.png", _png(), "image/png")}).status_code == 200
    removed = []

    class _S:
        def execute(self, *_a, **_k):
            return type("R", (), {"rowcount": 0})()

    @contextmanager
    def fake_scope():
        yield _S()

    monkeypatch.setattr(seed, "session_scope", fake_scope)
    monkeypatch.setattr(seed, "init_db", lambda: None)
    monkeypatch.setattr(shutil, "rmtree", lambda p, *a, **k: removed.append(str(p)))
    seed.reset_runtime()
    up = images.uploads_dir().resolve()
    assert removed, "reset_runtime removes the evidence folder"
    for p in removed:
        rp = Path(p).resolve()
        assert rp != up and rp not in up.parents, f"reset_runtime would delete the uploads ({p})"
    monkeypatch.undo()
    ph = client.get("/api/images/scenes").json()["hub"]
    assert ph["kind"] == "uploaded"
    assert client.delete("/api/images/slots/scene.hub").json()["uploaded"] is False


def test_the_vehicles_own_photos_replace_its_sample_lane_frames(client):
    """DMO 9003's lane replay uses its own damage photos (its generated images, or an upload in Settings → Images that
    replaces one) instead of the sample frames; those slots are not gallery photos."""
    import shutil

    from vhi.config import get_settings
    from vhi.services import images
    from vhi.sim.player import build_events

    def body_frames():
        _, ev = build_events("S3")
        return [e.payload["path"] for e in ev if e.sensor == "camera" and e.payload.get("kind") == "body"]

    gen = images.generated_dir() / "dmo-9003"
    assert body_frames() == [str(gen / "damage_left.jpg"), str(gen / "damage_rear.jpg")]
    assert images.slot("dmo-9003.damage_rear")["current"]["kind"] == "generated"
    assert not any(ph["view"] in images.NOT_GALLERY for ph in images.gallery("DMO 9003"))
    sample = get_settings().data_dir / "images/vehicle_damage/r_breakage/car_damage_evaluat_00036.jpg"
    folder = images.uploads_dir() / "dmo-9003"
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copy(sample, folder / "damage_rear.png")  # dropped in by hand, any format: made usable on first use
    try:
        assert body_frames() == [str(gen / "damage_left.jpg"), str(folder / "damage_rear.jpg")]
        assert images.slot("dmo-9003.damage_rear")["uploaded"]
    finally:
        for f in folder.glob("damage_rear*"):
            f.unlink()
    assert body_frames()[1] == str(gen / "damage_rear.jpg")  # the upload gone, the generated image is back

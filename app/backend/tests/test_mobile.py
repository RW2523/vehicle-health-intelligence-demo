"""The mobile app's owner API additions: when the next inspection is due, reschedule and cancel a booking (with the
mock refund), and the "open on your phone" QR code."""
import datetime as dt
import os

from fastapi.testclient import TestClient

from vhi.main import app
from vhi.services import booking

PASSWORD = os.environ["VHI_DEMO_PASSWORD"]  # set by conftest


def login(username):
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": username, "password": PASSWORD}).status_code == 200
    return c


def _free(branch: str, day: str, express: bool = False, skip: tuple = ()) -> str:
    return next(x["time"] for x in booking.slots(branch, day) if x["available"] and x["gear"] == express and x["time"] not in skip)


def _later_day() -> str:
    d = booking.today() + dt.timedelta(days=5)
    return (d + dt.timedelta(days=1) if d.weekday() == 6 else d).isoformat()


def test_passport_says_when_the_next_inspection_is_due(client):
    p = client.get("/api/owner/passport/DMO%209006").json()
    due = p["next_due"]
    assert {"date", "days", "basis", "booked"} <= set(due)
    assert (dt.date.fromisoformat(due["date"]) - booking.today()).days == due["days"]
    if p["latest"] and p["latest"]["result"] == "PASS":  # a private car: a year after its latest PASS
        assert due["basis"].startswith("Yearly health check")
        assert dt.date.fromisoformat(due["date"]) == dt.date.fromisoformat(p["latest"]["date"][:10]) + dt.timedelta(days=365)
    assert p["reminders"][0]["kind"] == "road_tax"


def test_reschedule_and_cancel_a_booking(client):
    day = _later_day()
    first = _free("BR00", day)
    b = client.post("/api/owner/bookings", json={"plate": "DMO 9006", "branch_id": "BR00", "date": day, "slot": first,
                                                  "inspection_type": "VOLUNTARY"}).json()
    paid = client.post(f"/api/owner/bookings/{b['booking_id']}/pay", json={"method": "CARD"}).json()
    assert paid["status"] == "confirmed" and paid["payment_ref"].startswith("CARD-")
    # the next inspection due now points at the booking
    assert client.get("/api/owner/passport/DMO%209006").json()["next_due"]["booked"]["booking_id"]
    # same time again: refused; a free normal slot: moved, same price and check-in code
    assert client.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": day, "slot": first}).status_code == 400
    to = _free("BR01", day, skip=(first,))
    moved = client.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": day, "slot": to, "branch_id": "BR01"}).json()
    assert (moved["branch_id"], moved["date"], moved["slot"]) == ("BR01", day, to)
    assert moved["moved_from"]["slot"] == first and moved["price_rm"] == paid["price_rm"]
    assert moved["checkin_token"] == paid["checkin_token"] and moved["status"] == "confirmed"
    # a past day and a malformed date are refused
    past = (booking.today() - dt.timedelta(days=3)).isoformat()
    assert client.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": past, "slot": to}).status_code == 400
    assert client.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": "soon", "slot": to}).status_code == 400
    # cancel: refunded through the mock gateway, the slot is free again, and nothing more can change
    c = client.post(f"/api/owner/bookings/{b['booking_id']}/cancel").json()
    assert c["status"] == "cancelled" and c["refund"]["ref"].startswith("RF-") and c["refund"]["amount_rm"] == paid["price_rm"]
    assert client.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": day, "slot": first}).status_code == 409
    mine = client.get("/api/owner/bookings", params={"plate": "DMO 9006"}).json()
    assert next(x for x in mine if x["booking_id"] == b["booking_id"])["status"] == "cancelled"


def test_an_express_booking_moves_only_to_an_express_slot(client):
    g = client.get("/api/owner/gear", params={"branch_id": "BR02"}).json()
    if len(g["slots"]) < 1:
        return
    b = client.post("/api/owner/bookings", json={"plate": "DMO 9006", "branch_id": "BR02", "date": g["date"], "slot": g["slots"][0],
                                                  "inspection_type": "VOLUNTARY", "gear": True}).json()
    normal = _free("BR02", g["date"])
    r = client.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": g["date"], "slot": normal})
    assert r.status_code == 409 and "Express" in r.json()["detail"]
    # an unpaid booking is cancelled without a refund
    assert client.post(f"/api/owner/bookings/{b['booking_id']}/cancel").json()["refund"] is None


def test_an_owner_changes_only_their_own_bookings(client):
    day = _later_day()
    b = client.post("/api/owner/bookings", json={"plate": "DMO 9003", "branch_id": "BR00", "date": day,
                                                  "slot": _free("BR00", day), "inspection_type": "TRANSFER"}).json()
    own = login("owner")
    assert own.post(f"/api/owner/bookings/{b['booking_id']}/cancel").status_code == 403
    assert own.post(f"/api/owner/bookings/{b['booking_id']}/reschedule", json={"date": day, "slot": "16:40"}).status_code == 403
    assert own.post("/api/owner/bookings/BKnope/cancel").status_code == 404
    assert login("viewer").post(f"/api/owner/bookings/{b['booking_id']}/cancel").status_code == 403
    client.post(f"/api/owner/bookings/{b['booking_id']}/cancel")


def test_open_on_your_phone_qr(client):
    r = client.get("/api/owner/link-qr.svg", params={"url": "https://demo.example.ts.net/mobile?plate=DMO%209006"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml") and b"<svg" in r.content[:200]
    assert client.get("/api/owner/link-qr.svg", params={"url": "javascript:alert(1)"}).status_code == 400
    assert client.get("/api/owner/link-qr.svg", params={"url": "https://x/" + "a" * 700}).status_code == 422
    assert login("owner").get("/api/owner/link-qr.svg", params={"url": "http://localhost:3000/mobile"}).status_code == 200


# ---------------------------------------------------------------- the self-check: number plate and brake test
ALL_FINE = {"safe_place": True, "warning_light": True, "pedal": True, "straight": True, "quiet": True, "handbrake": True}


def _check(client, **attempt):
    r = client.post("/api/owner/self-check", json={"plate": "DMO 9006", **attempt})
    assert r.status_code == 200, r.text
    return r.json()


def _item(res, name):
    return next(i for i in res["items"] if i["item"] == name)


def test_the_plate_photo_is_the_cars_own_photo_or_a_labelled_sample(client, monkeypatch):
    from vhi.services import images

    ph = client.get("/api/owner/self-check/plate-photo", params={"plate": "dmo9006"}).json()
    assert ph["plate"] == "DMO 9006" and ph["source"] == "generated"  # the demo car's own (generated) photo
    assert ph["clean"] != ph["dirty"] and "-plate-dirty-" in ph["dirty"] and not ph["clean"].endswith("-sample.jpg")
    # a vehicle without a photo of its own gets the rendered sample, labelled "SAMPLE PHOTO" (the reader reads the photo)
    monkeypatch.setattr(images, "photo_file", lambda slot_id: None)
    ph = client.get("/api/owner/self-check/plate-photo", params={"plate": "dmo9006"}).json()
    assert ph["source"] == "sample" and ph["clean"].endswith("-sample.jpg")
    for url in (ph["clean"], ph["dirty"]):
        r = client.get(url)
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/jpeg")
    # an owner reaches only their own car's photo
    assert login("owner").get("/api/owner/self-check/plate-photo", params={"plate": "DMO 9003"}).status_code == 403


def test_a_clean_plate_is_read_and_matches_the_registered_plate(client):
    res = _check(client, plate_photo="clean")
    plate = _item(res, "Number plate")
    assert plate["ok"] and plate["value"] == "Reads DMO 9006" and plate["photo"] == "generated"
    assert plate["source"].startswith("live model") and plate["p"] > 0.5 and plate["image"].startswith("/media/evidence/selfcheck/")
    assert res["verdict"] == "Ready for inspection"


def test_a_dirty_plate_cannot_be_read_and_is_a_fix(client):
    res = _check(client, plate_photo="dirty", tint_vlt_pct=71)
    plate = _item(res, "Number plate")
    # the plate reader's real result on the muddy photo: nothing, or not the registered plate
    assert not plate["ok"] and (plate["value"] == "Not readable" or plate["value"].endswith(", not DMO 9006"))
    assert "clean the plate" in plate["advice"].lower() or plate["advice"].startswith("Number plate not readable: clean it")
    assert res["verdict"] == "Fix these first" and plate["advice"] in res["to_fix"]
    # the check is kept with its items: the passport's latest self-check shows the plate
    ev = [e for e in client.get("/api/owner/passport/DMO%209006").json()["events"] if e["kind"] == "self_check"]
    assert any(i["item"] == "Number plate" and not i["ok"] for e in ev for i in e["items"])


def test_a_plate_that_reads_as_another_registration_does_not_match(client, monkeypatch):
    from vhi.services import insights

    other = insights.plate_photo("DMO 9003")  # the photo shows another car's plate
    monkeypatch.setattr(insights, "plate_photo", lambda plate, dirty=False: other)
    plate = _item(_check(client, plate_photo="clean"), "Number plate")
    assert not plate["ok"] and plate["value"] == "Reads DMO 9003, not DMO 9006"
    assert "instead of DMO 9006" in plate["advice"]


def test_an_uploaded_plate_photo_replaces_the_sample(client):
    import io

    from vhi.services import images, insights

    img, _ = insights._sample_plate("DMO 9006", "#B8BCC1")  # stands in for the owner's photo (no sample tag)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    images.save_upload("dmo-9006.plate", buf.getvalue(), "image/jpeg")
    try:
        ph = client.get("/api/owner/self-check/plate-photo", params={"plate": "DMO 9006"}).json()
        assert ph["source"] == "uploaded"
        res = _check(client, plate_photo="clean")
        assert _item(res, "Number plate")["photo"] == "uploaded" and _item(res, "Number plate")["ok"]
        # the demo's dirt goes onto the plate the reader found on the upload
        assert not _item(_check(client, plate_photo="dirty"), "Number plate")["ok"]
    finally:
        images.delete_upload("dmo-9006.plate")
    assert client.get("/api/owner/self-check/plate-photo", params={"plate": "DMO 9006"}).json()["source"] == "generated"


def test_the_brake_answers_become_items_and_set_the_verdict(client):
    fine = _check(client, brakes=ALL_FINE)
    assert [i["item"] for i in fine["items"]] == ["Brake warning light", "Brake pedal", "Braking in a straight line",
                                                  "Brake noise", "Handbrake"]
    assert all(i["ok"] and i["source"].startswith("owner's answers") for i in fine["items"])
    assert fine["verdict"] == "Ready for inspection"
    # pulls to one side: a workshop has to look at it
    pulls = _check(client, tint_vlt_pct=38, brakes={**ALL_FINE, "straight": False})
    it = _item(pulls, "Braking in a straight line")
    assert not it["ok"] and it["value"] == "Pulls to one side"
    assert it["advice"] == "Pulls to one side when braking: have a workshop check the brakes before the inspection."
    assert pulls["verdict"] == "Needs a professional check"
    for key, name in (("warning_light", "Brake warning light"), ("pedal", "Brake pedal"), ("quiet", "Brake noise")):
        res = _check(client, brakes={**ALL_FINE, key: False})
        assert not _item(res, name)["ok"] and res["verdict"] == "Needs a professional check"
    # unanswered checks are left out; no safe place: the test is not done, which the owner can put right
    assert [i["item"] for i in _check(client, brakes={"safe_place": True, "pedal": True})["items"]] == ["Brake pedal"]
    skipped = _check(client, brakes={"safe_place": False, "straight": False})
    assert [(i["item"], i["value"], i["ok"]) for i in skipped["items"]] == [("Brake test", "Not done: no safe place", False)]
    assert skipped["verdict"] == "Fix these first"


def test_the_script_carries_the_plate_and_brakes_and_old_clients_still_work(client):
    script = client.get("/api/owner/self-check/script").json()
    a, b = script["first_attempt"], script["second_attempt"]
    assert (a["plate_photo"], b["plate_photo"]) == ("dirty", "clean") and a["brakes"] == b["brakes"] == ALL_FINE
    first = _check(client, **a)
    assert first["verdict"] == "Fix these first"
    assert {i["item"] for i in first["items"] if not i["ok"]} == {"Number plate", "Window tint", "Headlamp (left)"}
    second = _check(client, **b)
    assert second["verdict"] == "Ready for inspection" and _item(second, "Number plate")["value"] == "Reads DMO 9006"
    # a client that sends neither the plate photo nor the brake answers
    old = _check(client, tint_vlt_pct=71, headlamp_left="ok", headlamp_right="ok")
    assert [i["item"] for i in old["items"]] == ["Window tint", "Headlamp (left)", "Headlamp (right)"]
    assert client.post("/api/owner/self-check", json={"plate": "DMO 9006", "plate_photo": "smudged"}).status_code == 422

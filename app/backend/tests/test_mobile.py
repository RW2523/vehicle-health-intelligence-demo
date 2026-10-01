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

"""Appointments (the inspection app): the seeded calendar, the staff slot view and its rules, the booking life cycle
(book, pay, reschedule, check in, cancel), the link to the visit's inspection and report, and who may do what."""
import datetime as dt
import os

import pytest
from fastapi.testclient import TestClient

from vhi import auth
from vhi.db import session_scope
from vhi.main import app
from vhi.services import appointments as svc
from vhi.tables import Booking, LiveInspection, Report

A = "/api/appointments"
LIGHT = ["VKR 3128", "JTR 5510", "PKE 4410", "WXD 2291", "BHY 7783", "VJM 7412"]  # no lane replay, so no lane check-in


def login(username):
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": username, "password": os.environ["VHI_DEMO_PASSWORD"]}).status_code == 200
    return c


@pytest.fixture(autouse=True)
def fresh_gate():
    auth.gate._fails.clear()
    yield
    auth.gate._fails.clear()


@pytest.fixture
def made(client):
    """Appointments a test makes are cancelled afterwards, so no other test (or lane replay) meets them."""
    ids: list[str] = []
    yield ids
    for i in ids:
        client.post(f"{A}/{i}/cancel", json={"reason": "test clean-up"})


def free_slot(client, plate, branch="BR00", start=1, gear=None):
    """The first day from today+start with a slot this vehicle may take (and no appointment of its own that day)."""
    t = dt.date.fromisoformat(client.get(f"{A}/options").json()["today"])
    for k in range(start, start + 30):
        d = t + dt.timedelta(days=k)
        if d.weekday() == 6:
            continue
        v = client.get(f"{A}/slots", params={"branch_id": branch, "date": d.isoformat(), "plate": plate}).json()
        if v["vehicle_same_day"]:
            continue
        for x in v["slots"]:
            if x["available"] and (gear is None or x["gear"] == gear):
                return d.isoformat(), x["time"]
    raise AssertionError(f"no free slot for {plate}")


def test_seeded_calendar(client):
    d = client.get(A).json()
    t = dt.date.fromisoformat(d["today"])
    seeded = [i for i in d["items"] if i["booking_id"].startswith(svc.SEED_PREFIX)]
    assert 8 <= len(seeded) <= 12
    plates = {i["plate"] for i in seeded}
    assert plates and not plates & {"DMO 9001", "DMO 9006"}  # their use cases make their own bookings
    # the lane vehicles never get a confirmed seeded booking (the lane would check it in and take its type)
    assert all(i["status"] != "confirmed" for i in seeded if i["plate"] in ("DMO 9002", "DMO 9003"))
    statuses = {i["status"] for i in seeded}
    assert {"confirmed", "pending_payment", "cancelled"} <= statuses
    if t.weekday() != 6:
        assert any(i["status"] == "checked_in" and i["date"] == d["today"] for i in seeded)
        assert d["stats"]["checked_in_today"] >= 1 and d["stats"]["today"] >= 1
    assert all(dt.date.fromisoformat(i["date"]).weekday() != 6 for i in seeded)
    assert all(t <= dt.date.fromisoformat(i["date"]) <= t + dt.timedelta(days=15) for i in seeded)
    # every item carries what the calendar and the detail panel need
    i = seeded[0]
    assert {"vehicle", "branch_name", "type_label", "end", "payment", "timeline", "can", "qr_url", "checkin_url", "stage"} <= set(i)
    assert {"plate", "make", "model", "year", "vtype", "fuel", "owner_name"} <= set(i["vehicle"])
    assert [s["key"] for s in i["timeline"]][:2] == ["booked", "paid"]
    assert sum(d["days"].values()) == len([x for x in d["items"] if x["status"] != "cancelled"])
    assert d["counts"]["total"] == len(d["items"]) and d["counts"]["cancelled"] >= 1
    # idempotent: seeding again adds nothing
    assert svc.seed_appointments() == 0
    assert len(client.get(A).json()["items"]) == len(d["items"])
    # filters
    cancelled = client.get(A, params={"status": "cancelled"}).json()["items"]
    assert cancelled and all(x["status"] == "cancelled" for x in cancelled)
    owed = client.get(A, params={"status": "awaiting_payment"}).json()["items"]
    assert owed and all(x["awaiting_payment"] for x in owed)
    one = client.get(A, params={"plate": "pke4410"}).json()["items"]
    assert one and all(x["plate"] == "PKE 4410" for x in one)
    assert all(x["branch_id"] == "BR05" for x in client.get(A, params={"branch_id": "BR05"}).json()["items"])
    assert client.get(A, params={"from": "2026-10-10", "to": "2026-10-01"}).status_code == 400


def test_options_and_slot_rules(client):
    o = client.get(f"{A}/options").json()
    assert [v["plate"] for v in o["vehicles"]][:2] == ["DMO 9001", "DMO 9002"] and len(o["vehicles"]) == 10
    assert {t["code"] for t in o["types"]} >= {"TRANSFER", "PERIODIC", "EV", "VOLUNTARY"}
    heavy = next(v for v in o["vehicles"] if v["plate"] == "DMO 9001")
    assert heavy["heavy"] and heavy["suggested_type"] == "PERIODIC"
    day, _ = free_slot(client, "VKR 3128")
    v = client.get(f"{A}/slots", params={"branch_id": "BR00", "date": day, "plate": "DMO 9001"}).json()
    assert v["vehicle"]["heavy"] and all(x["gear"] for x in v["slots"] if x["available"])
    assert {x["reason"] for x in v["slots"] if not x["gear"]} == {"gear_only"}
    light = client.get(f"{A}/slots", params={"branch_id": "BR00", "date": day, "plate": "VKR 3128"}).json()
    assert all(x["reason"] == "gear_reserved" for x in light["slots"] if x["gear"])
    no_lane = client.get(f"{A}/slots", params={"branch_id": "BR01", "date": day, "plate": "DMO 9001"}).json()
    assert no_lane["available"] == 0 and {x["reason"] for x in no_lane["slots"]} == {"no_heavy_lane"}
    t = dt.date.fromisoformat(o["today"])
    sunday = t + dt.timedelta(days=6 - t.weekday() or 7)
    sv = client.get(f"{A}/slots", params={"branch_id": "BR00", "date": sunday.isoformat()}).json()
    assert sv["closed"] and sv["available"] == 0
    past = client.get(f"{A}/slots", params={"branch_id": "BR00", "date": (t - dt.timedelta(days=2)).isoformat()}).json()
    assert past["past"] and {x["reason"] for x in past["slots"]} <= {"past", "closed"}
    assert client.get(f"{A}/slots", params={"branch_id": "BR99", "date": day}).status_code == 404


def test_create_is_validated(client, made):
    day, slot = free_slot(client, "JTR 5510")
    t = dt.date.fromisoformat(client.get(f"{A}/options").json()["today"])
    body = {"plate": "JTR 5510", "branch_id": "BR00", "date": day, "slot": slot, "inspection_type": "PERIODIC"}

    def post(**kw):
        return client.post(A, json={**body, **kw})

    assert post(plate="ABC 1234").status_code == 400  # only the ten main vehicles
    assert post(plate="").status_code == 400
    assert post(inspection_type="NOPE").status_code == 400
    assert post(slot="09:10").status_code == 400
    assert post(date="2026-13-40").status_code == 400
    assert post(branch_id="BR99").status_code == 404
    assert post(date=(t - dt.timedelta(days=1)).isoformat()).status_code == 400  # past date
    sunday = t + dt.timedelta(days=6 - t.weekday() or 7)
    r = post(date=sunday.isoformat())
    assert r.status_code == 400 and "Sunday" in r.json()["detail"]
    assert post(slot="10:40").status_code == 400  # a gear slot: held for heavy vehicles
    hday, hslot = free_slot(client, "DMO 9001", gear=True)
    r = post(plate="DMO 9001", date=hday, slot=next(x for x in svc.booking_svc.SLOT_TIMES if x not in svc.booking_svc.GEAR_TIMES))
    assert r.status_code == 400 and "gear" in r.json()["detail"]
    assert post(plate="DMO 9001", branch_id="BR01", date=hday, slot=hslot).status_code == 400  # no heavy lane there
    assert post(note="x" * 600).status_code == 400
    assert post(paid=True, method="BITCOIN").status_code == 400
    # a good one: confirmed at once, pay at the counter
    ok = post(note="Tail lamp check")
    assert ok.status_code == 200, ok.text
    b = ok.json()
    made.append(b["booking_id"])
    assert b["status"] == "confirmed" and b["source"] == "staff" and b["payment"]["state"] == "counter" and b["awaiting_payment"]
    assert b["note"] == "Tail lamp check" and b["vehicle"]["model"].startswith("NV350") and b["branch_name"] == "Central Inspection Hub"
    assert b["price_rm"] == svc.booking_svc.TYPES["PERIODIC"]["price"]
    # the same vehicle twice that day
    again = post(slot=next(x["time"] for x in client.get(f"{A}/slots", params={"branch_id": "BR00", "date": day, "plate": "JTR 5510"}).json()["slots"]
                           if x["available"] and x["time"] != slot))
    assert again.status_code == 409
    # the heavy vehicle in a gear slot, paid on the spot; the gear slot is then taken
    h = post(plate="DMO 9001", date=hday, slot=hslot, paid=True, method="FPX").json()
    made.append(h["booking_id"])
    assert h["payment"]["state"] == "paid" and h["payment_ref"].startswith("FPX-") and h["gear_slot"]
    gear = next(x for x in client.get(f"{A}/slots", params={"branch_id": "BR00", "date": hday}).json()["slots"] if x["time"] == hslot)
    assert gear["free"] == 0 and gear["booked"][0]["plate"] == "DMO 9001"


def test_a_full_slot_is_refused(client, made):
    """A small hub's slot with room for one: the first vehicle gets it, the next is told it is full."""
    t = dt.date.fromisoformat(client.get(f"{A}/options").json()["today"])
    for k in range(1, 30):
        d = t + dt.timedelta(days=k)
        if d.weekday() == 6:
            continue
        if any(client.get(f"{A}/slots", params={"branch_id": "BR07", "date": d.isoformat(), "plate": p}).json()["vehicle_same_day"]
               for p in ("PKE 4410", "VJM 7412")):
            continue
        v = client.get(f"{A}/slots", params={"branch_id": "BR07", "date": d.isoformat()}).json()
        one = next((x for x in v["slots"] if x["available"] and not x["gear"] and x["free"] == 1), None)
        if one:
            break
    else:
        pytest.skip("no slot with one place left")
    first = client.post(A, json={"plate": "PKE 4410", "branch_id": "BR07", "date": d.isoformat(), "slot": one["time"], "inspection_type": "VOLUNTARY"})
    assert first.status_code == 200, first.text
    made.append(first.json()["booking_id"])
    full = client.post(A, json={"plate": "VJM 7412", "branch_id": "BR07", "date": d.isoformat(), "slot": one["time"], "inspection_type": "VOLUNTARY"})
    assert full.status_code == 409 and "full" in full.json()["detail"]


def test_life_cycle(client, made):
    day, slot = free_slot(client, "VKR 3128", start=2)
    b = client.post(A, json={"plate": "VKR 3128", "branch_id": "BR00", "date": day, "slot": slot, "inspection_type": "VOLUNTARY"}).json()
    bid = b["booking_id"]
    made.append(bid)
    assert client.get(f"{A}/{bid}").json()["booking_id"] == bid
    assert client.get(f"{A}/NOPE").status_code == 404
    # QR of the check-in page
    q = client.get(f"{A}/{bid}/qr.svg")
    assert q.status_code == 200 and q.headers["content-type"].startswith("image/svg") and b"<svg" in q.content
    # mock payment at the counter
    assert client.post(f"{A}/{bid}/payment", json={"method": "GOLD"}).status_code == 400
    p = client.post(f"{A}/{bid}/payment", json={"method": "CASH"}).json()
    assert p["payment"]["state"] == "paid" and p["payment_ref"].startswith("CASH-") and not p["awaiting_payment"]
    assert next(s for s in p["timeline"] if s["key"] == "paid")["done"]
    assert client.post(f"{A}/{bid}/payment", json={"method": "CASH"}).status_code == 409
    # check-in opens on the day only
    assert client.post(f"{A}/{bid}/checkin").status_code == 409
    # reschedule: not to the same time, and only to a slot it may take
    assert client.post(f"{A}/{bid}/reschedule", json={"date": day, "slot": slot}).status_code == 400
    assert client.post(f"{A}/{bid}/reschedule", json={"date": day, "slot": "10:40"}).status_code == 400
    nday, nslot = free_slot(client, "VKR 3128", start=(dt.date.fromisoformat(day) - dt.date.fromisoformat(client.get(A).json()["today"])).days + 1)
    m = client.post(f"{A}/{bid}/reschedule", json={"date": nday, "slot": nslot}).json()
    assert (m["date"], m["slot"]) == (nday, nslot) and m["events"][-1]["kind"] == "rescheduled"
    # the slot view of the moved appointment's day does not count the appointment against itself
    assert client.get(f"{A}/slots", params={"branch_id": "BR00", "date": nday, "plate": "VKR 3128", "exclude": bid}).json()["vehicle_same_day"] is None
    # cancel: a reason is required; a paid one is refunded (mock)
    assert client.post(f"{A}/{bid}/cancel", json={"reason": " "}).status_code == 400
    c = client.post(f"{A}/{bid}/cancel", json={"reason": "Fleet moved the car to another depot"}).json()
    assert c["status"] == "cancelled" and c["cancel_reason"].startswith("Fleet") and c["payment"]["state"] == "refunded"
    assert c["timeline"][-1]["key"] == "cancelled" and not any(c["can"].values())
    assert client.post(f"{A}/{bid}/cancel", json={"reason": "again"}).status_code == 409
    assert client.post(f"{A}/{bid}/checkin").status_code == 409
    assert client.post(f"{A}/{bid}/reschedule", json={"date": nday, "slot": nslot}).status_code == 409


def _today_booking(plate: str, slot: str = "08:20") -> str:
    """An appointment today, written straight to the table (today's slots may have passed when the tests run)."""
    with session_scope() as s:
        b = Booking(plate=plate, branch_id="BR07", date=svc.today().isoformat(), slot=slot, inspection_type="VOLUNTARY",
                    price_rm=60.0, source="staff", status="confirmed")
        s.add(b)
        s.flush()
        return b.booking_id


def test_check_in_and_the_visit(client):
    """Counter check-in, then the visit's lane inspection and its report show on the appointment (whichever way it was
    checked in: at the counter, or by the lane's plate read of the booking)."""
    counter, lane = _today_booking("BHY 7783"), _today_booking("JTR 5510", "08:40")
    made_rows: list[str] = []
    try:
        before = client.get(A).json()["stats"]["checked_in_today"]
        c = client.post(f"{A}/{counter}/checkin").json()
        assert c["status"] == "checked_in" and c["stage"] == "checked_in" and c["timeline"][2]["done"]
        assert c["can"]["checkin"] is False and c["can"]["pay"] is True  # still to pay at the counter
        assert client.get(A, params={"branch_id": "BR07"}).json()["stats"]["checked_in_today"] >= 1
        assert client.get(A).json()["stats"]["checked_in_today"] == before + 1
        assert client.post(f"{A}/{counter}/checkin").status_code == 409
        now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
        with session_scope() as s:
            # the counter visit's inspection (no plate-read link: found by plate, day and time) ...
            a = LiveInspection(lane_id="BR07-L1", branch_id="BR07", plate="BHY 7783", inspection_type="Voluntary Inspection",
                               status="reported", verdict="PASS", started_at=now + dt.timedelta(minutes=1), results={})
            # ... and one the lane checked in by reading the plate (the lane sets the booking's state itself)
            s.get(Booking, lane).status = "checked_in"
            b = LiveInspection(lane_id="BR07-L2", branch_id="BR07", plate="JTR 5510", inspection_type="Voluntary Inspection",
                               status="in_lane", started_at=now - dt.timedelta(hours=30),
                               results={"anpr": {"booking": {"booking_id": lane, "slot": "x", "gear": False}}})
            s.add_all([a, b])
            s.flush()
            made_rows += [a.inspection_id, b.inspection_id]
            s.add(Report(inspection_id=a.inspection_id, plate="BHY 7783", kind="Voluntary inspection report", verdict="PASS",
                         summary="test", narrative_source="template", verify_token="tst" + a.inspection_id, chain_hash="0" * 64))
        g = client.get(f"{A}/{counter}").json()
        assert g["inspection_id"] == made_rows[0] and g["report"]["verdict"] == "PASS" and g["stage"] == "reported"
        assert [s["done"] for s in g["timeline"]] == [True, False, True, True, True]  # not paid yet
        h = client.get(f"{A}/{lane}").json()
        assert h["inspection_id"] == made_rows[1] and h["stage"] == "in_lane" and h["report"] is None
        assert [s["done"] for s in h["timeline"]] == [True, False, True, False, False]
    finally:
        with session_scope() as s:
            for r in s.query(Report).filter(Report.inspection_id.in_(made_rows)):
                s.delete(r)
            for i in made_rows:
                s.delete(s.get(LiveInspection, i))
            for bid in (counter, lane):
                s.get(Booking, bid).status = "cancelled"


def test_who_may_book(client):
    ex = login("examiner")  # an examiner works at their own hub (BR00)
    items = ex.get(A).json()["items"]
    assert items and all(i["branch_id"] == "BR00" for i in items)
    assert all(i["branch_id"] == "BR00" for i in ex.get(A, params={"branch_id": "BR05"}).json()["items"])
    other = next(i for i in client.get(A, params={"branch_id": "BR05"}).json()["items"])
    assert ex.get(f"{A}/{other['booking_id']}").status_code == 403
    assert ex.get(f"{A}/{other['booking_id']}/qr.svg").status_code == 403
    assert ex.get(f"{A}/{items[0]['booking_id']}/qr.svg").status_code == 200
    assert ex.post(f"{A}/{other['booking_id']}/cancel", json={"reason": "not mine"}).status_code == 403
    day, slot = free_slot(client, "PKE 4410", branch="BR05")
    assert ex.post(A, json={"plate": "PKE 4410", "branch_id": "BR05", "date": day, "slot": slot, "inspection_type": "VOLUNTARY"}).status_code == 403
    assert [b["branch_id"] for b in ex.get(f"{A}/options").json()["branches"]] == ["BR00"]
    assert login("fleet").get(A).status_code == 200 and login("hq").get(A).status_code == 200
    assert login("owner").get(A).status_code == 403 and login("regulator").get(A).status_code == 403
    v = login("viewer")
    assert v.get(A).status_code == 200 and v.post(f"{A}/{other['booking_id']}/cancel", json={"reason": "viewer"}).status_code == 403
    assert TestClient(app).get(A).status_code == 401

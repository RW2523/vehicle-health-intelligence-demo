"""Startup migrations: data written by older builds is brought up to the current codes."""
from sqlalchemy import text

from vhi.db import engine, init_db


def test_older_booking_type_codes_are_renamed(client):
    with engine().begin() as c:
        bid, was = c.execute(text("select booking_id, inspection_type from bookings limit 1")).first()
        assert bid, "the seed creates bookings"
        c.execute(text("update bookings set inspection_type = 'B5+B7' where booking_id = :b"), {"b": bid})
    init_db()
    with engine().begin() as c:
        assert c.execute(text("select inspection_type from bookings where booking_id = :b"), {"b": bid}).scalar() == "TRANSFER+FINANCING"
        assert not c.execute(text("select count(*) from bookings where inspection_type in ('B5', 'B7', 'B5+B7', 'BERKALA')")).scalar()
        c.execute(text("update bookings set inspection_type = :t where booking_id = :b"), {"t": was, "b": bid})  # as the seed left it

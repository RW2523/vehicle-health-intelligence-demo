"""Database engine and session helpers. Works with PostgreSQL/TimescaleDB (DGX Spark) or SQLite (laptop)."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_Session: sessionmaker | None = None


def engine() -> Engine:
    global _engine, _Session
    if _engine is None:
        url = get_settings().db_url
        kwargs: dict = {"future": True, "pool_pre_ping": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        _engine = create_engine(url, **kwargs)
        if url.startswith("sqlite"):
            @event.listens_for(_engine, "connect")
            def _sqlite_pragmas(dbapi_conn, _):  # noqa: ANN001
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA synchronous=NORMAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.close()
        _Session = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def reset_engine() -> None:
    """Used by tests to point at a fresh database."""
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _Session = None


@contextmanager
def session_scope() -> Iterator[Session]:
    engine()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def is_postgres() -> bool:
    return engine().dialect.name == "postgresql"


def init_db() -> None:
    from . import tables  # noqa: F401  (registers the ORM tables)

    Base.metadata.create_all(engine())
    if is_postgres():
        # Turn the readings table into a Timescale hypertable when the extension is available.
        try:
            with engine().begin() as c:
                has_ts = c.execute(text("select 1 from pg_available_extensions where name='timescaledb'")).first()
                if has_ts:
                    c.execute(text("create extension if not exists timescaledb"))
                    c.execute(text(
                        "select create_hypertable('readings', 'ts', if_not_exists => true, migrate_data => true)"
                    ))
                    logging.getLogger("vhi.db").info("readings is a TimescaleDB hypertable")
        except Exception as e:  # noqa: BLE001 - plain Postgres works too; the hypertable is an optimisation
            logging.getLogger("vhi.db").warning("TimescaleDB hypertable not created (%s); using a plain table", e)

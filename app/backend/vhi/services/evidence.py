"""Tamper-evident evidence log (feature 23).

Every entry stores the SHA-256 of its canonical JSON payload and a chain hash:
``hash = sha256(prev_hash + ts + kind + inspection_id + payload_hash)``. Changing any stored payload, or deleting
or reordering an entry, breaks every hash after it. ``verify()`` recomputes the chain from the start.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import threading
from pathlib import Path
from typing import Any

from sqlalchemy import select, text

from ..db import engine, session_scope
from ..tables import EvidenceEntry

GENESIS = "0" * 64
_lock = threading.Lock()


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def chain_hash(prev: str, ts: str, kind: str, inspection_id: str | None, payload_hash: str) -> str:
    return sha256_text(f"{prev}|{ts}|{kind}|{inspection_id or ''}|{payload_hash}")


def append(kind: str, payload: dict, inspection_id: str | None = None, actor: str = "system") -> dict:
    with _lock, session_scope() as s:
        last = s.execute(select(EvidenceEntry).order_by(EvidenceEntry.seq.desc()).limit(1)).scalar_one_or_none()
        prev = last.hash if last else GENESIS
        ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")
        ph = sha256_text(canonical(payload))
        h = chain_hash(prev, ts, kind, inspection_id, ph)
        e = EvidenceEntry(ts=ts, inspection_id=inspection_id, kind=kind, actor=actor, payload=payload,
                          payload_hash=ph, prev_hash=prev, hash=h)
        s.add(e)
        s.flush()
        return {"seq": e.seq, "hash": h, "prev_hash": prev, "ts": ts, "kind": kind}


def verify(inspection_id: str | None = None) -> dict:
    """Recompute the whole chain. Returns the first broken entry, if any."""
    with session_scope() as s:
        rows = s.execute(select(EvidenceEntry).order_by(EvidenceEntry.seq)).scalars().all()
        prev = GENESIS
        checked = 0
        for e in rows:
            ph = sha256_text(canonical(e.payload))
            ok_payload = ph == e.payload_hash
            expect = chain_hash(prev, e.ts, e.kind, e.inspection_id, e.payload_hash)
            if not ok_payload or e.prev_hash != prev or e.hash != expect:
                return {"intact": False, "checked": checked, "total": len(rows), "broken_at_seq": e.seq,
                        "reason": "payload changed after it was logged" if not ok_payload else "chain link broken",
                        "kind": e.kind, "inspection_id": e.inspection_id}
            prev = e.hash
            checked += 1
        n_insp = sum(1 for e in rows if inspection_id and e.inspection_id == inspection_id)
        return {"intact": True, "checked": checked, "total": len(rows), "head": prev,
                "inspection_entries": n_insp if inspection_id else None}


def entries(inspection_id: str | None = None, limit: int = 200) -> list[dict]:
    with session_scope() as s:
        q = select(EvidenceEntry).order_by(EvidenceEntry.seq.desc())
        if inspection_id:
            q = q.where(EvidenceEntry.inspection_id == inspection_id)
        rows = s.execute(q.limit(limit)).scalars().all()
        return [dict(seq=e.seq, ts=e.ts, kind=e.kind, actor=e.actor, inspection_id=e.inspection_id, payload=e.payload,
                     payload_hash=e.payload_hash, prev_hash=e.prev_hash, hash=e.hash) for e in reversed(rows)]


def tamper_test() -> dict:
    """Demonstrates detection: silently edits one stored payload, verifies, then restores it."""
    with _lock:
        with session_scope() as s:
            e = s.execute(select(EvidenceEntry).where(EvidenceEntry.kind == "decision")
                          .order_by(EvidenceEntry.seq.desc()).limit(1)).scalar_one_or_none()
            if e is None:
                e = s.execute(select(EvidenceEntry).order_by(EvidenceEntry.seq.desc()).limit(1)).scalar_one_or_none()
            if e is None:
                return {"ran": False, "reason": "log is empty"}
            seq, original = e.seq, dict(e.payload)
        tampered = {**original, "tampered_note": "value edited directly in the database"}
        with engine().begin() as c:
            c.execute(text("update evidence_log set payload = :p where seq = :s"), {"p": json.dumps(tampered), "s": seq})
        after = verify()
        with engine().begin() as c:
            c.execute(text("update evidence_log set payload = :p where seq = :s"), {"p": json.dumps(original), "s": seq})
        restored = verify()
        return {"ran": True, "edited_seq": seq, "detected": not after["intact"], "verify_after_edit": after,
                "verify_after_restore": restored}

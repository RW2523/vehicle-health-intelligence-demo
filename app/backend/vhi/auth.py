"""Login and roles.

Every app is behind a login with one demo account per role (ACCOUNTS). A session is a signed cookie, and the API
checks the role on every request (ROUTES), so a user reaches only the apps and data of their role: an examiner the
lanes of their branch, an owner their own vehicle. Open without a login: the buyer's verification page and the lane
check-in scan, both reached through an unguessable token in a QR code. Wrong passwords are rate-limited for everyone.

Passwords: VHI_DEMO_PASSWORD for every role account, VHI_VIEWER_PASSWORD for the read-only viewer.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import deque
from contextvars import ContextVar
from dataclasses import asdict, dataclass

from fastapi import HTTPException

from .config import get_settings

COOKIE = "vhi_session"
SESSION_S = 12 * 3600
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass(frozen=True)
class Account:
    username: str
    name: str
    role: str
    title: str
    branch_id: str | None = None
    examiner_id: str | None = None
    senior: bool = False
    plate: str | None = None


ACCOUNTS = {a.username: a for a in [
    Account("presenter", "Demo presenter", "presenter", "Runs the demo · every app"),
    Account("examiner", "Arjun Ismail", "examiner", "Vehicle examiner · Alam Megah", "BR00", "VE011"),
    Account("senior", "Priya Hassan", "examiner", "Senior examiner · Alam Megah", "BR00", "VE001", senior=True),
    Account("hq", "HQ operations", "hq", "PUSPAKOM HQ · all branches"),
    Account("regulator", "JPJ / DOE officer", "regulator", "Regulator"),
    Account("fleet", "Fleet manager", "fleet", "Fleet portal"),
    Account("owner", "Nurul Aina", "owner", "Owner of DMO 9006", plate="DMO 9006"),
    Account("viewer", "Guest viewer", "viewer", "Read only · every app, no changes"),
]}

# (path prefix, roles that may read, roles that may change). The first matching prefix wins; the presenter may do
# everything, the viewer may read everything. Paths under /api not listed here are the presenter's only.
ROUTES = [
    ("/api/sessions", {"examiner", "hq"}, {"examiner"}),
    ("/api/inspections", {"examiner", "hq"}, {"examiner"}),
    ("/api/reports", {"examiner", "hq", "regulator"}, {"examiner"}),
    ("/api/evidence", {"examiner", "hq"}, {"hq"}),
    ("/api/vision", {"examiner", "hq"}, {"examiner", "hq"}),
    ("/api/owner", {"owner"}, {"owner"}),
    ("/api/fleet", {"fleet", "hq"}, {"fleet"}),
    ("/api/hq", {"hq"}, {"hq"}),
    ("/api/regulator", {"regulator", "hq"}, {"regulator", "hq"}),
    ("/api/sales", {"owner", "hq", "regulator"}, {"owner", "hq"}),
    ("/api/floodwatch", {"hq", "regulator"}, {"hq", "regulator"}),
    ("/api/system", {"*"}, set()),
    ("/api/branches", {"*"}, set()),
    ("/api/examiners", {"*"}, set()),
    ("/api/vehicles", {"*"}, set()),
    ("/api/mysikap", {"*"}, set()),
    ("/media", {"*"}, set()),
    ("/ws", {"*"}, set()),
]
# no login needed: health, the login itself, what a QR code opens, and the fleet API (it has its own API key)
OPEN_PREFIXES = ("/api/health", "/api/auth/", "/api/verify/", "/api/owner/checkin/", "/api/fleet/v1/")
# questions to the models change nothing other people see: the read-only viewer may ask them too
VIEWER_QUESTIONS = {"/api/owner/assistant", "/api/vision/analyse", "/api/vision/explain"}
GUARDED = ("/api/", "/media/", "/ws")

current_user: ContextVar[Account | None] = ContextVar("current_user", default=None)


def user() -> Account | None:
    """The logged-in account of the current request (set by vhi.main.RequireLogin)."""
    return current_user.get()


def examiner_branch() -> str | None:
    """The branch an examiner account is limited to (None for every other account)."""
    a = user()
    return a.branch_id if a and a.role == "examiner" else None


def check_branch(branch_id: str | None) -> None:
    b = examiner_branch()
    if b and branch_id != b:
        raise HTTPException(403, "This inspection is at another branch.")


def own_plate(plate: str) -> str:
    """An owner reaches only their own vehicle."""
    a = user()
    if a and a.role == "owner" and plate.strip().upper() != (a.plate or "").upper():
        raise HTTPException(403, "Only your own vehicle.")
    return plate


def public(a: Account) -> dict:
    return {k: v for k, v in asdict(a).items()}


def allowed(a: Account, method: str, path: str) -> bool:
    if a.role == "presenter":
        return True
    write = method not in SAFE_METHODS
    if a.role == "viewer":
        return not write or path in VIEWER_QUESTIONS
    for prefix, read_roles, write_roles in ROUTES:
        if path == prefix or path.startswith(prefix + "/") or path.startswith(prefix + "?"):
            roles = write_roles if write else read_roles
            return "*" in roles or a.role in roles
    return False


def needs_login(path: str) -> bool:
    return path.startswith(GUARDED) and not path.startswith(OPEN_PREFIXES)


# ---- passwords and sessions
def _secret() -> bytes:
    s = get_settings()
    if s.auth_secret:
        return s.auth_secret.encode()
    f = s.var_dir / "auth_secret"
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(secrets.token_hex(32))
        f.chmod(0o600)
    return f.read_text().strip().encode()


def check_password(username: str, password: str) -> Account | None:
    a = ACCOUNTS.get(username)
    if a is None:
        return None
    s = get_settings()
    want = (s.viewer_password or s.demo_password) if a.role == "viewer" else s.demo_password
    return a if want and hmac.compare_digest(password.encode(), want.encode()) else None


def issue(a: Account) -> str:
    payload = f"{a.username}|{int(time.time()) + SESSION_S}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def verify(token: str | None) -> Account | None:
    if not token:
        return None
    try:
        username, exp, sig = base64.urlsafe_b64decode(token.encode()).decode().split("|")
    except (ValueError, UnicodeDecodeError):
        return None
    good = hmac.new(_secret(), f"{username}|{exp}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, good) or int(exp) < time.time():
        return None
    return ACCOUNTS.get(username)


class Gate:
    """Wrong passwords are rate-limited for everyone: after MAX_FAILS in a minute, no password is compared."""

    MAX_FAILS, WINDOW_S = 10, 60.0

    def __init__(self) -> None:
        self._fails: deque[float] = deque()

    def locked(self) -> bool:
        now = time.monotonic()
        while self._fails and now - self._fails[0] > self.WINDOW_S:
            self._fails.popleft()
        return len(self._fails) >= self.MAX_FAILS

    def failed(self) -> None:
        self._fails.append(time.monotonic())


gate = Gate()

"""Login, logout and the logged-in account (vhi/auth.py)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/api/auth", tags=["login"])


class LoginReq(BaseModel):
    username: str
    password: str


@router.get("/accounts")
def accounts():
    """The demo accounts the login page offers (no passwords)."""
    return [{"username": a.username, "name": a.name, "role": a.role, "title": a.title} for a in auth.ACCOUNTS.values()]


@router.post("/login")
def login(req: LoginReq, request: Request, response: Response):
    if auth.gate.locked():
        raise HTTPException(429, "Too many wrong passwords - wait a minute and try again.")
    a = auth.check_password(req.username.strip().lower(), req.password)
    if a is None:
        auth.gate.failed()
        raise HTTPException(401, "Wrong username or password.")
    https = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip() == "https"
    response.set_cookie(auth.COOKIE, auth.issue(a), max_age=auth.SESSION_S, httponly=True, samesite="lax", secure=https)
    return auth.public(a)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    a = auth.verify(request.cookies.get(auth.COOKIE))
    if a is None:
        raise HTTPException(401, "Not logged in.")
    return auth.public(a)

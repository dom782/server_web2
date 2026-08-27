from datetime import datetime, timedelta, timezone
from typing import Any
import jwt
from fastapi import HTTPException, Request, status
from app.config import settings

ALG = "HS256"

def _encode(payload: dict[str, Any], ttl: int, kind: str) -> str:
    now = datetime.now(timezone.utc)
    data = {**payload, "kind": kind, "iat": now, "exp": now + timedelta(seconds=ttl)}
    return jwt.encode(data, settings.session_secret, algorithm=ALG)

def make_agent_token(device_id: str) -> str:
    return _encode({"sub": device_id}, settings.agent_token_ttl_seconds, "agent")

def make_session_token(user: dict) -> str:
    return _encode({"sub": user["id"], "role": user["role"], "name": user["name"], "email": user["email"]}, settings.session_ttl_seconds, "session")

def decode_token(token: str, expected_kind: str) -> dict:
    try:
        payload = jwt.decode(token, settings.session_secret, algorithms=[ALG])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc
    if payload.get("kind") != expected_kind:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return payload

def current_user(request: Request) -> dict:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return decode_token(token, "session")

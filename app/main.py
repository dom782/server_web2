from __future__ import annotations
import json
import secrets
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.agent_manager import agent_manager, AgentUnavailable
from app.config import settings
from app.db import get_db
from app.models import RelayOrder, DeliveryEvent, PushSubscription
from app.push import send_order_push
from app.schemas import AgentAuthIn, RegisterIn, LoginIn, ArticleSearchIn, OrderCreateIn, PushSubscriptionIn
from app.security import make_agent_token, make_session_token, decode_token, current_user

app = FastAPI(title="Cammarano Orders", docs_url=None if settings.app_env == "production" else "/docs")
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != settings.app_origin.rstrip("/"):
            return Response(status_code=403, content="Invalid origin")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'"
    if request.url.scheme == "https" or settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

@app.get("/health")
async def health():
    return {"status": "ok", "agent_online": agent_manager.online}

@app.get("/")
async def home():
    return FileResponse(static_dir / "index.html")

@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(static_dir / "manifest.webmanifest", media_type="application/manifest+json")

@app.get("/sw.js")
async def sw():
    return FileResponse(static_dir / "sw.js", media_type="application/javascript", headers={"Service-Worker-Allowed": "/"})

@app.post("/api/agent/auth")
async def agent_auth(body: AgentAuthIn):
    if body.device_id != settings.agent_device_id or not secrets.compare_digest(body.device_secret, settings.agent_device_secret):
        raise HTTPException(status_code=401, detail="Invalid agent credentials")
    return {"access_token": make_agent_token(body.device_id), "token_type": "bearer", "expires_in": settings.agent_token_ttl_seconds}

@app.websocket("/ws/agent")
async def agent_ws(websocket: WebSocket):
    auth = websocket.headers.get("authorization", "")
    device_id = websocket.headers.get("x-agent-id", "")
    if not auth.startswith("Bearer "):
        await websocket.close(code=4401); return
    try:
        payload = decode_token(auth[7:], "agent")
    except HTTPException:
        await websocket.close(code=4401); return
    if payload.get("sub") != device_id or device_id != settings.agent_device_id:
        await websocket.close(code=4403); return
    await websocket.accept()
    await agent_manager.attach(websocket, device_id)
    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            await agent_manager.handle_incoming(message)
    except (WebSocketDisconnect, json.JSONDecodeError):
        pass
    finally:
        agent_manager.detach(websocket)


def set_session(response: Response, user: dict):
    response.set_cookie("session", make_session_token(user), max_age=settings.session_ttl_seconds,
                        httponly=True, secure=settings.app_env == "production", samesite="lax", path="/")

@app.post("/api/auth/register")
async def register(body: RegisterIn, response: Response):
    try:
        data = await agent_manager.request("user.register", body.model_dump())
    except AgentUnavailable as exc:
        raise HTTPException(503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc
    user = data["user"]
    set_session(response, user)
    return {"user": user}

@app.post("/api/auth/login")
async def login(body: LoginIn, response: Response):
    try:
        data = await agent_manager.request("user.login", body.model_dump())
    except AgentUnavailable as exc:
        raise HTTPException(503, detail=str(exc)) from exc
    if not data.get("authenticated") or not data.get("user"):
        raise HTTPException(401, detail="Email o password non validi")
    user = data["user"]
    set_session(response, user)
    return {"user": user}

@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("session", path="/")
    return {"ok": True}

@app.get("/api/me")
async def me(user=Depends(current_user)):
    return {"user": user, "agent_online": agent_manager.online}

@app.post("/api/articles/search")
async def article_search(body: ArticleSearchIn, user=Depends(current_user)):
    try:
        return await agent_manager.request("article.get", body.model_dump())
    except AgentUnavailable as exc:
        raise HTTPException(503, detail=str(exc)) from exc

@app.get("/api/recipients")
async def recipients(user=Depends(current_user)):
    try:
        return await agent_manager.request("user.recipients", {"user_id": user["sub"]})
    except AgentUnavailable as exc:
        raise HTTPException(503, detail=str(exc)) from exc

@app.post("/api/orders")
async def create_order(body: OrderCreateIn, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    payload = {"sender_id": user["sub"], "recipient_id": body.recipient_id,
               "items": [item.model_dump() for item in body.items]}
    try:
        result = await agent_manager.request("order.create", payload)
    except AgentUnavailable as exc:
        raise HTTPException(503, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, detail=str(exc)) from exc
    order = result["order"]
    existing = await db.get(RelayOrder, order["id"])
    if existing is None:
        db.add(RelayOrder(id=order["id"], sender_id=order["sender_id"], recipient_id=order["recipient_id"],
                          status=order.get("status", "SENT"), payload=order))
    db.add(DeliveryEvent(order_id=order["id"], event_type="SENT", details={"via": "web"}))
    await db.commit()
    await send_order_push(db, order["recipient_id"], order)
    return {"order": order}

@app.get("/api/orders")
async def list_orders(direction: str = "all", user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        return await agent_manager.request("order.list", {"user_id": user["sub"], "direction": direction})
    except AgentUnavailable:
        stmt = select(RelayOrder).where(or_(RelayOrder.sender_id == user["sub"], RelayOrder.recipient_id == user["sub"]))
        rows = (await db.execute(stmt.order_by(RelayOrder.created_at.desc()))).scalars().all()
        return {"orders": [row.payload for row in rows], "source": "railway-cache"}

@app.get("/api/orders/{order_id}")
async def get_order(order_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        return await agent_manager.request("order.get", {"order_id": order_id, "user_id": user["sub"]})
    except AgentUnavailable:
        row = await db.get(RelayOrder, order_id)
        if not row or user["sub"] not in {row.sender_id, row.recipient_id}:
            raise HTTPException(404, detail="Comanda non trovata")
        return {"order": row.payload, "source": "railway-cache"}

@app.post("/api/orders/{order_id}/read")
async def mark_order_read(order_id: str, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    try:
        result = await agent_manager.request("order.mark_read", {"order_id": order_id, "user_id": user["sub"]})
    except AgentUnavailable as exc:
        raise HTTPException(503, detail=str(exc)) from exc
    order = result.get("order")
    if order:
        row = await db.get(RelayOrder, order_id)
        if row:
            row.status = order.get("status", "READ")
            row.payload = order
        db.add(DeliveryEvent(order_id=order_id, event_type="READ", details={"user_id": user["sub"]}))
        await db.commit()
    return result

@app.get("/api/push/config")
async def push_config(user=Depends(current_user)):
    return {"enabled": bool(settings.vapid_public_key and settings.vapid_private_key), "public_key": settings.vapid_public_key}

@app.post("/api/push/subscribe")
async def push_subscribe(body: PushSubscriptionIn, user=Depends(current_user), db: AsyncSession = Depends(get_db)):
    p256dh, auth = body.keys.get("p256dh"), body.keys.get("auth")
    if not p256dh or not auth:
        raise HTTPException(400, detail="Invalid push subscription")
    row = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))).scalar_one_or_none()
    if row:
        row.user_id, row.p256dh, row.auth = user["sub"], p256dh, auth
    else:
        db.add(PushSubscription(user_id=user["sub"], endpoint=body.endpoint, p256dh=p256dh, auth=auth))
    await db.commit()
    return {"ok": True}

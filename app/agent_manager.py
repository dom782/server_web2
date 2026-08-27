from __future__ import annotations
import asyncio
import json
import uuid
from fastapi import WebSocket
from app.config import settings

class AgentUnavailable(RuntimeError):
    pass

class AgentManager:
    def __init__(self):
        self.websocket: WebSocket | None = None
        self.device_id: str | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._send_lock = asyncio.Lock()

    @property
    def online(self) -> bool:
        return self.websocket is not None

    async def attach(self, websocket: WebSocket, device_id: str):
        if self.websocket is not None:
            try:
                await self.websocket.close(code=1012)
            except Exception:
                pass
        self.websocket = websocket
        self.device_id = device_id

    def detach(self, websocket: WebSocket):
        if self.websocket is websocket:
            self.websocket = None
            self.device_id = None
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(AgentUnavailable("Local agent disconnected"))
            self._pending.clear()

    async def handle_incoming(self, message: dict):
        if message.get("type") == "response":
            request_id = str(message.get("request_id") or "")
            future = self._pending.pop(request_id, None)
            if future and not future.done():
                future.set_result(message)

    async def request(self, action: str, payload: dict) -> dict:
        websocket = self.websocket
        if websocket is None:
            raise AgentUnavailable("Local agent is offline")
        request_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending[request_id] = future
        message = {"version": 1, "id": request_id, "type": "request", "action": action, "payload": payload}
        try:
            async with self._send_lock:
                await websocket.send_text(json.dumps(message, separators=(",", ":")))
            response = await asyncio.wait_for(future, timeout=settings.agent_request_timeout_seconds)
        except Exception:
            self._pending.pop(request_id, None)
            raise
        if not response.get("success"):
            error = response.get("error") or {}
            code = error.get("code", "agent_error")
            msg = error.get("message", "Agent request failed")
            if code == "forbidden":
                raise PermissionError(msg)
            if code == "bad_request":
                raise ValueError(msg)
            raise RuntimeError(msg)
        return response.get("payload") or {}

agent_manager = AgentManager()

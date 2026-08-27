import json
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pywebpush import webpush, WebPushException
from app.config import settings
from app.models import PushSubscription

logger = logging.getLogger(__name__)

async def send_order_push(db: AsyncSession, recipient_id: str, order: dict):
    if not settings.vapid_private_key or not settings.vapid_public_key:
        return
    rows = (await db.execute(select(PushSubscription).where(PushSubscription.user_id == recipient_id))).scalars().all()
    data = json.dumps({
        "title": "Nuova comanda",
        "body": f"Hai ricevuto una nuova comanda ({len(order.get('items', []))} articoli)",
        "url": "/",
        "order_id": order.get("id"),
    })
    stale = []
    for sub in rows:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        try:
            webpush(subscription_info=info, data=data, vapid_private_key=settings.vapid_private_key,
                    vapid_claims={"sub": settings.vapid_subject})
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                stale.append(sub)
            else:
                logger.warning("Push delivery failed: %s", status or exc.__class__.__name__)
    for sub in stale:
        await db.delete(sub)
    if stale:
        await db.commit()

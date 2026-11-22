"""
Distributed fixed-window rate limiter backed by MongoDB (works across multiple API replicas,
no extra infrastructure). Keys are hashed so no IPs / e-mails are stored in clear text.
"""
import hashlib
import logging
import math
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from pymongo import ReturnDocument

logger = logging.getLogger("app.ratelimit")

COLLECTION = "rate_limits"


async def hit(key: str, limit: int, window_seconds: int = 60) -> bool:
    """Registers one hit. Returns True when the request is allowed."""
    from app.core.database import get_db

    now = time.time()
    window = int(now // window_seconds)
    doc_id = hashlib.sha256(f"{key}|{window}".encode()).hexdigest()
    try:
        doc = await get_db()[COLLECTION].find_one_and_update(
            {"_id": doc_id},
            {
                "$inc": {"count": 1},
                "$setOnInsert": {"expires_at": datetime.utcnow() + timedelta(seconds=window_seconds * 2)},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return int(doc.get("count", 1)) <= limit
    except Exception:  # pragma: no cover - fail open but log loudly
        logger.exception("Rate limiter unavailable (failing open)")
        return True


async def enforce(key: str, limit: int, window_seconds: int = 60, message: str = "Too many requests. Please try again later.") -> None:
    if not await hit(key, limit, window_seconds):
        retry = int(math.ceil(window_seconds - (time.time() % window_seconds)))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=message,
            headers={"Retry-After": str(retry)},
        )

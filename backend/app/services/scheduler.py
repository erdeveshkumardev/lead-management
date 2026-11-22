"""
Background jobs (IndiaMART auto-sync, overdue invoice marking).
A MongoDB lease guarantees only one API replica runs a job at a time.
"""
import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta

from pymongo import ReturnDocument

from app.core.config import settings
from app.core.database import get_db

logger = logging.getLogger("app.scheduler")
_OWNER = f"{socket.gethostname()}:{os.getpid()}"


async def acquire_lease(name: str, seconds: int) -> bool:
    now = datetime.utcnow()
    try:
        doc = await get_db()["job_leases"].find_one_and_update(
            {"_id": name, "$or": [{"lease_until": {"$lt": now}}, {"owner": _OWNER}]},
            {"$set": {"lease_until": now + timedelta(seconds=seconds), "owner": _OWNER}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return bool(doc and doc.get("owner") == _OWNER)
    except Exception:
        # duplicate key on upsert means another replica holds the lease
        return False


async def mark_overdue_invoices() -> int:
    from app.core.timeutil import local_today
    from app.models.invoice import Invoice

    today = datetime.combine(local_today(), datetime.min.time())
    result = await Invoice.get_motor_collection().update_many(
        {"document_type": "TAX_INVOICE", "payment_status": {"$in": ["UNPAID", "PARTIALLY_PAID"]},
         "due_date": {"$lt": today}, "financials.balance_due": {"$gt": 0}},
        {"$set": {"payment_status": "OVERDUE", "updated_at": datetime.utcnow()}},
    )
    return result.modified_count


async def run_indiamart_sync() -> None:
    from app.models.tenant import Tenant
    from app.services.integration_service import sync_indiamart_for_tenant

    tenants = await Tenant.find({"integrations.indiamart.is_enabled": True,
                                 "integrations.indiamart.auto_sync": True,
                                 "status": {"$in": ["ACTIVE", "TRIAL"]}}).to_list()
    for tenant in tenants:
        try:
            created, dups, message = await sync_indiamart_for_tenant(tenant)
            logger.info("IndiaMART sync tenant=%s %s", tenant.id, message)
        except Exception:
            logger.exception("IndiaMART sync failed for tenant=%s", tenant.id)


async def scheduler_loop(stop: asyncio.Event) -> None:
    interval = max(5, settings.INDIAMART_SYNC_INTERVAL_MINUTES) * 60
    while not stop.is_set():
        try:
            if await acquire_lease("overdue_invoices", 600):
                count = await mark_overdue_invoices()
                if count:
                    logger.info("Marked %s invoices as OVERDUE", count)
            if await acquire_lease("indiamart_sync", interval - 30):
                await run_indiamart_sync()
        except Exception:
            logger.exception("Scheduler iteration failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass

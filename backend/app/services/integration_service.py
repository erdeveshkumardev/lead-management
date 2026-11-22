"""Outbound integrations: Meta Graph API lead retrieval and IndiaMART Pull API sync."""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import httpx

from app.core.config import settings
from app.core.crypto import decrypt_str
from app.core.timeutil import _zone
from app.models.tenant import Tenant
from app.services.adapters.facebook import FacebookAdapter
from app.services.adapters.indiamart import IndiaMARTAdapter, extract_indiamart_records
from app.services.lead_service import process_and_save_lead

logger = logging.getLogger("app.integrations")
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


async def fetch_meta_lead(leadgen_id: str, page_access_token: str) -> Optional[Dict[str, Any]]:
    if not leadgen_id.isdigit():
        return None
    url = f"https://graph.facebook.com/{settings.META_GRAPH_API_VERSION}/{leadgen_id}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(url, params={
            "access_token": page_access_token,
            "fields": "id,created_time,field_data,form_id,ad_id,campaign_id",
        })
    if resp.status_code != 200:
        logger.warning("Meta Graph lead fetch failed (status=%s)", resp.status_code)
        return None
    return resp.json()


async def process_meta_leadgen(tenant_id: str, page_access_token: Optional[str], event: Dict[str, Any]) -> None:
    """Background task: fetch the full lead from Graph API and ingest it."""
    leadgen_id = str(event.get("leadgen_id") or "")
    if not leadgen_id or not page_access_token:
        logger.warning("Meta leadgen event skipped: missing leadgen_id or Page Access Token (tenant=%s)", tenant_id)
        return
    try:
        lead_obj = await fetch_meta_lead(leadgen_id, page_access_token)
        if not lead_obj:
            return
        lead_obj.setdefault("form_id", event.get("form_id"))
        lead_obj.setdefault("ad_id", event.get("ad_id"))
        dto = FacebookAdapter().parse_payload(lead_obj, tenant_id)
        await process_and_save_lead(dto)
    except Exception:
        logger.exception("Failed to process Meta leadgen event (tenant=%s)", tenant_id)


def _indiamart_time(dt: datetime) -> str:
    # IndiaMART expects IST in the form DD-Mon-YYYYHH:MM:SS
    return dt.strftime("%d-%b-%Y%H:%M:%S")


async def sync_indiamart_for_tenant(tenant: Tenant) -> Tuple[int, int, str]:
    """
    Pulls leads since the last successful sync (max 7-day window allowed by IndiaMART).
    Returns (created, duplicates, status_message).
    """
    cfg = tenant.integrations.indiamart
    crm_key = decrypt_str(cfg.crm_key) or decrypt_str(cfg.api_key)
    if not cfg.is_enabled or not crm_key:
        return 0, 0, "IndiaMART integration is disabled or the CRM key is missing."

    zone = _zone()
    now_local = datetime.now(zone)
    since_utc = cfg.last_sync_at or (datetime.utcnow() - timedelta(days=1))
    since_local = since_utc.replace(tzinfo=timezone.utc).astimezone(zone)
    if now_local - since_local > timedelta(days=7):
        since_local = now_local - timedelta(days=7) + timedelta(minutes=1)

    params = {
        "glusr_crm_key": crm_key,
        "start_time": _indiamart_time(since_local),
        "end_time": _indiamart_time(now_local),
    }
    created = duplicates = 0
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(settings.INDIAMART_PULL_URL, params=params)
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") or resp.text.startswith("{") else {}
    except Exception as exc:
        message = f"IndiaMART request failed: {type(exc).__name__}"
        await _save_sync_state(tenant, None, message)
        return 0, 0, message

    code = str(data.get("CODE", ""))
    if code not in ("200", "204"):
        message = f"IndiaMART returned {code or resp.status_code}: {str(data.get('MESSAGE') or '')[:200]}"
        await _save_sync_state(tenant, None, message)
        return 0, 0, message

    adapter = IndiaMARTAdapter()
    for record in extract_indiamart_records(data):
        if not record.get("UNIQUE_QUERY_ID"):
            continue
        try:
            _, is_dup = await process_and_save_lead(adapter.parse_payload(record, str(tenant.id)))
            duplicates += int(is_dup)
            created += int(not is_dup)
        except ValueError:
            continue
    message = f"Synced: {created} new, {duplicates} duplicate/updated"
    await _save_sync_state(tenant, datetime.utcnow(), message)
    return created, duplicates, message


async def _save_sync_state(tenant: Tenant, synced_at: Optional[datetime], message: str) -> None:
    update: Dict[str, Any] = {"integrations.indiamart.last_sync_status": message[:300]}
    if synced_at:
        update["integrations.indiamart.last_sync_at"] = synced_at
        update["integrations.indiamart.status"] = "Connected"
    else:
        update["integrations.indiamart.status"] = "Error"
    await Tenant.get_motor_collection().update_one({"_id": tenant.id}, {"$set": update})

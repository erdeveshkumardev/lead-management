"""
Inbound lead webhooks.

Every provider endpoint is authenticated - there is no "no key configured, accept anything" path:
  * IndiaMART / TradeIndia / Justdial: per-company secret token (URL path, ?token= or X-Webhook-Token header)
  * Meta (Facebook / Instagram) Lead Ads: X-Hub-Signature-256 HMAC with the App Secret; the lead itself is
    then fetched from the Graph API with the Page Access Token
  * Website forms: public token + origin allow-list + bot traps, or HMAC / secret key for server-to-server
All endpoints are rate limited per IP (shared across replicas) and bounded in body size.
"""
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse

from app.core import rate_limiter
from app.core.config import settings
from app.core.crypto import decrypt_str
from app.core.database import get_document_by_id
from app.core.deps import INACTIVE_TENANT_STATUSES, get_client_ip
from app.core.security import constant_time_equals
from app.models.tenant import IntegrationConfig, Tenant
from app.services.adapters.base import BaseLeadAdapter
from app.services.adapters.facebook import FacebookAdapter, extract_leadgen_events
from app.services.adapters.indiamart import IndiaMARTAdapter, extract_indiamart_records
from app.services.adapters.justdial import JustdialAdapter
from app.services.adapters.tradeindia import TradeIndiaAdapter
from app.services.adapters.website import WebsiteAdapter
from app.services.integration_service import process_meta_leadgen
from app.services.lead_service import process_and_save_lead

logger = logging.getLogger("app.webhooks")
router = APIRouter(prefix="/webhooks", tags=["Lead Ingestion Webhooks"])

ADAPTERS: Dict[str, BaseLeadAdapter] = {
    "indiamart": IndiaMARTAdapter(),
    "tradeindia": TradeIndiaAdapter(),
    "justdial": JustdialAdapter(),
    "facebook": FacebookAdapter(),
    "website": WebsiteAdapter(),
}

HONEYPOT_FIELDS = ["website_hp", "_hp_trap", "honeypot", "hp_check", "_honey", "extra_fax_number",
                   "company_secondary_url", "fax_number"]
FAKE_PHONE_PATTERNS = {str(d) * 10 for d in range(10)} | {"1234567890", "0123456789", "9876543210"}
MAX_RECORDS_PER_CALL = 50


# ----------------------------------------------------------------- shared helpers
async def _rate_limit(request: Request, provider: str, tenant_id: str, limit: int) -> None:
    ip = get_client_ip(request)
    await rate_limiter.enforce(f"wh:{provider}:{tenant_id}:{ip}", limit, 60, "Rate limit exceeded. Please retry later.")
    # a wide per-company ceiling protects one tenant from a distributed flood
    await rate_limiter.enforce(f"wh:{provider}:{tenant_id}", limit * 20, 60, "Rate limit exceeded. Please retry later.")


async def _read_payload(request: Request) -> Tuple[bytes, Dict[str, Any]]:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.WEBHOOK_MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large.")
    raw = await request.body()
    if len(raw) > settings.WEBHOOK_MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large.")
    content_type = (request.headers.get("content-type") or "").lower()
    try:
        if "application/x-www-form-urlencoded" in content_type:
            data: Any = {k: v[0] if len(v) == 1 else v for k, v in parse_qs(raw.decode("utf-8")).items()}
        else:
            data = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Body must be valid JSON.")
    if not isinstance(data, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Body must be a JSON object.")
    return raw, data


async def _tenant_and_config(tenant_id: str, provider: str) -> Tuple[Tenant, IntegrationConfig]:
    tenant = await get_document_by_id(Tenant, tenant_id)
    cfg = getattr(tenant.integrations, provider, None) if tenant else None
    # one generic answer for unknown company / disabled integration (no tenant enumeration)
    if not tenant or not cfg or not cfg.is_enabled or (tenant.status or "ACTIVE").upper() in INACTIVE_TENANT_STATUSES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook endpoint is not active.")
    return tenant, cfg


def _presented_token(request: Request, path_token: Optional[str], payload: Optional[Dict[str, Any]] = None) -> str:
    auth = request.headers.get("authorization") or ""
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    body_token = ""
    if payload:
        body_token = str(payload.get("token") or payload.get("webhook_token") or "")
    return (path_token or request.headers.get("x-webhook-token") or request.query_params.get("token")
            or bearer or body_token or "").strip()


def _require_token(cfg: IntegrationConfig, presented: str) -> None:
    expected = decrypt_str(cfg.webhook_token)
    if not expected or not constant_time_equals(presented, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized: invalid or missing webhook token.")


def _hmac_valid(secret: Optional[str], raw_body: bytes, signature: Optional[str]) -> bool:
    if not secret or not signature:
        return False
    provided = signature.split("=", 1)[-1].strip().lower()
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)


async def _ingest(provider: str, tenant: Tenant, records) -> Dict[str, Any]:
    adapter = ADAPTERS[provider]
    created = duplicates = rejected = 0
    last_id = None
    for record in list(records)[:MAX_RECORDS_PER_CALL]:
        try:
            lead, is_dup = await process_and_save_lead(adapter.parse_payload(record, str(tenant.id)))
            last_id = str(lead.id)
            duplicates += int(is_dup)
            created += int(not is_dup)
        except ValueError:
            rejected += 1
        except Exception:
            rejected += 1
            logger.exception("Failed to ingest %s lead for tenant %s", provider, tenant.id)
    if not created and not duplicates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No valid lead found in payload (a phone number or e-mail address is required).")
    return {
        "status": "success",
        "message": "New lead created" if created else "Lead updated (duplicate inquiry)",
        "lead_id": last_id,
        "is_duplicate": created == 0,
        "created": created,
        "duplicates": duplicates,
        "rejected": rejected,
    }


async def _token_webhook(provider: str, tenant_id: str, path_token: Optional[str], request: Request) -> Dict[str, Any]:
    await _rate_limit(request, provider, tenant_id, settings.WEBHOOK_RATE_LIMIT_PER_MINUTE)
    tenant, cfg = await _tenant_and_config(tenant_id, provider)
    _require_token(cfg, _presented_token(request, path_token))  # authenticate before touching the body
    _, payload = await _read_payload(request)
    records = extract_indiamart_records(payload) if provider == "indiamart" else [payload]
    return await _ingest(provider, tenant, records)


# ----------------------------------------------------------------- IndiaMART / TradeIndia / Justdial
@router.post("/indiamart/{tenant_id}")
@router.post("/indiamart/{tenant_id}/{token}")
async def indiamart_webhook(tenant_id: str, request: Request, token: Optional[str] = None):
    """IndiaMART Lead Manager Push API listener. Use the URL shown in Settings (it contains the secret token)."""
    # IndiaMART only looks at the HTTP status: 200 = delivered, anything else is retried
    # (and the Push API is switched off by IndiaMART after 48h of continuous failures).
    result = await _token_webhook("indiamart", tenant_id, token, request)
    return {**result, "code": 200}


@router.post("/tradeindia/{tenant_id}")
@router.post("/tradeindia/{tenant_id}/{token}")
async def tradeindia_webhook(tenant_id: str, request: Request, token: Optional[str] = None):
    return await _token_webhook("tradeindia", tenant_id, token, request)


@router.post("/justdial/{tenant_id}")
@router.post("/justdial/{tenant_id}/{token}")
async def justdial_webhook(tenant_id: str, request: Request, token: Optional[str] = None):
    return await _token_webhook("justdial", tenant_id, token, request)


# ----------------------------------------------------------------- Meta Lead Ads
@router.get("/facebook/{tenant_id}")
async def facebook_verify_webhook(
    tenant_id: str, request: Request,
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
):
    """Meta webhook subscription handshake. The verify token is mandatory."""
    await _rate_limit(request, "facebook_verify", tenant_id, 20)
    _, cfg = await _tenant_and_config(tenant_id, "facebook")
    expected = decrypt_str(cfg.verify_token)
    if hub_mode != "subscribe" or not expected or not constant_time_equals(hub_verify_token, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed.")
    return PlainTextResponse((hub_challenge or "")[:200])


@router.post("/facebook/{tenant_id}")
@router.post("/facebook/{tenant_id}/{token}")
async def facebook_webhook(tenant_id: str, request: Request, background_tasks: BackgroundTasks, token: Optional[str] = None):
    await _rate_limit(request, "facebook", tenant_id, settings.WEBHOOK_RATE_LIMIT_PER_MINUTE)
    tenant, cfg = await _tenant_and_config(tenant_id, "facebook")
    raw, payload = await _read_payload(request)

    signature = request.headers.get("x-hub-signature-256")
    if signature:
        # genuine Meta delivery: must be signed with the App Secret
        if not _hmac_valid(decrypt_str(cfg.secret_key), raw, signature):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.")
        events = extract_leadgen_events(payload)
        page_token = decrypt_str(cfg.api_key)
        for event in events[:MAX_RECORDS_PER_CALL]:
            background_tasks.add_task(process_meta_leadgen, str(tenant.id), page_token, event)
        return {"status": "success", "received": len(events)}

    # relayed payloads (Zapier / Make / custom connector) authenticate with the company token
    _require_token(cfg, _presented_token(request, token))
    return await _ingest("facebook", tenant, [payload])


# ----------------------------------------------------------------- Website forms
def _origin_allowed(request: Request, cfg: IntegrationConfig) -> bool:
    allowed = [d.lower() for d in (cfg.allowed_domains or []) if d]
    if not allowed:
        return True
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    host = urlparse(origin).netloc.lower().split(":")[0]
    if not host:
        return False
    if not settings.is_production and host in ("localhost", "127.0.0.1"):
        return True
    return any(host == d or host.endswith("." + d) for d in allowed)


def _bot_response() -> Dict[str, Any]:
    # deliberately indistinguishable from a real success so bots do not adapt
    return {"status": "success", "message": "New lead captured from website", "lead_id": secrets.token_hex(12),
            "is_duplicate": False, "created": 1, "duplicates": 0, "rejected": 0}


@router.post("/website/{tenant_id}")
@router.post("/website/{tenant_id}/{token}")
async def website_form_capture(tenant_id: str, request: Request, token: Optional[str] = None):
    """
    Website / landing-page lead capture.
      1. Server-to-server: 'X-Webhook-Signature: sha256=<hmac of body>' or 'Authorization: Bearer <secret key>'
      2. Browser form: public token + allowed-domain check + honeypot + submission-speed trap
    """
    await _rate_limit(request, "website", tenant_id, settings.WEBSITE_FORM_RATE_LIMIT_PER_MINUTE)
    tenant, cfg = await _tenant_and_config(tenant_id, "website")
    raw, payload = await _read_payload(request)

    secret = decrypt_str(cfg.secret_key)
    signature = (request.headers.get("x-webhook-signature") or request.headers.get("x-signature")
                 or request.headers.get("x-hub-signature-256"))
    presented = _presented_token(request, token, payload)

    if signature:
        if not _hmac_valid(secret, raw, signature):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized: webhook signature mismatch.")
        trusted_backend = True
    elif secret and constant_time_equals(presented, secret):
        trusted_backend = True
    else:
        _require_token(cfg, presented)
        if not _origin_allowed(request, cfg):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="This website is not authorised to submit leads. Add the domain under Allowed Domains.")
        trusted_backend = False

    if not trusted_backend:
        if any(str(payload.get(field) or "").strip() for field in HONEYPOT_FIELDS):
            return _bot_response()
        render_time = payload.get("_render_time") or payload.get("_timestamp") or payload.get("_form_loaded_at")
        if render_time is not None:
            try:
                rendered = float(render_time)
                if rendered > 1e11:
                    rendered /= 1000.0
                if -1.0 <= time.time() - rendered < 2.0:
                    return _bot_response()
            except (TypeError, ValueError):
                pass

    phone_digits = "".join(c for c in str(payload.get("phone") or payload.get("mobile") or payload.get("contact_number") or "") if c.isdigit())
    email = str(payload.get("email") or "").strip()
    if not phone_digits and not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="A valid contact phone number or email address is required.")
    if phone_digits and (phone_digits[-10:] in FAKE_PHONE_PATTERNS or len(phone_digits) < 7):
        if not email:
            return {"status": "ignored", "message": "Invalid contact number ignored", "is_duplicate": False}
        payload = {k: v for k, v in payload.items() if k not in ("phone", "mobile", "contact_number")}

    result = await _ingest("website", tenant, [payload])
    result["message"] = "Lead updated (duplicate inquiry)" if result["is_duplicate"] else "New lead captured from website"
    return result

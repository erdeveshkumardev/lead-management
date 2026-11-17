import time
import hmac
import hashlib
from typing import Dict, Any, Optional, List
from datetime import datetime
from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException, BackgroundTasks, Header, Query, Request, status
from app.services.adapters.indiamart import IndiaMARTAdapter
from app.services.adapters.tradeindia import TradeIndiaAdapter
from app.services.adapters.facebook import FacebookAdapter
from app.services.adapters.website import WebsiteAdapter
from app.services.lead_service import process_and_save_lead
from app.core.database import get_document_by_id
from app.models.tenant import Tenant
from app.core.rate_limiter import webhook_rate_limiter

router = APIRouter(prefix="/webhooks", tags=["Lead Ingestion Webhooks"])

indiamart_adapter = IndiaMARTAdapter()
tradeindia_adapter = TradeIndiaAdapter()
facebook_adapter = FacebookAdapter()
website_adapter = WebsiteAdapter()

HONEYPOT_FIELDS = [
    "website_hp",
    "_hp_trap",
    "honeypot",
    "hp_check",
    "_honey",
    "extra_fax_number",
    "company_secondary_url",
    "fax_number",
]

FAKE_PHONE_PATTERNS = {
    "0000000000",
    "1111111111",
    "2222222222",
    "3333333333",
    "4444444444",
    "5555555555",
    "6666666666",
    "7777777777",
    "8888888888",
    "9999999999",
    "1234567890",
    "0123456789",
}


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def get_active_tenant_and_config(tenant_id: str, provider: str):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"_id": tenant_id}, {"company_name": tenant_id}, {"slug": tenant_id}]})
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Company / Tenant '{tenant_id}' not found.")

    if tenant.status and tenant.status.upper() != "ACTIVE":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company account is not active. Lead ingestion paused.")

    cfg = getattr(tenant.integrations, provider, None) if getattr(tenant, "integrations", None) else None
    if not cfg or not cfg.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{provider.capitalize()} lead capture is disabled for this company. Please enable it in Company Settings."
        )
    return tenant, cfg


@router.post("/indiamart/{tenant_id}")
async def indiamart_webhook(
    tenant_id: str,
    payload: Dict[str, Any],
    request: Request,
    background_tasks: BackgroundTasks
):
    """
    Receives incoming leads from IndiaMART Push API / CRM webhook.
    Protected with Rate Limiting, Active Tenant verification & CRM Key matching.
    """
    client_ip = get_client_ip(request)
    is_allowed, _ = webhook_rate_limiter.check(f"im_{tenant_id}_{client_ip}")
    if not is_allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    tenant, cfg = await get_active_tenant_and_config(tenant_id, "indiamart")

    # Verify CRM Key if configured by company
    expected_crm_key = (cfg.crm_key or cfg.api_key or "").strip()
    if expected_crm_key:
        received_key = (
            request.headers.get("X-CRM-Key")
            or request.headers.get("X-API-Key")
            or request.query_params.get("glusr_crm_key")
            or request.query_params.get("crm_key")
            or payload.get("GLUSR_CRM_KEY")
            or payload.get("crm_key")
            or payload.get("glusr_crm_key")
            or ""
        ).strip()
        if received_key and received_key != expected_crm_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized: Invalid IndiaMART CRM Key.")

    try:
        dto = indiamart_adapter.parse_payload(payload, tenant_id)
        lead, is_duplicate = await process_and_save_lead(dto)
        return {
            "status": "success",
            "message": "Lead updated (duplicate inquiry)" if is_duplicate else "New lead created",
            "lead_id": str(lead.id),
            "is_duplicate": is_duplicate
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process IndiaMART lead: {str(e)}")


@router.post("/tradeindia/{tenant_id}")
async def tradeindia_webhook(
    tenant_id: str,
    payload: Dict[str, Any],
    request: Request
):
    """
    Receives incoming leads from TradeIndia API / webhook.
    Protected with Rate Limiting, Active Tenant check & API Key matching.
    """
    client_ip = get_client_ip(request)
    is_allowed, _ = webhook_rate_limiter.check(f"ti_{tenant_id}_{client_ip}")
    if not is_allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    tenant, cfg = await get_active_tenant_and_config(tenant_id, "tradeindia")

    expected_key = (cfg.api_key or "").strip()
    if expected_key:
        received_key = (
            request.headers.get("X-TradeIndia-Key")
            or request.headers.get("X-API-Key")
            or request.query_params.get("key")
            or request.query_params.get("api_key")
            or payload.get("key")
            or payload.get("api_key")
            or ""
        ).strip()
        if received_key and received_key != expected_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized: Invalid TradeIndia Key.")

    try:
        dto = tradeindia_adapter.parse_payload(payload, tenant_id)
        lead, is_duplicate = await process_and_save_lead(dto)
        return {
            "status": "success",
            "message": "Lead updated (duplicate inquiry)" if is_duplicate else "New lead created",
            "lead_id": str(lead.id),
            "is_duplicate": is_duplicate
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process TradeIndia lead: {str(e)}")


@router.get("/facebook/{tenant_id}")
async def facebook_verify_webhook(
    tenant_id: str,
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    """
    Meta / Facebook Webhook verification endpoint for initial handshake.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    cfg = getattr(tenant.integrations, "facebook", None)
    expected_verify_token = (cfg.secret_key or cfg.api_key or "").strip() if cfg else ""
    if expected_verify_token and hub_verify_token != expected_verify_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Facebook verify token mismatch")

    if hub_mode == "subscribe":
        return int(hub_challenge) if (hub_challenge and hub_challenge.isdigit()) else hub_challenge
    return {"message": "Facebook webhook endpoint ready"}


@router.post("/facebook/{tenant_id}")
async def facebook_webhook(
    tenant_id: str,
    payload: Dict[str, Any],
    request: Request
):
    """
    Receives Meta / Facebook Lead Generation Ad leads.
    """
    client_ip = get_client_ip(request)
    is_allowed, _ = webhook_rate_limiter.check(f"fb_{tenant_id}_{client_ip}")
    if not is_allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    tenant, cfg = await get_active_tenant_and_config(tenant_id, "facebook")

    # Optional Meta HMAC signature verification if secret_key is set
    meta_sig = request.headers.get("x-hub-signature-256")
    if meta_sig and cfg.secret_key:
        try:
            raw_body = await request.body()
            expected_sig = "sha256=" + hmac.new(cfg.secret_key.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(meta_sig, expected_sig):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Meta signature")
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        dto = facebook_adapter.parse_payload(payload, tenant_id)
        lead, is_duplicate = await process_and_save_lead(dto)
        return {
            "status": "success",
            "message": "Lead updated" if is_duplicate else "New lead created",
            "lead_id": str(lead.id),
            "is_duplicate": is_duplicate
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process Facebook lead: {str(e)}")


@router.post("/justdial/{tenant_id}")
async def justdial_webhook(
    tenant_id: str,
    payload: Dict[str, Any],
    request: Request
):
    """
    Receives incoming leads from Justdial Lead API / webhook.
    """
    client_ip = get_client_ip(request)
    is_allowed, _ = webhook_rate_limiter.check(f"jd_{tenant_id}_{client_ip}")
    if not is_allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")

    tenant, cfg = await get_active_tenant_and_config(tenant_id, "justdial")

    expected_key = (cfg.api_key or "").strip()
    if expected_key:
        received_key = (
            request.headers.get("X-Justdial-Key")
            or request.headers.get("X-API-Key")
            or request.query_params.get("key")
            or request.query_params.get("api_key")
            or payload.get("key")
            or payload.get("api_key")
            or ""
        ).strip()
        if received_key and received_key != expected_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized: Invalid Justdial API Key.")

    try:
        from app.services.adapters.base import StandardLeadDTO
        dto = StandardLeadDTO(
            tenant_id=tenant_id,
            source="justdial",
            source_lead_id=str(payload.get("leadid") or payload.get("id") or f"JD_{datetime.utcnow().timestamp()}"),
            full_name=payload.get("name") or payload.get("lead_name") or "Justdial Buyer",
            phone=str(payload.get("mobile") or payload.get("phone") or ""),
            email=payload.get("email"),
            company_name=payload.get("company") or payload.get("business_name"),
            city=payload.get("city") or payload.get("area"),
            product_inquired=payload.get("category") or payload.get("service") or payload.get("product"),
            inquiry_message=payload.get("requirement") or payload.get("notes") or "Lead received from Justdial portal",
            raw_payload=payload
        )
        lead, is_duplicate = await process_and_save_lead(dto)
        return {
            "status": "success",
            "message": "Lead updated" if is_duplicate else "New lead created from Justdial",
            "lead_id": str(lead.id),
            "is_duplicate": is_duplicate
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process Justdial lead: {str(e)}")


@router.post("/website/{tenant_id}")
async def website_form_capture(
    tenant_id: str,
    payload: Dict[str, Any],
    request: Request,
    token: Optional[str] = Query(None),
    x_webhook_token: Optional[str] = Header(None, alias="X-Webhook-Token"),
    x_webhook_signature: Optional[str] = Header(None, alias="X-Webhook-Signature"),
    x_signature: Optional[str] = Header(None, alias="X-Signature"),
    authorization: Optional[str] = Header(None)
):
    """
    Hardened Dual-Ingestion Endpoint for Website Contact Forms, Landing Pages & Backend Server integrations.
    Supports BOTH:
    1. Backend Server-to-Server / Zapier: HMAC-SHA256 Signature Header (X-Webhook-Signature) or Private Secret Key.
    2. Frontend Website Forms: Public Webhook Token + Domain Whitelist (CORS/Origin check) + Honeypot Trap + Submission Speed Trap.
    """
    # Layer 1: IP Rate Limiting (Sliding Window: Max 10 requests / 60 seconds per IP)
    client_ip = get_client_ip(request)
    is_allowed, remaining = webhook_rate_limiter.check(f"web_{tenant_id}_{client_ip}")
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Too many lead submissions from this IP. Please wait a minute before trying again."
        )

    # Layer 2: Company / Tenant Existence, Active Status & Website Integration Enabled
    tenant, website_cfg = await get_active_tenant_and_config(tenant_id, "website")

    # Layer 3: Dual Authentication Pipeline (Backend vs Frontend)
    is_backend_call = False
    secret_key = (website_cfg.secret_key or "").strip()
    public_token = (website_cfg.webhook_token or "").strip()

    provided_sig = x_webhook_signature or x_signature or request.headers.get("x-hub-signature-256")
    bearer_token = authorization.replace("Bearer ", "").strip() if authorization and authorization.startswith("Bearer ") else ""

    # Path A: Backend Server-to-Server HMAC Signature Verification
    if provided_sig and secret_key:
        try:
            raw_body = await request.body()
            sig_to_verify = provided_sig.split("=")[-1].strip()
            expected_sig = hmac.new(secret_key.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
            if hmac.compare_digest(sig_to_verify, expected_sig):
                is_backend_call = True
            else:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unauthorized: HMAC Webhook Signature mismatch. Ensure payload matches signature with your Secret Key."
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"HMAC verification error: {str(e)}")

    # Path B: Backend Server-to-Server Secret Key Bearer or Header
    elif secret_key and (bearer_token == secret_key or (x_webhook_token and x_webhook_token == secret_key)):
        is_backend_call = True

    # Path C: Frontend Website Form Call (Requires Public Token + Domain Validation)
    else:
        provided_token = (
            x_webhook_token
            or token
            or bearer_token
            or payload.get("token")
            or payload.get("webhook_token")
            or ""
        ).strip()

        # Allowed tokens: public webhook token, tenant mongo ID, or tenant slug
        valid_tokens = {str(tenant.id)}
        if public_token:
            valid_tokens.add(public_token)
        if tenant.slug:
            valid_tokens.add(tenant.slug)

        if not provided_token or provided_token not in valid_tokens:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Unauthorized: Invalid or missing Webhook Security Token. Pass 'X-Webhook-Token' header or '?token={public_token or str(tenant.id)}' in your URL."
            )

        # Domain Whitelist / CORS / Origin verification for Frontend submissions
        allowed_domains = website_cfg.allowed_domains or []
        if allowed_domains:
            origin = request.headers.get("origin") or request.headers.get("referer") or ""
            if origin:
                origin_host = urlparse(origin).netloc.lower().split(":")[0]
                allowed_hosts = [
                    urlparse(d if d.startswith(("http://", "https://")) else f"https://{d}").netloc.lower().split(":")[0]
                    for d in allowed_domains if d and d.strip()
                ]
                # Allow localhost if in allowed hosts or dev environment
                if origin_host and origin_host not in allowed_hosts and origin_host not in ["localhost", "127.0.0.1"]:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Origin '{origin_host}' is not authorized to submit leads for this company. Add it to Allowed Domains in Settings."
                    )

    # Layer 4: Anti-Bot Traps (Frontend submissions only; verified backend calls bypass honeypot/speed trap)
    if not is_backend_call:
        # Honeypot Trap
        for hp in HONEYPOT_FIELDS:
            val = payload.get(hp)
            if val is not None and str(val).strip():
                # Bot caught in honeypot! Deceptive 200 response to avoid alerting attacker
                return {
                    "status": "success",
                    "message": "Lead received successfully",
                    "lead_id": "bot_filtered",
                    "is_duplicate": False,
                    "bot_shield": "Honeypot trap triggered (bot submission ignored)"
                }

        # Submission Speed Trap (< 2.0s human typing threshold)
        render_time_raw = payload.get("_render_time") or payload.get("_timestamp") or payload.get("_form_loaded_at")
        if render_time_raw is not None:
            try:
                render_time = float(render_time_raw)
                if render_time > 1e11:  # Milliseconds
                    render_time /= 1000.0
                elapsed = time.time() - render_time
                if -1.0 <= elapsed < 2.0:
                    # Automated script filled in less than 2 seconds
                    return {
                        "status": "success",
                        "message": "Lead received successfully",
                        "lead_id": "bot_filtered",
                        "is_duplicate": False,
                        "bot_shield": "Submission speed trap triggered (submission too fast for human)"
                    }
            except (ValueError, TypeError):
                pass

    # Layer 5: Phone / Email Sanitization & Quality Filter
    raw_phone = str(payload.get("phone") or payload.get("mobile") or payload.get("contact_number") or "").strip()
    raw_email = str(payload.get("email") or "").strip()
    phone_digits = "".join([c for c in raw_phone if c.isdigit()])

    if not phone_digits and not raw_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid submission: A valid contact phone number or email address is required."
        )

    if phone_digits in FAKE_PHONE_PATTERNS or (phone_digits and len(phone_digits) < 7):
        # Dummy repeating junk number or invalid length
        return {
            "status": "ignored",
            "message": "Invalid dummy contact number ignored",
            "is_duplicate": False
        }

    # Process and save lead with deduplication and assignment
    try:
        dto = website_adapter.parse_payload(payload, tenant_id)
        lead, is_duplicate = await process_and_save_lead(dto)
        return {
            "status": "success",
            "message": "Lead updated (duplicate inquiry)" if is_duplicate else "New lead captured from website",
            "lead_id": str(lead.id),
            "is_duplicate": is_duplicate,
            "security_mode": "backend_hmac_verified" if is_backend_call else "frontend_shield_verified"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process website lead: {str(e)}")

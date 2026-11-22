"""
Company communication gateways (SMS / WhatsApp / e-mail).

Only administrators with 'settings_manage' can read or change them. Credentials are encrypted at rest,
returned masked, and custom gateway destinations are checked against SSRF before they are saved or used.
"""
import re
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import rate_limiter
from app.core.audit import audit
from app.core.crypto import encrypt_str, looks_masked, mask_secret
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, require_permission, resolve_tenant_id
from app.core.net import UnsafeDestination, validate_public_url, validate_smtp_host
from app.core.timeutil import local_now
from app.core.validators import clean_text
from app.models.tenant import COMMUNICATION_SECRET_FIELDS, Tenant
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/settings/communication", tags=["Communication Settings (SMS / WhatsApp / Email)"])

ALLOWED_VALUES = {
    ("sms", "provider"): {"fast2sms", "custom_http"},
    ("whatsapp", "provider"): {"cloud_api", "twilio", "custom_webhook"},
    ("email", "mode"): {"smtp", "api"},
    ("email", "api_provider"): {"sendgrid", "resend"},
}
# field -> maximum length for plain text settings
TEXT_FIELDS = {
    "sms": {"provider": 30, "sender_id": 20, "route": 20, "template_id": 60, "custom_url": 500},
    "whatsapp": {"provider": 30, "phone_number_id": 40, "waba_id": 40, "account_sid": 64, "from_phone_number": 30,
                 "custom_webhook_url": 500, "pending_followup_template": 1000},
    "email": {"mode": 10, "smtp_host": 253, "smtp_user": 254, "from_name": 100, "from_email": 254, "api_provider": 30},
}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UpdateCommunicationSettingsRequest(BaseModel):
    sms: Optional[Dict[str, Any]] = None
    whatsapp: Optional[Dict[str, Any]] = None
    email: Optional[Dict[str, Any]] = None


class TestCommunicationRequest(BaseModel):
    channel: str = Field(pattern=r"^(email|whatsapp|sms)$")
    recipient: str = Field(min_length=5, max_length=254)
    message: Optional[str] = Field(default=None, max_length=500)


async def _tenant(ctx: AuthContext, tenant_id: Optional[str]) -> Tenant:
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant


def _view(tenant: Tenant) -> Dict[str, Any]:
    comm = tenant.communication_settings
    out: Dict[str, Any] = {"tenant_id": str(tenant.id), "company_name": tenant.company_name}
    for channel in ("sms", "whatsapp", "email"):
        cfg = getattr(comm, channel)
        data = cfg.model_dump()
        for field in COMMUNICATION_SECRET_FIELDS[channel]:
            data[f"has_{field}"] = bool(data.get(field))
            data[field] = mask_secret(data.get(field)) or None
        out[channel] = data
    return out


async def _apply(channel: str, cfg: Any, updates: Dict[str, Any]) -> None:
    secrets_ = COMMUNICATION_SECRET_FIELDS[channel]
    for key, value in updates.items():
        if key in secrets_:
            if value is None or looks_masked(value):
                continue  # unchanged
            text = str(value).strip()
            if len(text) > 2000:
                raise HTTPException(status_code=400, detail=f"{channel}.{key} is too long.")
            setattr(cfg, key, encrypt_str(text) if text else None)
        elif key in TEXT_FIELDS[channel]:
            text = clean_text(value, TEXT_FIELDS[channel][key])
            allowed = ALLOWED_VALUES.get((channel, key))
            if allowed and text not in allowed:
                raise HTTPException(status_code=400, detail=f"{channel}.{key} must be one of: {', '.join(sorted(allowed))}.")
            setattr(cfg, key, text)
        elif key in ("is_enabled", "smtp_use_tls"):
            setattr(cfg, key, bool(value))
        elif key == "smtp_port":
            try:
                cfg.smtp_port = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="SMTP port must be a number.")
        # anything else (status, unknown keys) is ignored: status is derived on the server

    try:
        if channel == "sms" and cfg.custom_url:
            await validate_public_url(cfg.custom_url.replace("{API_KEY}", "k").replace("{TO}", "1").replace("{MESSAGE}", "m"))
        if channel == "whatsapp" and cfg.custom_webhook_url:
            await validate_public_url(cfg.custom_webhook_url)
        if channel == "email" and cfg.is_enabled and cfg.mode == "smtp" and cfg.smtp_host:
            await validate_smtp_host(cfg.smtp_host, int(cfg.smtp_port or 587))
    except UnsafeDestination as exc:
        raise HTTPException(status_code=400, detail=f"{channel.upper()} gateway address was rejected: {exc}")

    if channel == "email":
        if cfg.from_email and not _EMAIL_RE.match(cfg.from_email):
            raise HTTPException(status_code=400, detail="'From' e-mail address is not valid.")
        if cfg.is_enabled and cfg.mode == "smtp" and int(cfg.smtp_port or 587) != 465 and not cfg.smtp_use_tls:
            raise HTTPException(status_code=400, detail="TLS must stay enabled for SMTP (credentials are never sent in clear text).")
    cfg.status = "Configured" if cfg.is_enabled else "Disabled"


@router.get("")
async def get_communication_settings(tenant_id: Optional[str] = None,
                                     ctx: AuthContext = Depends(require_permission("settings_manage"))):
    return _view(await _tenant(ctx, tenant_id))


@router.put("")
async def update_communication_settings(payload: UpdateCommunicationSettingsRequest, tenant_id: Optional[str] = None,
                                        ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tenant = await _tenant(ctx, tenant_id)
    comm = tenant.communication_settings
    changed = []
    for channel in ("sms", "whatsapp", "email"):
        updates = getattr(payload, channel)
        if updates:
            await _apply(channel, getattr(comm, channel), updates)
            changed.append(channel)
    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    await audit("tenant.communication_settings_updated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant",
                entity_id=str(tenant.id), details={"channels": ", ".join(changed)})
    return {"status": "success", "message": "Communication API settings updated successfully",
            "tenant_id": str(tenant.id), "settings": _view(tenant)}


@router.post("/test")
async def test_communication_channel(payload: TestCommunicationRequest, tenant_id: Optional[str] = None,
                                     ctx: AuthContext = Depends(require_permission("settings_manage"))):
    """Sends one test message through the company gateway (rate limited so it cannot be used as a relay)."""
    tenant = await _tenant(ctx, tenant_id)
    await rate_limiter.enforce(f"commtest:{tenant.id}", 5, 300, "Too many test messages. Please wait a few minutes.")
    recipient = payload.recipient.strip()
    text = clean_text(payload.message, 500) or (
        f"Test message from {tenant.company_name} at {local_now().strftime('%d-%m-%Y %H:%M')}.")

    if payload.channel == "email":
        if not _EMAIL_RE.match(recipient):
            raise HTTPException(status_code=400, detail="Recipient must be a valid e-mail address.")
        result = await NotificationService.send_email(tenant, recipient, f"Test e-mail - {tenant.company_name}", text)
    elif payload.channel == "whatsapp":
        result = await NotificationService.send_whatsapp(tenant, recipient, f"*Test WhatsApp message*\n\n{text}")
    else:
        result = await NotificationService.send_sms(tenant, recipient, text)

    await audit("tenant.communication_test", ctx=ctx, tenant_id=str(tenant.id),
                status="success" if result.get("status") in ("success", "simulated") else "failure",
                details={"channel": payload.channel, "result": result.get("status")})
    return result

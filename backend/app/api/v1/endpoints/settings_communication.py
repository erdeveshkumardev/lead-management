from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.models.tenant import Tenant, SmsConfig, WhatsAppConfig, EmailConfig, TenantCommunicationSettings
from app.core.database import get_document_by_id
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/settings/communication", tags=["Communication Settings (SMS / WhatsApp / Email)"])


class TestCommunicationRequest(BaseModel):
    channel: str  # "email", "whatsapp", "sms"
    recipient: str  # email address or phone number
    message: Optional[str] = None


def _mask_secret(val: Optional[str]) -> Optional[str]:
    if not val:
        return val
    if len(val) <= 6:
        return "••••••"
    return f"{val[:3]}••••{val[-3:]}"


@router.get("")
async def get_communication_settings(tenant_id: str):
    """
    Get company's SMS, WhatsApp, and Email API settings.
    Sensitive tokens are masked for UI display.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
    if not tenant:
        raise HTTPException(status_code=404, detail="Company tenant not found")

    comm = getattr(tenant, "communication_settings", None)
    if not comm:
        comm = TenantCommunicationSettings()
        tenant.communication_settings = comm
        await tenant.save()

    return {
        "tenant_id": str(tenant.id),
        "company_name": tenant.company_name,
        "sms": {
            "is_enabled": comm.sms.is_enabled,
            "provider": comm.sms.provider,
            "api_key": _mask_secret(comm.sms.api_key),
            "sender_id": comm.sms.sender_id,
            "route": comm.sms.route,
            "template_id": comm.sms.template_id,
            "custom_url": comm.sms.custom_url,
            "status": comm.sms.status
        },
        "whatsapp": {
            "is_enabled": comm.whatsapp.is_enabled,
            "provider": comm.whatsapp.provider,
            "phone_number_id": comm.whatsapp.phone_number_id,
            "waba_id": comm.whatsapp.waba_id,
            "access_token": _mask_secret(comm.whatsapp.access_token),
            "account_sid": comm.whatsapp.account_sid,
            "auth_token": _mask_secret(comm.whatsapp.auth_token),
            "from_phone_number": comm.whatsapp.from_phone_number,
            "custom_webhook_url": comm.whatsapp.custom_webhook_url,
            "pending_followup_template": comm.whatsapp.pending_followup_template,
            "status": comm.whatsapp.status
        },
        "email": {
            "is_enabled": comm.email.is_enabled,
            "mode": comm.email.mode,
            "smtp_host": comm.email.smtp_host,
            "smtp_port": comm.email.smtp_port,
            "smtp_user": comm.email.smtp_user,
            "smtp_password": _mask_secret(comm.email.smtp_password),
            "smtp_use_tls": comm.email.smtp_use_tls,
            "from_name": comm.email.from_name,
            "from_email": comm.email.from_email,
            "api_provider": comm.email.api_provider,
            "api_key": _mask_secret(comm.email.api_key),
            "status": comm.email.status
        }
    }


class UpdateCommunicationSettingsRequest(BaseModel):
    sms: Optional[Dict[str, Any]] = None
    whatsapp: Optional[Dict[str, Any]] = None
    email: Optional[Dict[str, Any]] = None


@router.put("")
async def update_communication_settings(tenant_id: str, payload: UpdateCommunicationSettingsRequest):
    """
    Update company's SMS, WhatsApp, and Email API settings.
    If a masked value (containing '••') is submitted, the previous secret is preserved.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
    if not tenant:
        raise HTTPException(status_code=404, detail="Company tenant not found")

    if not hasattr(tenant, "communication_settings") or not tenant.communication_settings:
        tenant.communication_settings = TenantCommunicationSettings()

    comm = tenant.communication_settings

    # 1. SMS
    if payload.sms:
        for k, v in payload.sms.items():
            if k == "api_key" and v and "••" in v:
                continue  # Preserve existing
            if hasattr(comm.sms, k) and v is not None:
                setattr(comm.sms, k, v)
        comm.sms.status = "Configured" if comm.sms.is_enabled else "Disabled"

    # 2. WhatsApp
    if payload.whatsapp:
        for k, v in payload.whatsapp.items():
            if k in ["access_token", "auth_token"] and v and "••" in v:
                continue  # Preserve existing
            if hasattr(comm.whatsapp, k) and v is not None:
                setattr(comm.whatsapp, k, v)
        comm.whatsapp.status = "Configured" if comm.whatsapp.is_enabled else "Disabled"

    # 3. Email
    if payload.email:
        for k, v in payload.email.items():
            if k in ["smtp_password", "api_key"] and v and "••" in v:
                continue  # Preserve existing
            if hasattr(comm.email, k) and v is not None:
                setattr(comm.email, k, v)
        comm.email.status = "Configured" if comm.email.is_enabled else "Disabled"

    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": "Communication API settings updated successfully",
        "tenant_id": str(tenant.id)
    }


@router.post("/test")
async def test_communication_channel(tenant_id: str, payload: TestCommunicationRequest):
    """
    Test send an Email, WhatsApp, or SMS message to verify credentials and connectivity.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
    if not tenant:
        raise HTTPException(status_code=404, detail="Company tenant not found")

    msg = payload.message or f"Test message from {tenant.company_name} LeadCRM at {datetime.now().strftime('%d-%m-%Y %H:%M:%S')}."

    if payload.channel == "email":
        res = await NotificationService.send_email(
            tenant=tenant,
            to_email=payload.recipient,
            subject=f"✅ Test Email - {tenant.company_name} LeadCRM",
            body_text=msg,
            body_html=f"<div style='font-family: Arial; padding: 20px; border: 1px solid #cbd5e1; border-radius: 8px;'><h2 style='color: #4f46e5;'>{tenant.company_name}</h2><p>{msg}</p><p style='color: #64748b; font-size: 12px;'>Your LeadCRM email settings are working properly.</p></div>"
        )
        return res

    elif payload.channel == "whatsapp":
        res = await NotificationService.send_whatsapp(
            tenant=tenant,
            to_phone=payload.recipient,
            message=f"✅ *Test WhatsApp Message*\n\n{msg}\n\n_{tenant.company_name} LeadCRM_"
        )
        return res

    elif payload.channel == "sms":
        res = await NotificationService.send_sms(
            tenant=tenant,
            to_phone=payload.recipient,
            message=msg
        )
        return res

    else:
        raise HTTPException(status_code=400, detail="Invalid channel. Must be 'email', 'whatsapp', or 'sms'.")

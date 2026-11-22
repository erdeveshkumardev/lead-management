import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.core import rate_limiter
from app.core.audit import audit
from app.core.crypto import decrypt_str, encrypt_str, looks_masked, mask_secret
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_current_user, invalidate_tenant_cache, require_permission, resolve_tenant_id
from app.core.gst import IFSC_RE, PAN_RE, PINCODE_RE, gstin_error, normalize_gstin, resolve_state_code, state_name
from app.core.security import verify_password
from app.core.validators import clean_text, safe_key
from app.models.custom_field import CustomFieldDefinition
from app.models.lead import Lead
from app.models.tenant import (
    BankDetails, IntegrationConfig, PipelineStage, Tenant, generate_secret_key, generate_verify_token,
    generate_webhook_token, get_default_pipeline_stages,
)
from app.services.integration_service import sync_indiamart_for_tenant

router = APIRouter(prefix="/tenants", tags=["Company Configuration"])

PROVIDERS = ("indiamart", "facebook", "tradeindia", "justdial", "website")
MASKED_FIELDS = ("api_key", "crm_key", "secret_key")
STAGE_COLORS = {"blue", "amber", "indigo", "purple", "orange", "emerald", "rose", "slate", "cyan", "teal", "red", "green", "yellow", "pink"}
FIELD_TYPES = {"text", "number", "select", "date", "boolean"}
_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UpdatePipelineStagesRequest(BaseModel):
    stages: List[PipelineStage] = Field(min_length=2, max_length=20)


class UpdateTenantProfileRequest(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=200)
    company_type: Optional[str] = Field(default=None, max_length=40)
    gstin: Optional[str] = Field(default=None, max_length=20)
    pan_number: Optional[str] = Field(default=None, max_length=12)
    state_code: Optional[str] = Field(default=None, max_length=2)
    state_name: Optional[str] = Field(default=None, max_length=60)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=100)
    pincode: Optional[str] = Field(default=None, max_length=10)
    bank_details: Optional[BankDetails] = None
    default_invoice_terms: Optional[str] = Field(default=None, max_length=2000)


class UpdateIntegrationsRequest(BaseModel):
    integrations: Dict[str, Dict[str, Any]]


class RevealSecretsRequest(BaseModel):
    provider: str
    password: str = Field(min_length=1, max_length=128)


class CustomFieldCreateRequest(BaseModel):
    entity_type: str = "lead"
    field_key: str = Field(min_length=1, max_length=64)
    field_label: str = Field(min_length=1, max_length=100)
    field_type: str = "text"
    options: List[str] = Field(default_factory=list, max_length=50)
    is_required: bool = False


async def _get_tenant(ctx: AuthContext, tenant_id: str) -> Tenant:
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant


def serialize_tenant(tenant: Tenant) -> Dict[str, Any]:
    """Company profile without integration credentials."""
    data = tenant.model_dump(mode="json", exclude={"integrations", "revision_id", "id"})
    data["_id"] = data["id"] = str(tenant.id)
    return data


def _ensure_tokens(tenant: Tenant) -> bool:
    """Every provider gets its own inbound webhook token; secrets are stored encrypted."""
    changed = False
    for provider in PROVIDERS:
        cfg: IntegrationConfig = getattr(tenant.integrations, provider)
        if not cfg.webhook_token:
            cfg.webhook_token = encrypt_str(generate_webhook_token())
            changed = True
    if not tenant.integrations.website.secret_key:
        tenant.integrations.website.secret_key = encrypt_str(generate_secret_key())
        changed = True
    if not tenant.integrations.facebook.verify_token:
        tenant.integrations.facebook.verify_token = encrypt_str(generate_verify_token())
        changed = True
    return changed


def _status_for(provider: str, cfg: IntegrationConfig) -> str:
    if not cfg.is_enabled:
        return "Disabled"
    if provider == "facebook":
        return "Connected" if (cfg.api_key and cfg.secret_key) else "Action Required"
    if provider == "indiamart" and cfg.status == "Error":
        return "Error"
    return "Connected"


def serialize_integrations(tenant: Tenant, include_tokens: bool = True) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    tid = str(tenant.id)
    for provider in PROVIDERS:
        cfg: IntegrationConfig = getattr(tenant.integrations, provider)
        token = decrypt_str(cfg.webhook_token) if include_tokens else None
        item: Dict[str, Any] = {
            "is_enabled": cfg.is_enabled,
            "account_id": cfg.account_id,
            "allowed_domains": cfg.allowed_domains,
            "auto_sync": cfg.auto_sync,
            "last_sync_at": cfg.last_sync_at,
            "last_sync_status": cfg.last_sync_status,
            "status": _status_for(provider, cfg),
        }
        for field in MASKED_FIELDS:
            item[field] = mask_secret(getattr(cfg, field))
            item[f"has_{field}"] = bool(getattr(cfg, field))
        if include_tokens:
            item["webhook_token"] = token
            item["webhook_path"] = f"/webhooks/{provider}/{tid}/{token}" if token else None
            if provider == "facebook":
                item["verify_token"] = decrypt_str(cfg.verify_token)
                item["webhook_path"] = f"/webhooks/facebook/{tid}"
        out[provider] = item
    return out


def _clean_domains(values: Any) -> List[str]:
    if not isinstance(values, list):
        raise HTTPException(status_code=400, detail="allowed_domains must be a list.")
    cleaned: List[str] = []
    for raw in values[:20]:
        text = str(raw or "").strip().lower()
        if not text:
            continue
        host = urlparse(text if "://" in text else f"https://{text}").netloc.split(":")[0]
        if not _DOMAIN_RE.match(host):
            raise HTTPException(status_code=400, detail=f"'{raw}' is not a valid domain.")
        if host not in cleaned:
            cleaned.append(host)
    return cleaned


@router.get("/{tenant_id}")
async def get_tenant(tenant_id: str, ctx: AuthContext = Depends(get_current_user)):
    tenant = await _get_tenant(ctx, tenant_id)
    data = serialize_tenant(tenant)
    if not ctx.has("settings_manage"):
        data.pop("bank_details", None)
        data.pop("company_admin_email", None)
    return data


@router.get("/{tenant_id}/stages")
async def get_pipeline_stages(tenant_id: str, ctx: AuthContext = Depends(get_current_user)):
    tenant = await _get_tenant(ctx, tenant_id)
    stages = tenant.pipeline_stages or get_default_pipeline_stages()
    return {"status": "success", "stages": sorted(stages, key=lambda s: s.order)}


@router.put("/{tenant_id}/stages")
async def update_pipeline_stages(tenant_id: str, payload: UpdatePipelineStagesRequest,
                                 ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tenant = await _get_tenant(ctx, tenant_id)
    seen = set()
    stages: List[PipelineStage] = []
    for idx, stage in enumerate(payload.stages):
        label = clean_text(stage.label, 60)
        if not label:
            raise HTTPException(status_code=400, detail="Every stage needs a label.")
        stage_id = re.sub(r"[^A-Z0-9_]", "_", (stage.id or label).upper()).strip("_")[:40] or f"STAGE_{idx}"
        if stage_id in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate stage id '{stage_id}'.")
        seen.add(stage_id)
        stages.append(PipelineStage(id=stage_id, label=label, order=idx,
                                    color=stage.color if stage.color in STAGE_COLORS else "blue"))

    removed = {s.id for s in (tenant.pipeline_stages or [])} - seen
    if removed:
        in_use = await Lead.find({"tenant_id": str(tenant.id), "is_deleted": {"$ne": True},
                                  "stage": {"$in": list(removed)}}).count()
        if in_use:
            raise HTTPException(
                status_code=409,
                detail=f"{in_use} lead(s) are still in the stage(s) being removed ({', '.join(sorted(removed))}). "
                       "Move them to another stage first.",
            )
    tenant.pipeline_stages = stages
    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    await audit("tenant.stages_updated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant", entity_id=str(tenant.id),
                details={"stages": ", ".join(s.id for s in stages)})
    return {"status": "success", "message": "Pipeline stages updated successfully", "stages": stages}


@router.get("/{tenant_id}/integrations")
async def get_tenant_integrations(tenant_id: str, ctx: AuthContext = Depends(require_permission("settings_manage"))):
    """Integration settings. API keys / secrets are masked; inbound webhook tokens are shown so they can be configured."""
    tenant = await _get_tenant(ctx, tenant_id)
    if _ensure_tokens(tenant):
        tenant.updated_at = datetime.utcnow()
        await tenant.save()
    return {
        "status": "success",
        "company_name": tenant.company_name,
        "tenant_id": str(tenant.id),
        "integrations": serialize_integrations(tenant),
    }


@router.put("/{tenant_id}/integrations")
async def update_tenant_integrations(tenant_id: str, payload: UpdateIntegrationsRequest,
                                     ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tenant = await _get_tenant(ctx, tenant_id)
    _ensure_tokens(tenant)
    changed: List[str] = []
    for provider, conf in payload.integrations.items():
        if provider not in PROVIDERS or not isinstance(conf, dict):
            continue
        cfg: IntegrationConfig = getattr(tenant.integrations, provider)
        # only real changes are applied and written to the audit trail (never the secret values themselves)
        for flag in ("is_enabled", "auto_sync"):
            if flag in conf and bool(conf[flag]) != bool(getattr(cfg, flag)):
                setattr(cfg, flag, bool(conf[flag]))
                changed.append(f"{provider}.{flag}={bool(conf[flag])}")
        if "account_id" in conf:
            account_id = clean_text(conf["account_id"], 100)
            if account_id != cfg.account_id:
                cfg.account_id = account_id
                changed.append(f"{provider}.account_id")
        if "allowed_domains" in conf:
            domains = _clean_domains(conf["allowed_domains"])
            if domains != list(cfg.allowed_domains or []):
                cfg.allowed_domains = domains
                changed.append(f"{provider}.allowed_domains")
        for field in MASKED_FIELDS:
            if field not in conf or (provider == "website" and field == "secret_key"):
                continue  # the website signing secret is only ever generated by the server
            value = conf[field]
            if value is None or looks_masked(value):
                continue  # unchanged
            text = str(value).strip()
            if len(text) > 1000:
                raise HTTPException(status_code=400, detail=f"{provider}.{field} is too long.")
            if text == (decrypt_str(getattr(cfg, field)) or ""):
                continue  # same value as stored: nothing to do, nothing to record
            setattr(cfg, field, encrypt_str(text) if text else None)
            changed.append(f"{provider}.{field}")
        if provider == "indiamart" and cfg.status == "Error" and any(c.startswith("indiamart.") for c in changed):
            cfg.status = "Configured"
    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    await audit("tenant.integrations_updated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant",
                entity_id=str(tenant.id), details={"changed": ", ".join(sorted(set(changed)))})
    return {"status": "success", "message": "Lead integrations updated successfully",
            "integrations": serialize_integrations(tenant)}


@router.post("/{tenant_id}/integrations/regenerate-keys")
async def regenerate_integration_keys(tenant_id: str, provider: str = "website",
                                      ctx: AuthContext = Depends(require_permission("settings_manage"))):
    """Rotates the inbound webhook credentials of one provider. Old values stop working immediately."""
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider '{provider}'.")
    tenant = await _get_tenant(ctx, tenant_id)
    _ensure_tokens(tenant)
    cfg: IntegrationConfig = getattr(tenant.integrations, provider)
    result: Dict[str, Any] = {"status": "success", "provider": provider}
    token = generate_webhook_token()
    cfg.webhook_token = encrypt_str(token)
    result["webhook_token"] = token
    if provider == "website":
        secret = generate_secret_key()
        cfg.secret_key = encrypt_str(secret)
        result["secret_key"] = secret
    if provider == "facebook":
        verify = generate_verify_token()
        cfg.verify_token = encrypt_str(verify)
        result["verify_token"] = verify
    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    await audit("tenant.integration_keys_rotated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant",
                entity_id=str(tenant.id), details={"provider": provider})
    result["message"] = "Credentials regenerated. Update the provider / your website with the new values."
    result["integrations"] = serialize_integrations(tenant)
    return result


@router.post("/{tenant_id}/integrations/reveal")
async def reveal_integration_secrets(tenant_id: str, payload: RevealSecretsRequest, request: Request,
                                     ctx: AuthContext = Depends(require_permission("settings_manage"))):
    """Step-up authentication: the administrator re-enters their password to view stored secrets."""
    if payload.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported provider.")
    await rate_limiter.enforce(f"reveal:{ctx.user_id}", 5, 300, "Too many attempts. Please try again later.")
    tenant = await _get_tenant(ctx, tenant_id)
    if not verify_password(payload.password, ctx.user.hashed_password):
        await audit("tenant.integration_secret_reveal_failed", ctx=ctx, tenant_id=str(tenant.id), status="failure",
                    details={"provider": payload.provider})
        raise HTTPException(status_code=403, detail="Password is incorrect.")
    cfg: IntegrationConfig = getattr(tenant.integrations, payload.provider)
    await audit("tenant.integration_secret_revealed", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant",
                entity_id=str(tenant.id), details={"provider": payload.provider})
    return {"provider": payload.provider, **{f: decrypt_str(getattr(cfg, f)) for f in MASKED_FIELDS}}


@router.post("/{tenant_id}/integrations/indiamart/sync")
async def sync_indiamart_now(tenant_id: str, ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tenant = await _get_tenant(ctx, tenant_id)
    await rate_limiter.enforce(f"imsync:{tenant.id}", 1, 300, "IndiaMART allows one pull every 5 minutes. Please try again later.")
    created, duplicates, message = await sync_indiamart_for_tenant(tenant)
    await audit("tenant.indiamart_sync", ctx=ctx, tenant_id=str(tenant.id), details={"created": created, "duplicates": duplicates})
    return {"status": "success", "created": created, "duplicates": duplicates, "message": message}


@router.put("/{tenant_id}/profile")
async def update_tenant_profile(tenant_id: str, payload: UpdateTenantProfileRequest,
                                ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tenant = await _get_tenant(ctx, tenant_id)
    data = payload.model_dump(exclude_unset=True)

    if "company_name" in data:
        name = clean_text(data["company_name"], 200)
        if not name:
            raise HTTPException(status_code=400, detail="Company name cannot be empty.")
        tenant.company_name = name
    if "company_type" in data and data["company_type"]:
        tenant.company_type = safe_key(data["company_type"], 40).lower()

    if "gstin" in data:
        gstin = normalize_gstin(data["gstin"])
        if gstin:
            err = gstin_error(gstin)
            if err:
                raise HTTPException(status_code=400, detail=err)
            tenant.gstin = gstin
            tenant.state_code = gstin[:2]
            tenant.state_name = state_name(gstin[:2]) or tenant.state_name
            if not data.get("pan_number"):
                tenant.pan_number = gstin[2:12]
        else:
            tenant.gstin = None
    if not tenant.gstin and ("state_code" in data or "state_name" in data):
        code = resolve_state_code(data.get("state_code")) or resolve_state_code(data.get("state_name"))
        if (data.get("state_code") or data.get("state_name")) and not code:
            raise HTTPException(status_code=400, detail="State is not a valid Indian state / GST state code.")
        tenant.state_code = code
        tenant.state_name = state_name(code)

    if data.get("pan_number"):
        pan = str(data["pan_number"]).strip().upper()
        if not PAN_RE.match(pan):
            raise HTTPException(status_code=400, detail="PAN must be 10 characters (e.g. ABCDE1234F).")
        if tenant.gstin and tenant.gstin[2:12] != pan:
            raise HTTPException(status_code=400, detail="PAN does not match the PAN embedded in the GSTIN.")
        tenant.pan_number = pan

    if "email" in data:
        email = (data["email"] or "").strip().lower()
        if email and not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Official email is not valid.")
        tenant.email = email or None
    if "phone" in data:
        phone = clean_text(data["phone"], 20)
        if phone and not re.fullmatch(r"[+0-9\-\s()]{7,20}", phone):
            raise HTTPException(status_code=400, detail="Phone number is not valid.")
        tenant.phone = phone
    if "pincode" in data:
        pincode = clean_text(data["pincode"], 10)
        if pincode and not PINCODE_RE.match(pincode):
            raise HTTPException(status_code=400, detail="PIN code must be 6 digits.")
        tenant.pincode = pincode
    for field, max_len in (("address", 500), ("city", 100), ("default_invoice_terms", 2000)):
        if field in data:
            setattr(tenant, field, clean_text(data[field], max_len))

    if payload.bank_details is not None:
        bank = payload.bank_details
        ifsc = (bank.ifsc_code or "").strip().upper() or None
        if ifsc and not IFSC_RE.match(ifsc):
            raise HTTPException(status_code=400, detail="IFSC code is not valid (e.g. HDFC0001234).")
        account = re.sub(r"\s", "", bank.account_number or "") or None
        if account and not re.fullmatch(r"[0-9A-Za-z]{6,20}", account):
            raise HTTPException(status_code=400, detail="Bank account number is not valid.")
        upi = (bank.upi_id or "").strip() or None
        if upi and not re.fullmatch(r"[\w.\-]{2,256}@[A-Za-z][\w.\-]{1,64}", upi):
            raise HTTPException(status_code=400, detail="UPI ID is not valid (e.g. company@bank).")
        tenant.bank_details = BankDetails(
            bank_name=clean_text(bank.bank_name, 100), account_number=account, ifsc_code=ifsc,
            branch_name=clean_text(bank.branch_name, 100), upi_id=upi,
        )

    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    invalidate_tenant_cache(str(tenant.id))
    await audit("tenant.profile_updated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant", entity_id=str(tenant.id),
                details={"fields": ", ".join(sorted(data.keys()))})
    return {"status": "success", "message": "Company profile updated successfully", "tenant": serialize_tenant(tenant)}


@router.get("/{tenant_id}/custom-fields")
async def get_custom_fields(tenant_id: str, entity_type: str = "lead", ctx: AuthContext = Depends(get_current_user)):
    tid = await resolve_tenant_id(ctx, tenant_id)
    return await CustomFieldDefinition.find(
        {"tenant_id": tid, "entity_type": entity_type}
    ).sort("display_order").to_list()


@router.post("/{tenant_id}/custom-fields", status_code=201)
async def add_custom_field(tenant_id: str, payload: CustomFieldCreateRequest,
                           ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    key = re.sub(r"[^a-z0-9_]", "_", payload.field_key.strip().lower()).strip("_")[:64]
    if not key:
        raise HTTPException(status_code=400, detail="Field key must contain letters or digits.")
    if payload.entity_type not in ("lead", "product", "invoice"):
        raise HTTPException(status_code=400, detail="entity_type must be lead, product or invoice.")
    if payload.field_type not in FIELD_TYPES:
        raise HTTPException(status_code=400, detail=f"field_type must be one of: {', '.join(sorted(FIELD_TYPES))}.")
    if await CustomFieldDefinition.find_one({"tenant_id": tid, "entity_type": payload.entity_type, "field_key": key}):
        raise HTTPException(status_code=409, detail="A custom field with this key already exists.")
    count = await CustomFieldDefinition.find({"tenant_id": tid}).count()
    if count >= 100:
        raise HTTPException(status_code=400, detail="Custom field limit (100) reached.")
    field_def = CustomFieldDefinition(
        tenant_id=tid, entity_type=payload.entity_type, field_key=key,
        field_label=clean_text(payload.field_label, 100), field_type=payload.field_type,
        options=[clean_text(o, 100) for o in payload.options if clean_text(o, 100)],
        is_required=payload.is_required, display_order=count,
    )
    await field_def.insert()
    await audit("tenant.custom_field_created", ctx=ctx, tenant_id=tid, entity_type="custom_field", entity_id=str(field_def.id))
    return field_def


@router.delete("/{tenant_id}/custom-fields/{field_id}")
async def delete_custom_field(tenant_id: str, field_id: str,
                              ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    field_def = await get_document_by_id(CustomFieldDefinition, field_id)
    if not field_def or field_def.tenant_id != tid:
        raise HTTPException(status_code=404, detail="Custom field not found")
    await field_def.delete()
    await audit("tenant.custom_field_deleted", ctx=ctx, tenant_id=tid, entity_type="custom_field", entity_id=field_id)
    return {"status": "success", "message": "Custom field removed"}

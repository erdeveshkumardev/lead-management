"""Platform administration. Every endpoint requires the super_admin role (with 2FA enforced by policy)."""
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from app.core.audit import audit
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, invalidate_tenant_cache, require_roles
from app.core.gst import gstin_error, normalize_gstin, resolve_state_code, state_name, to_decimal
from app.core.security import generate_temp_password, hash_password, password_policy_errors, temp_password_expiry
from app.core.validators import clean_text, safe_key, safe_regex
from app.models.audit_log import AuditLog
from app.models.invoice import Invoice
from app.models.lead import Lead
from app.models.tenant import Tenant
from app.models.user import User, get_default_permissions_for_role
from app.services import auth_service
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/super-admin", tags=["Super Admin Platform Management"])
superadmin = require_roles("super_admin")

PLANS = {"Starter", "Professional", "Enterprise"}
STATUSES = {"ACTIVE", "SUSPENDED", "TRIAL"}


class CreateCompanyRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=200)
    company_type: str = Field(default="manufacturing", max_length=40)
    max_users_limit: int = Field(default=5, ge=1, le=10000)
    plan_name: str = "Professional"
    admin_name: str = Field(min_length=2, max_length=120)
    admin_email: EmailStr
    admin_password: Optional[str] = Field(default=None, max_length=128)
    gstin: Optional[str] = Field(default=None, max_length=20)
    state_code: Optional[str] = Field(default=None, max_length=2)
    state_name: Optional[str] = Field(default=None, max_length=60)
    city: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=20)


class UpdateCompanyRequest(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=200)
    company_type: Optional[str] = Field(default=None, max_length=40)
    max_users_limit: Optional[int] = Field(default=None, ge=1, le=10000)
    plan_name: Optional[str] = None
    status: Optional[str] = None
    gstin: Optional[str] = Field(default=None, max_length=20)
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=254)
    city: Optional[str] = Field(default=None, max_length=100)
    state_name: Optional[str] = Field(default=None, max_length=60)


class ToggleCompanyStatusRequest(BaseModel):
    status: str


def _company_view(t: Tenant, users: int = 0, leads: int = 0, invoices: int = 0) -> Dict[str, Any]:
    return {
        "id": str(t.id), "company_name": t.company_name, "company_type": t.company_type, "plan_name": t.plan_name,
        "status": t.status, "current_users": users, "max_users_limit": t.max_users_limit, "gstin": t.gstin,
        "email": t.email, "phone": t.phone, "city": t.city, "state_name": t.state_name,
        "company_admin_email": t.company_admin_email, "leads_count": leads, "invoices_count": invoices,
        "created_at": t.created_at,
    }


async def _apply_company_update(tenant: Tenant, data: Dict[str, Any]) -> None:
    if data.get("company_name"):
        tenant.company_name = clean_text(data["company_name"], 200)
    if data.get("company_type"):
        tenant.company_type = safe_key(data["company_type"], 40).lower()
    if data.get("max_users_limit") is not None:
        active = await User.find({"tenant_id": str(tenant.id), "is_active": True}).count()
        if data["max_users_limit"] < active:
            raise HTTPException(status_code=400, detail=f"The company already has {active} active users. Deactivate users before lowering the limit.")
        tenant.max_users_limit = data["max_users_limit"]
    if data.get("plan_name"):
        if data["plan_name"] not in PLANS:
            raise HTTPException(status_code=400, detail=f"plan_name must be one of: {', '.join(sorted(PLANS))}.")
        tenant.plan_name = data["plan_name"]
    if data.get("status"):
        new_status = str(data["status"]).upper()
        if new_status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(STATUSES))}.")
        tenant.status = new_status
        tenant.is_active = new_status != "SUSPENDED"
    if "gstin" in data and data["gstin"] is not None:
        gstin = normalize_gstin(data["gstin"])
        if gstin:
            err = gstin_error(gstin)
            if err:
                raise HTTPException(status_code=400, detail=err)
            tenant.gstin, tenant.state_code = gstin, gstin[:2]
            tenant.state_name = state_name(gstin[:2])
        else:
            tenant.gstin = None
    if "state_name" in data and data["state_name"] and not tenant.gstin:
        code = resolve_state_code(data["state_name"])
        if not code:
            raise HTTPException(status_code=400, detail="State is not a valid Indian state.")
        tenant.state_code, tenant.state_name = code, state_name(code)
    for field, max_len in (("phone", 20), ("city", 100)):
        if field in data and data[field] is not None:
            setattr(tenant, field, clean_text(data[field], max_len))
    if "email" in data and data["email"] is not None:
        email = data["email"].strip().lower()
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(status_code=400, detail="Email is not valid.")
        tenant.email = email or None
    tenant.updated_at = datetime.utcnow()


async def _load_company(tenant_id: str) -> Tenant:
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant


async def _suspend_side_effects(tenant: Tenant) -> None:
    invalidate_tenant_cache(str(tenant.id))
    if tenant.status == "SUSPENDED":
        users = await User.find({"tenant_id": str(tenant.id)}).to_list()
        for user in users:
            await auth_service.revoke_all_sessions(str(user.id), "tenant_suspended")


@router.get("/stats")
async def get_super_admin_stats(ctx: AuthContext = Depends(superadmin)):
    volume = 0.0
    cursor = Invoice.get_motor_collection().aggregate([
        {"$match": {"document_type": "TAX_INVOICE", "payment_status": {"$ne": "CANCELLED"}}},
        {"$group": {"_id": None, "total": {"$sum": "$financials.grand_total"}}},
    ])
    async for row in cursor:
        volume = float(to_decimal(row.get("total")))
    return {
        "total_companies": await Tenant.find({}).count(),
        "active_companies": await Tenant.find({"status": "ACTIVE"}).count(),
        "total_platform_users": await User.find({"role": {"$ne": "super_admin"}}).count(),
        "total_leads_processed": await Lead.find({}).count(),
        "total_platform_billing_volume": volume,
    }


async def _counts_by_tenant(collection, match: Dict[str, Any]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    async for row in collection.aggregate([{"$match": match}, {"$group": {"_id": "$tenant_id", "n": {"$sum": 1}}}]):
        counts[str(row["_id"])] = int(row["n"])
    return counts


@router.get("/companies")
async def list_all_companies(ctx: AuthContext = Depends(superadmin)):
    tenants = await Tenant.find({}).sort("-created_at").to_list()
    users = await _counts_by_tenant(User.get_motor_collection(), {"is_active": True})
    leads = await _counts_by_tenant(Lead.get_motor_collection(), {"is_deleted": {"$ne": True}})
    invoices = await _counts_by_tenant(Invoice.get_motor_collection(), {})
    return [_company_view(t, users.get(str(t.id), 0), leads.get(str(t.id), 0), invoices.get(str(t.id), 0)) for t in tenants]


@router.post("/companies", status_code=201)
async def create_company_with_admin(payload: CreateCompanyRequest, ctx: AuthContext = Depends(superadmin)):
    admin_email = str(payload.admin_email).strip().lower()
    if await User.find_one({"email": admin_email}):
        raise HTTPException(status_code=409, detail="A user with this email already exists.")
    if payload.plan_name not in PLANS:
        raise HTTPException(status_code=400, detail=f"plan_name must be one of: {', '.join(sorted(PLANS))}.")

    gstin = normalize_gstin(payload.gstin)
    if gstin:
        err = gstin_error(gstin)
        if err:
            raise HTTPException(status_code=400, detail=err)
    code = (gstin[:2] if gstin else None) or resolve_state_code(payload.state_code) or resolve_state_code(payload.state_name)

    password = (payload.admin_password or "").strip()
    if password:
        errors = password_policy_errors(password, admin_email, payload.admin_name)
        if errors:
            raise HTTPException(status_code=400, detail=" ".join(errors))
    else:
        password = generate_temp_password()

    base_slug = re.sub(r"[^a-z0-9]+", "-", payload.company_name.lower()).strip("-")[:60] or "company"
    slug, n = base_slug, 1
    while await Tenant.find_one({"slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"

    tenant = Tenant(
        company_name=clean_text(payload.company_name, 200), slug=slug,
        company_type=safe_key(payload.company_type, 40).lower(), max_users_limit=payload.max_users_limit,
        plan_name=payload.plan_name, status="ACTIVE", company_admin_email=admin_email, gstin=gstin,
        state_code=code, state_name=state_name(code), city=clean_text(payload.city, 100),
        phone=clean_text(payload.phone, 20), email=admin_email,
    )
    await tenant.insert()
    try:
        admin = User(
            tenant_id=str(tenant.id), full_name=clean_text(payload.admin_name, 120), email=admin_email,
            hashed_password=hash_password(password), phone=clean_text(payload.phone, 20), role="company_admin",
            permissions=get_default_permissions_for_role("company_admin"), must_change_password=True,
            temp_password_expires_at=temp_password_expiry(),
        )
        await admin.insert()
    except Exception:
        await tenant.delete()  # never leave a company without an administrator
        raise

    await audit("platform.company_created", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant", entity_id=str(tenant.id),
                details={"company": tenant.company_name, "admin_email": admin_email, "max_users": tenant.max_users_limit})
    email_result = await NotificationService.notify_company_created(tenant, admin, password)
    delivered = email_result.get("status") == "success"
    return {
        "status": "success",
        "message": f"Company '{tenant.company_name}' created with a limit of {tenant.max_users_limit} users. "
                   + ("A welcome e-mail with sign-in details was sent. " if delivered
                      else "E-mail is not configured: share the temporary password securely. ")
                   + "The administrator must set their own password at first sign-in.",
        "tenant_id": str(tenant.id),
        "admin_user_id": str(admin.id),
        "admin_email": admin_email,
        # shown once to the platform administrator; it is never stored in readable form
        "temp_password": password,
        "is_first_login": True,
        "email_status": email_result.get("status", "error"),
    }


@router.put("/companies/{tenant_id}")
async def edit_company_full(tenant_id: str, payload: UpdateCompanyRequest, ctx: AuthContext = Depends(superadmin)):
    tenant = await _load_company(tenant_id)
    data = payload.model_dump(exclude_unset=True)
    await _apply_company_update(tenant, data)
    await tenant.save()
    await _suspend_side_effects(tenant)
    await audit("platform.company_updated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant", entity_id=str(tenant.id),
                details={"fields": ", ".join(sorted(data.keys())), "status": tenant.status})
    return {"status": "success", "message": f"Company '{tenant.company_name}' updated successfully", "tenant": _company_view(tenant)}


@router.patch("/companies/{tenant_id}")
async def update_company_licensing(tenant_id: str, payload: UpdateCompanyRequest, ctx: AuthContext = Depends(superadmin)):
    tenant = await _load_company(tenant_id)
    data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if k in ("max_users_limit", "status", "plan_name")}
    await _apply_company_update(tenant, data)
    await tenant.save()
    await _suspend_side_effects(tenant)
    await audit("platform.company_licensing_updated", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant",
                entity_id=str(tenant.id), details={k: str(v) for k, v in data.items()})
    return {"status": "success", "message": "Company licensing updated successfully", "tenant": _company_view(tenant)}


@router.patch("/companies/{tenant_id}/status")
async def toggle_company_status(tenant_id: str, payload: ToggleCompanyStatusRequest, ctx: AuthContext = Depends(superadmin)):
    tenant = await _load_company(tenant_id)
    await _apply_company_update(tenant, {"status": payload.status})
    await tenant.save()
    await _suspend_side_effects(tenant)
    await audit("platform.company_status_changed", ctx=ctx, tenant_id=str(tenant.id), entity_type="tenant",
                entity_id=str(tenant.id), details={"status": tenant.status})
    return {"status": "success", "message": f"Company '{tenant.company_name}' status changed to {tenant.status}",
            "tenant_id": str(tenant.id), "status_value": tenant.status}


@router.get("/companies/{tenant_id}/integrations")
async def view_company_integrations_readonly(tenant_id: str, ctx: AuthContext = Depends(superadmin)):
    """Read-only health view. Credentials and webhook tokens are never exposed to the platform operator."""
    tenant = await _load_company(tenant_id)
    integrations = {}
    for provider in ("indiamart", "facebook", "tradeindia", "justdial", "website"):
        cfg = getattr(tenant.integrations, provider)
        integrations[provider] = {
            "is_enabled": cfg.is_enabled,
            "has_key": bool(cfg.api_key or cfg.crm_key or cfg.webhook_token),
            "status": cfg.status if cfg.is_enabled else "Disabled",
            "last_sync_at": cfg.last_sync_at,
        }
    return {"company_name": tenant.company_name, "tenant_id": str(tenant.id), "integrations": integrations}


@router.post("/companies/{tenant_id}/reset-admin-password")
async def reset_company_admin_password(tenant_id: str, ctx: AuthContext = Depends(superadmin)):
    """Account recovery for a company whose administrator is locked out. Returns a one-time temporary password."""
    tenant = await _load_company(tenant_id)
    admin = None
    if tenant.company_admin_email:
        admin = await User.find_one({"tenant_id": str(tenant.id), "email": tenant.company_admin_email.lower(), "role": "company_admin"})
    if not admin:
        admin = await User.find_one({"tenant_id": str(tenant.id), "role": "company_admin", "is_active": True})
    if not admin:
        admin = await User.find_one({"tenant_id": str(tenant.id), "role": "company_admin"})
    if not admin:
        raise HTTPException(status_code=404, detail="This company has no administrator account.")
    temp_password = generate_temp_password()
    admin.hashed_password = hash_password(temp_password)
    admin.must_change_password = True
    admin.temp_password_expires_at = temp_password_expiry()
    admin.is_active = True
    admin.failed_login_attempts = 0
    admin.locked_until = None
    admin.mfa_enabled = False
    admin.mfa_secret = None
    admin.mfa_recovery_codes = []
    admin.token_version = (admin.token_version or 0) + 1
    await admin.save()
    await auth_service.revoke_all_sessions(str(admin.id), "password_reset_by_platform")
    await audit("platform.company_admin_password_reset", ctx=ctx, tenant_id=str(tenant.id), entity_type="user", entity_id=str(admin.id))
    return {"status": "success", "admin_email": str(admin.email), "temp_password": temp_password,
            "message": "Temporary password generated. Share it securely; it must be changed at next sign-in."}


@router.get("/audit-logs")
async def platform_audit_logs(
    tenant_id: Optional[str] = None, action: Optional[str] = None, status: Optional[str] = None,
    skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), ctx: AuthContext = Depends(superadmin),
):
    query: Dict[str, Any] = {}
    if tenant_id:
        query["tenant_id"] = tenant_id
    if action:
        query["action"] = {"$regex": "^" + safe_regex(action, 60)}
    if status in ("success", "failure"):
        query["status"] = status
    items: List[AuditLog] = await AuditLog.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    return {"total": await AuditLog.find(query).count(), "items": items}

from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from app.models.tenant import Tenant, BankDetails
from app.models.user import User, get_default_permissions_for_role
from app.models.lead import Lead
from app.models.invoice import Invoice
from app.core.database import get_document_by_id

router = APIRouter(prefix="/super-admin", tags=["Super Admin Platform Management"])


class CreateCompanyRequest(BaseModel):
    company_name: str
    company_type: str = "manufacturing"  # manufacturing, trading, services, real_estate
    max_users_limit: int = 5
    plan_name: str = "Professional"  # Starter, Professional, Enterprise
    admin_name: str
    admin_email: EmailStr
    admin_password: str = "password123"
    gstin: Optional[str] = None
    state_code: Optional[str] = "24"
    state_name: Optional[str] = "Gujarat"
    city: Optional[str] = None
    phone: Optional[str] = None


class UpdateCompanyFullRequest(BaseModel):
    company_name: Optional[str] = None
    company_type: Optional[str] = None
    max_users_limit: Optional[int] = None
    plan_name: Optional[str] = None
    status: Optional[str] = None  # "ACTIVE", "SUSPENDED"
    gstin: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    state_name: Optional[str] = None


class UpdateCompanyLimitRequest(BaseModel):
    max_users_limit: Optional[int] = None
    status: Optional[str] = None
    plan_name: Optional[str] = None


class ToggleCompanyStatusRequest(BaseModel):
    status: str  # "ACTIVE" or "SUSPENDED"


@router.put("/companies/{tenant_id}")
async def edit_company_full(tenant_id: str, payload: UpdateCompanyFullRequest):
    """
    Super Admin Edit: Full update of company profile, licensing limits, and subscription.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    if payload.company_name:
        tenant.company_name = payload.company_name
    if payload.company_type:
        tenant.company_type = payload.company_type
    if payload.max_users_limit is not None:
        tenant.max_users_limit = payload.max_users_limit
    if payload.plan_name:
        tenant.plan_name = payload.plan_name
    if payload.status:
        tenant.status = payload.status
    if payload.gstin is not None:
        tenant.gstin = payload.gstin
    if payload.phone is not None:
        tenant.phone = payload.phone
    if payload.email is not None:
        tenant.email = payload.email
    if payload.city is not None:
        tenant.city = payload.city
    if payload.state_name is not None:
        tenant.state_name = payload.state_name

    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": f"Company '{tenant.company_name}' updated successfully",
        "tenant": tenant
    }


@router.patch("/companies/{tenant_id}/status")
async def toggle_company_status(tenant_id: str, payload: ToggleCompanyStatusRequest):
    """
    Super Admin Quick Action: Toggle company status between ACTIVE and SUSPENDED / INACTIVE.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    tenant.status = payload.status
    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": f"Company '{tenant.company_name}' status changed to {payload.status}",
        "tenant_id": str(tenant.id),
        "status_value": tenant.status
    }


@router.get("/companies/{tenant_id}/integrations")
async def view_company_integrations_readonly(tenant_id: str):
    """
    Super Admin Read-Only Inspection:
    View configured lead sources for a company (IndiaMART, Facebook, TradeIndia, Justdial)
    without revealing sensitive private keys.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    integrations = tenant.integrations
    # Return masked/safe summary for super admin
    return {
        "company_name": tenant.company_name,
        "tenant_id": str(tenant.id),
        "integrations": {
            "indiamart": {
                "is_enabled": integrations.indiamart.is_enabled,
                "has_key": bool(integrations.indiamart.api_key),
                "status": integrations.indiamart.status,
                "last_sync_at": integrations.indiamart.last_sync_at
            },
            "facebook": {
                "is_enabled": integrations.facebook.is_enabled,
                "has_key": bool(integrations.facebook.api_key),
                "status": integrations.facebook.status,
                "last_sync_at": integrations.facebook.last_sync_at
            },
            "tradeindia": {
                "is_enabled": integrations.tradeindia.is_enabled,
                "has_key": bool(integrations.tradeindia.api_key),
                "status": integrations.tradeindia.status,
                "last_sync_at": integrations.tradeindia.last_sync_at
            },
            "justdial": {
                "is_enabled": integrations.justdial.is_enabled,
                "has_key": bool(integrations.justdial.api_key),
                "status": integrations.justdial.status,
                "last_sync_at": integrations.justdial.last_sync_at
            },
            "website": {
                "is_enabled": integrations.website.is_enabled,
                "has_key": bool(integrations.website.webhook_token),
                "status": integrations.website.status,
                "last_sync_at": integrations.website.last_sync_at
            }
        }
    }


@router.get("/stats")
async def get_super_admin_stats():
    total_companies = await Tenant.find().count()
    active_companies = await Tenant.find(Tenant.status == "ACTIVE").count()
    total_users = await User.find(User.role != "super_admin").count()
    total_leads = await Lead.find().count()
    invoices = await Invoice.find().to_list()
    total_volume = sum([float(inv.financials.grand_total) for inv in invoices])

    return {
        "total_companies": total_companies,
        "active_companies": active_companies,
        "total_platform_users": total_users,
        "total_leads_processed": total_leads,
        "total_platform_billing_volume": total_volume
    }


@router.get("/companies")
async def list_all_companies():
    tenants = await Tenant.find().sort("-created_at").to_list()
    result = []

    for t in tenants:
        t_id = str(t.id)
        users_count = await User.find(User.tenant_id == t_id, User.is_active == True).count()
        leads_count = await Lead.find(Lead.tenant_id == t_id).count()
        invoices_count = await Invoice.find(Invoice.tenant_id == t_id).count()

        result.append({
            "id": t_id,
            "company_name": t.company_name,
            "company_type": t.company_type,
            "plan_name": t.plan_name,
            "status": t.status,
            "current_users": users_count,
            "max_users_limit": t.max_users_limit,
            "gstin": t.gstin,
            "email": t.email,
            "phone": t.phone,
            "city": t.city,
            "state_name": t.state_name,
            "leads_count": leads_count,
            "invoices_count": invoices_count,
            "created_at": t.created_at
        })

    return result


@router.post("/companies")
async def create_company_with_admin(payload: CreateCompanyRequest):
    # 1. Check if email already used
    existing_user = await User.find_one(User.email == payload.admin_email)
    if existing_user:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")

    # 2. Create Tenant
    slug = payload.company_name.lower().replace(" ", "-").replace(".", "")
    tenant = Tenant(
        company_name=payload.company_name,
        slug=slug,
        company_type=payload.company_type,
        max_users_limit=payload.max_users_limit,
        plan_name=payload.plan_name,
        status="ACTIVE",
        company_admin_email=payload.admin_email,
        gstin=payload.gstin,
        state_code=payload.state_code,
        state_name=payload.state_name,
        city=payload.city,
        phone=payload.phone,
        email=payload.admin_email
    )
    await tenant.insert()
    tenant_id = str(tenant.id)

    # 3. Create Company Admin User
    admin_user = User(
        tenant_id=tenant_id,
        full_name=payload.admin_name,
        email=payload.admin_email,
        hashed_password=payload.admin_password,
        phone=payload.phone,
        role="company_admin",
        permissions=get_default_permissions_for_role("company_admin")
    )
    await admin_user.insert()

    return {
        "status": "success",
        "message": f"Company '{payload.company_name}' created successfully with user limit {payload.max_users_limit}",
        "tenant_id": tenant_id,
        "admin_user_id": str(admin_user.id)
    }


@router.patch("/companies/{tenant_id}")
async def update_company_licensing(tenant_id: str, payload: UpdateCompanyLimitRequest):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    if payload.max_users_limit is not None:
        tenant.max_users_limit = payload.max_users_limit
    if payload.status:
        tenant.status = payload.status
    if payload.plan_name:
        tenant.plan_name = payload.plan_name

    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": "Company licensing updated successfully",
        "tenant": tenant
    }

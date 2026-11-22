from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.audit import audit
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_current_user, require_permission, require_roles, resolve_tenant_id
from app.core.gst import STATE_CODES
from app.core.validators import clean_text, sanitize_flat_dict
from app.models.masters import CompanyMasters, GlobalMasterItem
from app.models.tenant import Tenant

router = APIRouter(prefix="/masters", tags=["CRM & System Masters"])

MASTER_TYPES = {"country", "state", "city", "industry"}


class CreateGlobalMasterRequest(BaseModel):
    master_type: str
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    extra_data: Dict[str, Any] = Field(default_factory=dict)
    display_order: int = Field(default=0, ge=0, le=100000)


class UpdateCompanyMastersRequest(BaseModel):
    masters: Dict[str, Any]


# Seed standard Indian GST States, Countries, Cities, and Industries
async def seed_initial_global_masters():
    count = await GlobalMasterItem.find().count()
    if count > 0:
        return

    # 1. Countries
    countries = [
        {"code": "IN", "name": "India", "extra": {"phone_code": "+91", "currency": "INR"}},
        {"code": "AE", "name": "United Arab Emirates", "extra": {"phone_code": "+971", "currency": "AED"}},
        {"code": "US", "name": "United States", "extra": {"phone_code": "+1", "currency": "USD"}},
        {"code": "GB", "name": "United Kingdom", "extra": {"phone_code": "+44", "currency": "GBP"}},
        {"code": "SG", "name": "Singapore", "extra": {"phone_code": "+65", "currency": "SGD"}},
    ]
    for idx, c in enumerate(countries):
        await GlobalMasterItem(
            master_type="country",
            code=c["code"],
            name=c["name"],
            extra_data=c["extra"],
            display_order=idx
        ).insert()

    # 2. Indian States with 2-digit GST Codes
    indian_states = [
        {"code": code, "name": name} for code, name in sorted(STATE_CODES.items()) if code not in ("96", "97")
    ]
    for idx, s in enumerate(indian_states):
        await GlobalMasterItem(
            master_type="state",
            code=s["code"],
            name=s["name"],
            extra_data={"gst_code": s["code"], "country": "India"},
            display_order=idx
        ).insert()

    # 3. Major Commercial Cities
    cities = [
        {"code": "DELHI", "name": "Delhi", "state": "Delhi"},
        {"code": "DEL", "name": "New Delhi / NCR", "state": "Delhi"},
        {"code": "NOI", "name": "Noida", "state": "Uttar Pradesh"},
        {"code": "GUR", "name": "Gurugram", "state": "Haryana"},
        {"code": "GZB", "name": "Ghaziabad", "state": "Uttar Pradesh"},
        {"code": "FBD", "name": "Faridabad", "state": "Haryana"},
        {"code": "BOM", "name": "Mumbai", "state": "Maharashtra"},
        {"code": "PUN", "name": "Pune", "state": "Maharashtra"},
        {"code": "THA", "name": "Thane", "state": "Maharashtra"},
        {"code": "NSK", "name": "Nashik", "state": "Maharashtra"},
        {"code": "NAG", "name": "Nagpur", "state": "Maharashtra"},
        {"code": "AMD", "name": "Ahmedabad", "state": "Gujarat"},
        {"code": "SRT", "name": "Surat", "state": "Gujarat"},
        {"code": "BDQ", "name": "Vadodara", "state": "Gujarat"},
        {"code": "RAJ", "name": "Rajkot", "state": "Gujarat"},
        {"code": "BLR", "name": "Bengaluru", "state": "Karnataka"},
        {"code": "HYD", "name": "Hyderabad", "state": "Telangana"},
        {"code": "MAA", "name": "Chennai", "state": "Tamil Nadu"},
        {"code": "CJB", "name": "Coimbatore", "state": "Tamil Nadu"},
        {"code": "CCU", "name": "Kolkata", "state": "West Bengal"},
        {"code": "JAI", "name": "Jaipur", "state": "Rajasthan"},
        {"code": "JDR", "name": "Jodhpur", "state": "Rajasthan"},
        {"code": "UDR", "name": "Udaipur", "state": "Rajasthan"},
        {"code": "IND", "name": "Indore", "state": "Madhya Pradesh"},
        {"code": "BHP", "name": "Bhopal", "state": "Madhya Pradesh"},
        {"code": "GWL", "name": "Gwalior", "state": "Madhya Pradesh"},
        {"code": "LKO", "name": "Lucknow", "state": "Uttar Pradesh"},
        {"code": "KNP", "name": "Kanpur", "state": "Uttar Pradesh"},
        {"code": "AGR", "name": "Agra", "state": "Uttar Pradesh"},
        {"code": "VNS", "name": "Varanasi", "state": "Uttar Pradesh"},
        {"code": "CHD", "name": "Chandigarh", "state": "Punjab"},
        {"code": "LDH", "name": "Ludhiana", "state": "Punjab"},
        {"code": "ASR", "name": "Amritsar", "state": "Punjab"},
        {"code": "PAT", "name": "Patna", "state": "Bihar"},
        {"code": "RNC", "name": "Ranchi", "state": "Jharkhand"},
        {"code": "BBI", "name": "Bhubaneswar", "state": "Odisha"},
        {"code": "COK", "name": "Kochi", "state": "Kerala"},
        {"code": "VTZ", "name": "Visakhapatnam", "state": "Andhra Pradesh"},
        {"code": "GAU", "name": "Guwahati", "state": "Assam"},
    ]
    for idx, ct in enumerate(cities):
        await GlobalMasterItem(
            master_type="city",
            code=ct["code"],
            name=ct["name"],
            extra_data={"state": ct["state"]},
            display_order=idx
        ).insert()

    # 4. Industry Templates
    industries = [
        {"code": "manufacturing", "name": "B2B Manufacturing & Industrial Machinery"},
        {"code": "trading", "name": "B2B Wholesale Trading & Distribution"},
        {"code": "real_estate", "name": "Real Estate, Builders & Construction"},
        {"code": "services", "name": "IT, Software & Professional Services"},
        {"code": "healthcare", "name": "Healthcare, Medical Equipment & Pharma"},
        {"code": "education", "name": "Education, EdTech & Institutes"},
        {"code": "agency", "name": "Marketing & Creative Agency"},
    ]
    for idx, ind in enumerate(industries):
        await GlobalMasterItem(
            master_type="industry",
            code=ind["code"],
            name=ind["name"],
            display_order=idx
        ).insert()


# -------------------------------------------------------------
# GLOBAL MASTERS (read: any signed-in user, write: platform administrator)
# -------------------------------------------------------------

@router.get("/states")
async def list_gst_states(ctx: AuthContext = Depends(get_current_user)):
    """Official GST state / UT codes, used for place-of-supply selection."""
    return [{"code": code, "name": name} for code, name in sorted(STATE_CODES.items(), key=lambda kv: kv[1])]


@router.get("/global")
async def list_all_global_masters(ctx: AuthContext = Depends(get_current_user)):
    await seed_initial_global_masters()
    items = await GlobalMasterItem.find({}).sort("display_order").to_list()
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for it in items:
        grouped.setdefault(it.master_type, []).append({
            "id": str(it.id), "code": it.code, "name": it.name, "extra_data": it.extra_data,
            "is_active": it.is_active, "display_order": it.display_order,
        })
    return grouped


@router.get("/global/{master_type}")
async def get_global_master_by_type(master_type: str, ctx: AuthContext = Depends(get_current_user)):
    if master_type not in MASTER_TYPES:
        raise HTTPException(status_code=404, detail="Unknown master type")
    await seed_initial_global_masters()
    return await GlobalMasterItem.find({"master_type": master_type}).sort("display_order").to_list()


@router.post("/global", status_code=201)
async def create_global_master_item(payload: CreateGlobalMasterRequest, ctx: AuthContext = Depends(require_roles("super_admin"))):
    if payload.master_type not in MASTER_TYPES:
        raise HTTPException(status_code=400, detail=f"master_type must be one of: {', '.join(sorted(MASTER_TYPES))}.")
    code = payload.code.strip()
    if await GlobalMasterItem.find_one({"master_type": payload.master_type, "code": code}):
        raise HTTPException(status_code=409, detail="An item with this code already exists.")
    item = GlobalMasterItem(
        master_type=payload.master_type, code=code, name=clean_text(payload.name, 120),
        extra_data=sanitize_flat_dict(payload.extra_data, max_items=20, max_value_len=200),
        display_order=payload.display_order,
    )
    await item.insert()
    await audit("platform.master_created", ctx=ctx, entity_type="global_master", entity_id=str(item.id),
                details={"type": item.master_type, "code": item.code})
    return {"status": "success", "item": item}


@router.delete("/global/{item_id}")
async def delete_global_master_item(item_id: str, ctx: AuthContext = Depends(require_roles("super_admin"))):
    item = await get_document_by_id(GlobalMasterItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Master item not found")
    await item.delete()
    await audit("platform.master_deleted", ctx=ctx, entity_type="global_master", entity_id=item_id,
                details={"type": item.master_type, "code": item.code})
    return {"status": "success", "message": "Master item deleted"}


# -------------------------------------------------------------
# COMPANY LEVEL MASTERS
# -------------------------------------------------------------

def _validated_masters(current: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    """Only known master lists are accepted and each is validated against its schema."""
    allowed = set(CompanyMasters.model_fields.keys())
    merged = {k: v for k, v in (current or {}).items() if k in allowed}
    for key, value in updates.items():
        if key not in allowed:
            raise HTTPException(status_code=400, detail=f"Unknown master list '{key}'.")
        if not isinstance(value, list) or len(value) > 100:
            raise HTTPException(status_code=400, detail=f"'{key}' must be a list with at most 100 entries.")
        merged[key] = value
    try:
        validated = CompanyMasters(**merged)
    except Exception:
        raise HTTPException(status_code=400, detail="Master data is not in the expected format.")
    data = validated.model_dump()
    for key in ("lost_reasons", "campaigns", "departments", "designations"):
        data[key] = [t for t in (clean_text(x, 120) for x in data[key]) if t]
    return data


@router.get("/company/{tenant_id}")
async def get_company_masters(tenant_id: str, ctx: AuthContext = Depends(get_current_user)):
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    defaults = CompanyMasters().model_dump()
    return {**defaults, **(tenant.company_masters or {})}


@router.put("/company/{tenant_id}")
async def update_company_masters(tenant_id: str, payload: UpdateCompanyMastersRequest,
                                 ctx: AuthContext = Depends(require_permission("settings_manage"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    tenant.company_masters = _validated_masters(tenant.company_masters or CompanyMasters().model_dump(), payload.masters)
    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    await audit("tenant.masters_updated", ctx=ctx, tenant_id=tid, entity_type="tenant", entity_id=tid,
                details={"lists": ", ".join(sorted(payload.masters.keys()))})
    return {"status": "success", "message": "Company masters updated successfully", "company_masters": tenant.company_masters}

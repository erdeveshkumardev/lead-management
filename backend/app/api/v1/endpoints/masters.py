from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import get_document_by_id
from app.models.tenant import Tenant
from app.models.masters import GlobalMasterItem, CompanyMasters

router = APIRouter(prefix="/masters", tags=["CRM & System Masters"])


class CreateGlobalMasterRequest(BaseModel):
    master_type: str  # "country", "state", "city", "industry"
    code: str
    name: str
    extra_data: Dict[str, Any] = {}
    display_order: int = 0


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
        {"code": "24", "name": "Gujarat"},
        {"code": "27", "name": "Maharashtra"},
        {"code": "07", "name": "Delhi"},
        {"code": "29", "name": "Karnataka"},
        {"code": "33", "name": "Tamil Nadu"},
        {"code": "09", "name": "Uttar Pradesh"},
        {"code": "08", "name": "Rajasthan"},
        {"code": "19", "name": "West Bengal"},
        {"code": "06", "name": "Haryana"},
        {"code": "23", "name": "Madhya Pradesh"},
        {"code": "36", "name": "Telangana"},
        {"code": "37", "name": "Andhra Pradesh"},
        {"code": "03", "name": "Punjab"},
        {"code": "10", "name": "Bihar"},
        {"code": "21", "name": "Odisha"},
        {"code": "32", "name": "Kerala"},
        {"code": "30", "name": "Goa"},
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
# SUPER ADMIN GLOBAL MASTER ENDPOINTS
# -------------------------------------------------------------

@router.get("/global")
async def list_all_global_masters():
    await seed_initial_global_masters()
    items = await GlobalMasterItem.find().sort("display_order").to_list()
    # Group by type
    grouped = {}
    for it in items:
        grouped.setdefault(it.master_type, []).append({
            "id": str(it.id),
            "code": it.code,
            "name": it.name,
            "extra_data": it.extra_data,
            "is_active": it.is_active,
            "display_order": it.display_order
        })
    return grouped


@router.get("/global/{master_type}")
async def get_global_master_by_type(master_type: str):
    await seed_initial_global_masters()
    items = await GlobalMasterItem.find(GlobalMasterItem.master_type == master_type).sort("display_order").to_list()
    return items


@router.post("/global")
async def create_global_master_item(payload: CreateGlobalMasterRequest):
    item = GlobalMasterItem(
        master_type=payload.master_type,
        code=payload.code.strip(),
        name=payload.name.strip(),
        extra_data=payload.extra_data,
        display_order=payload.display_order
    )
    await item.insert()
    return {"status": "success", "item": item}


@router.delete("/global/{item_id}")
async def delete_global_master_item(item_id: str):
    item = await get_document_by_id(GlobalMasterItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Master item not found")
    await item.delete()
    return {"status": "success", "message": "Master item deleted"}


# -------------------------------------------------------------
# COMPANY LEVEL MASTER ENDPOINTS
# -------------------------------------------------------------

@router.get("/company/{tenant_id}")
async def get_company_masters(tenant_id: str):
    """
    Returns company-level masters:
    - Lead Categories (Hot, Warm, Cold)
    - Lost Reasons
    - Follow-up Types (Call, WhatsApp, Email, Meeting, Site Visit)
    - Marketing Campaigns
    - Departments & Designations
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})

    default_masters = CompanyMasters().model_dump()
    if not tenant:
        return default_masters

    if not tenant.company_masters or len(tenant.company_masters) == 0:
        tenant.company_masters = default_masters
        await tenant.save()

    return tenant.company_masters


@router.put("/company/{tenant_id}")
async def update_company_masters(tenant_id: str, payload: UpdateCompanyMastersRequest):
    """
    Allows Company Admin to customize categories, lost reasons, follow-up types, and departments.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})

    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    cur_masters = tenant.company_masters or CompanyMasters().model_dump()
    cur_masters.update(payload.masters)

    tenant.company_masters = cur_masters
    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": "Company masters updated successfully",
        "company_masters": tenant.company_masters
    }

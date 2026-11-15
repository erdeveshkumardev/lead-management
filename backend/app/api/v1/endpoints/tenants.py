from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import get_document_by_id
from app.models.tenant import Tenant, BankDetails, PipelineStage, get_default_pipeline_stages
from app.models.custom_field import CustomFieldDefinition

router = APIRouter(prefix="/tenants", tags=["Tenants & Multi-Company Configuration"])


class TenantCreateRequest(BaseModel):
    company_name: str
    company_type: str = "manufacturing"  # manufacturing, trading, services, real_estate, agency
    gstin: Optional[str] = None
    pan_number: Optional[str] = None
    state_code: Optional[str] = None  # 2-digit Indian State code e.g. "24"
    state_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    bank_details: Optional[BankDetails] = None


class CustomFieldCreateRequest(BaseModel):
    entity_type: str = "lead"
    field_key: str
    field_label: str
    field_type: str = "text"
    options: List[str] = []
    is_required: bool = False


class UpdatePipelineStagesRequest(BaseModel):
    stages: List[PipelineStage]


@router.post("/")
async def create_tenant(payload: TenantCreateRequest):
    tenant = Tenant(
        company_name=payload.company_name,
        company_type=payload.company_type,
        gstin=payload.gstin,
        pan_number=payload.pan_number,
        state_code=payload.state_code,
        state_name=payload.state_name,
        email=payload.email,
        phone=payload.phone,
        address=payload.address,
        city=payload.city,
        pincode=payload.pincode,
        bank_details=payload.bank_details or BankDetails(),
        pipeline_stages=get_default_pipeline_stages()
    )
    await tenant.insert()
    return tenant


@router.get("/{tenant_id}")
async def get_tenant(tenant_id: str):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"_id": tenant_id}]})
    if not tenant:
        # Return fallback default tenant if not created yet
        tenant = Tenant(
            company_name="Apex Machineries Pvt Ltd",
            company_type="manufacturing",
            gstin="24ABCDE1234F1Z5",
            state_code="24",
            state_name="Gujarat",
            address="Plot 42, GIDC Industrial Estate",
            city="Ahmedabad",
            phone="+919876543210",
            email="sales@apexmachineries.com",
            pipeline_stages=get_default_pipeline_stages()
        )
    return tenant


@router.get("/{tenant_id}/stages")
async def get_pipeline_stages(tenant_id: str):
    """
    Returns the custom pipeline stages configured by this company.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"_id": tenant_id}]})
    
    if not tenant or not tenant.pipeline_stages:
        return {"status": "success", "stages": get_default_pipeline_stages()}

    return {"status": "success", "stages": sorted(tenant.pipeline_stages, key=lambda s: s.order)}


@router.put("/{tenant_id}/stages")
async def update_pipeline_stages(tenant_id: str, payload: UpdatePipelineStagesRequest):
    """
    Allows the company to customize, rename, reorder, add or delete pipeline stages.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"_id": tenant_id}]})
    
    if not tenant:
        tenant = Tenant(
            company_name="Apex Machineries Pvt Ltd",
            company_type="manufacturing",
            gstin="24ABCDE1234F1Z5",
            state_code="24",
            state_name="Gujarat",
            address="Plot 42, GIDC Industrial Estate",
            city="Ahmedabad",
            phone="+919876543210",
            email="sales@apexmachineries.com"
        )
        await tenant.insert()

    # Normalize order
    for idx, stage in enumerate(payload.stages):
        stage.order = idx
        if not stage.id:
            stage.id = stage.label.upper().replace(" ", "_")

    tenant.pipeline_stages = payload.stages
    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": "Pipeline stages updated successfully",
        "stages": tenant.pipeline_stages
    }


class UpdateTenantProfileRequest(BaseModel):
    company_name: Optional[str] = None
    company_type: Optional[str] = None
    gstin: Optional[str] = None
    pan_number: Optional[str] = None
    state_code: Optional[str] = None
    state_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    bank_details: Optional[BankDetails] = None


class UpdateIntegrationsRequest(BaseModel):
    integrations: Dict[str, Any]


@router.get("/{tenant_id}/integrations")
async def get_tenant_integrations(tenant_id: str):
    """
    Returns full integration settings and credentials for the company.
    Auto-generates security keys if missing.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    updated = False
    if not tenant.integrations.website.webhook_token:
        from app.models.tenant import generate_webhook_token
        tenant.integrations.website.webhook_token = generate_webhook_token()
        updated = True
    if not tenant.integrations.website.secret_key:
        from app.models.tenant import generate_secret_key
        tenant.integrations.website.secret_key = generate_secret_key()
        updated = True

    if updated:
        tenant.updated_at = datetime.utcnow()
        await tenant.save()

    return {
        "status": "success",
        "company_name": tenant.company_name,
        "tenant_id": str(tenant.id),
        "integrations": tenant.integrations.model_dump()
    }


@router.post("/{tenant_id}/integrations/regenerate-keys")
async def regenerate_integration_keys(tenant_id: str, provider: str = "website"):
    """
    Regenerates public webhook token and private secret key for website integration.
    Instantly invalidates old tokens in case of a leak or spam attack.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    from app.models.tenant import generate_webhook_token, generate_secret_key
    if provider == "website":
        new_token = generate_webhook_token()
        new_secret = generate_secret_key()
        tenant.integrations.website.webhook_token = new_token
        tenant.integrations.website.secret_key = new_secret
        tenant.updated_at = datetime.utcnow()
        await tenant.save()
        return {
            "status": "success",
            "message": "Website integration tokens regenerated successfully. Update your forms and scripts.",
            "webhook_token": new_token,
            "secret_key": new_secret
        }
    raise HTTPException(status_code=400, detail=f"Unsupported provider '{provider}' for key regeneration")


@router.put("/{tenant_id}/integrations")
async def update_tenant_integrations(tenant_id: str, payload: UpdateIntegrationsRequest):
    """
    Company Admin saves their API credentials for IndiaMART, Facebook, TradeIndia, Justdial, and Website.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    cur_dict = tenant.integrations.model_dump()
    for provider, conf in payload.integrations.items():
        if provider in cur_dict and isinstance(conf, dict):
            cur_dict[provider].update(conf)

    from app.models.tenant import TenantIntegrations
    tenant.integrations = TenantIntegrations(**cur_dict)
    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": "Lead integrations updated successfully",
        "integrations": tenant.integrations.model_dump()
    }


@router.put("/{tenant_id}/profile")
async def update_tenant_profile(tenant_id: str, payload: UpdateTenantProfileRequest):
    """
    Company Admin updates their GST, address, and bank details.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(tenant, k, v)

    tenant.updated_at = datetime.utcnow()
    await tenant.save()

    return {
        "status": "success",
        "message": "Company profile updated successfully",
        "tenant": tenant
    }


@router.get("/{tenant_id}/custom-fields")
async def get_custom_fields(tenant_id: str, entity_type: str = "lead"):
    fields = await CustomFieldDefinition.find(
        CustomFieldDefinition.tenant_id == tenant_id,
        CustomFieldDefinition.entity_type == entity_type
    ).sort("display_order").to_list()
    return fields


@router.post("/{tenant_id}/custom-fields")
async def add_custom_field(tenant_id: str, payload: CustomFieldCreateRequest):
    field_def = CustomFieldDefinition(
        tenant_id=tenant_id,
        entity_type=payload.entity_type,
        field_key=payload.field_key,
        field_label=payload.field_label,
        field_type=payload.field_type,
        options=payload.options,
        is_required=payload.is_required
    )
    await field_def.insert()
    return field_def

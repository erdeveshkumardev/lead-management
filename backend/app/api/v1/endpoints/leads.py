from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query
from app.core.database import get_document_by_id
from app.models.tenant import Tenant
from app.models.lead import Lead, TimelineItem
from app.models.user import User
from app.schemas.lead import (
    LeadCreateRequest,
    LeadUpdateRequest,
    LeadAddActivityRequest,
    LeadStageUpdateRequest,
    LeadCategoryUpdateRequest,
)
from pydantic import BaseModel
from app.services.lead_service import process_and_save_lead
from app.services.adapters.base import StandardLeadDTO

router = APIRouter(prefix="/leads", tags=["Leads CRM"])


class LeadAssignRequest(BaseModel):
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    note: Optional[str] = None
    assigned_by_id: Optional[str] = None
    assigned_by_name: Optional[str] = None


@router.get("/")
async def list_leads(
    tenant_id: str,
    stage: Optional[str] = None,
    source: Optional[str] = None,
    category: Optional[str] = None,
    assigned_to: Optional[str] = None,
    date_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"slug": tenant_id}]})
    
    # Strict Multi-Tenant Isolation
    if tenant:
        allowed_ids = [str(tenant.id)]
        if tenant.slug in ["apex-machineries", "demo_tenant_01"]:
            allowed_ids.append("demo_tenant_01")
        query: Dict[str, Any] = {"tenant_id": {"$in": allowed_ids}}
    else:
        query = {"tenant_id": tenant_id}

    if stage and stage != "all":
        query["stage"] = stage
    if source and source != "all":
        query["source"] = source.lower()
    if category and category != "all":
        query["category"] = category.upper()
    if assigned_to and assigned_to != "all":
        if assigned_to == "unassigned":
            query["$or"] = [
                {"assigned_to_user_id": None},
                {"assigned_to_user_id": {"$exists": False}},
                {"assigned_to_user_id": ""}
            ]
        else:
            query["assigned_to_user_id"] = assigned_to
    if search:
        query["$or"] = [
            {"full_name": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
            {"company_name": {"$regex": search, "$options": "i"}},
            {"product_inquired": {"$regex": search, "$options": "i"}},
        ]

    # Date filter
    now = datetime.utcnow()
    date_query: Dict[str, Any] = {}
    if date_filter == "today":
        date_query["$gte"] = datetime(now.year, now.month, now.day, 0, 0, 0)
    elif date_filter == "last_7_days":
        date_query["$gte"] = now - timedelta(days=7)
    elif date_filter == "last_30_days":
        date_query["$gte"] = now - timedelta(days=30)
    elif date_filter == "custom":
        if start_date:
            try:
                date_query["$gte"] = datetime.fromisoformat(start_date)
            except Exception:
                pass
        if end_date:
            try:
                ed = datetime.fromisoformat(end_date)
                date_query["$lte"] = datetime(ed.year, ed.month, ed.day, 23, 59, 59, 999999)
            except Exception:
                pass
    if date_query:
        query["created_at"] = date_query

    leads = await Lead.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    total = await Lead.find(query).count()
    return {"total": total, "items": leads}


@router.get("/kanban")
async def get_kanban_board(
    tenant_id: str,
    date_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """
    Returns leads grouped dynamically by the company's custom pipeline stages.
    Supports date filtering: today, last_7_days, last_30_days, or custom date ranges.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"_id": tenant_id}]})

    if tenant and tenant.pipeline_stages:
        sorted_stages = sorted(tenant.pipeline_stages, key=lambda s: s.order)
        stage_list = [s.id for s in sorted_stages]
    else:
        stage_list = ["NEW", "CONTACTED", "DEMO_SCHEDULED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"]

    kanban = {s: [] for s in stage_list}
    default_stage = stage_list[0] if stage_list else "NEW"

    query: Dict[str, Any] = {}
    if tenant:
        allowed_ids = [str(tenant.id)]
        if tenant.slug in ["apex-machineries", "demo_tenant_01"]:
            allowed_ids.append("demo_tenant_01")
        query["tenant_id"] = {"$in": allowed_ids}
    else:
        query["tenant_id"] = tenant_id

    # Date filtering
    now = datetime.utcnow()
    date_query: Dict[str, Any] = {}
    if date_filter == "today":
        start_of_day = datetime(now.year, now.month, now.day, 0, 0, 0)
        date_query["$gte"] = start_of_day
    elif date_filter == "last_7_days":
        date_query["$gte"] = now - timedelta(days=7)
    elif date_filter == "last_30_days":
        date_query["$gte"] = now - timedelta(days=30)
    elif date_filter == "custom":
        if start_date:
            try:
                date_query["$gte"] = datetime.fromisoformat(start_date)
            except Exception:
                pass
        if end_date:
            try:
                ed = datetime.fromisoformat(end_date)
                date_query["$lte"] = datetime(ed.year, ed.month, ed.day, 23, 59, 59, 999999)
            except Exception:
                pass

    if date_query:
        query["created_at"] = date_query

    leads = await Lead.find(query).sort("-created_at").to_list()
    for lead in leads:
        current_stage = lead.stage if lead.stage in kanban else default_stage
        kanban[current_stage].append(lead)

    return kanban


@router.post("/")
async def create_lead_manual(tenant_id: str, payload: LeadCreateRequest):
    dto = StandardLeadDTO(
        tenant_id=tenant_id,
        source=payload.source,
        full_name=payload.full_name,
        phone=payload.phone,
        email=payload.email,
        company_name=payload.company_name,
        city=payload.city,
        state=payload.state,
        pincode=payload.pincode,
        address=payload.address,
        gstin=payload.gstin,
        product_inquired=payload.product_inquired,
        inquiry_message=payload.inquiry_message,
        deal_value=payload.deal_value,
        custom_fields=payload.custom_fields,
        raw_payload={"source": "manual_entry"}
    )
    lead, is_duplicate = await process_and_save_lead(dto)
    return {"lead": lead, "is_duplicate": is_duplicate}


@router.get("/{lead_id}")
async def get_lead(lead_id: str, tenant_id: str):
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/{lead_id}")
async def update_lead(lead_id: str, tenant_id: str, payload: LeadUpdateRequest):
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Lead not found")

    update_dict = payload.model_dump(exclude_unset=True)
    if not update_dict:
        return lead

    for k, v in update_dict.items():
        if k == "custom_fields" and v:
            lead.custom_fields.update(v)
        else:
            setattr(lead, k, v)

    lead.updated_at = datetime.utcnow()
    await lead.save()
    return lead


@router.post("/{lead_id}/stage")
async def update_lead_stage(lead_id: str, tenant_id: str, payload: LeadStageUpdateRequest):
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Lead not found")

    old_stage = lead.stage
    lead.stage = payload.stage
    lead.updated_at = datetime.utcnow()

    # Log to activity timeline
    note = f"Stage changed from {old_stage} to {payload.stage}"
    if payload.note:
        note += f". Note: {payload.note}"

    lead.timeline.append(
        TimelineItem(
            activity_type="STAGE_CHANGE",
            note=note,
            performed_by_id="USER",
            performed_by_name="Agent"
        )
    )
    await lead.save()
    return {"status": "success", "lead": lead}


@router.post("/{lead_id}/category")
async def update_lead_category(lead_id: str, tenant_id: str, payload: LeadCategoryUpdateRequest):
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Lead not found")

    old_cat = getattr(lead, "category", "WARM")
    lead.category = payload.category.upper()
    lead.updated_at = datetime.utcnow()

    note = f"Lead priority category changed from {old_cat} to {payload.category.upper()}"
    if payload.note:
        note += f". Note: {payload.note}"

    lead.timeline.append(
        TimelineItem(
            activity_type="CATEGORY_CHANGE",
            note=note,
            performed_by_id="USER",
            performed_by_name="Agent"
        )
    )
    await lead.save()
    return {"status": "success", "lead": lead}


@router.post("/{lead_id}/activity")
async def add_lead_activity(lead_id: str, tenant_id: str, payload: LeadAddActivityRequest):
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Lead not found")

    item = TimelineItem(
        activity_type=payload.activity_type,
        note=payload.note,
        performed_by_id="USER",
        performed_by_name="Sales Rep",
        metadata=payload.metadata
    )
    lead.timeline.append(item)
    lead.updated_at = datetime.utcnow()
    await lead.save()
    return {"status": "success", "lead": lead}


@router.post("/{lead_id}/assign")
async def assign_lead(lead_id: str, tenant_id: str, payload: LeadAssignRequest):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"slug": tenant_id}]})

    lead = await get_document_by_id(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Tenant verification with alias support
    if tenant:
        allowed_ids = [str(tenant.id)]
        if tenant.slug in ["apex-machineries", "demo_tenant_01"] or tenant_id == "demo_tenant_01":
            allowed_ids.append("demo_tenant_01")
        if lead.tenant_id not in allowed_ids and lead.tenant_id != tenant_id:
            raise HTTPException(status_code=403, detail="Unauthorized access to lead")

    assigned_by = payload.assigned_by_name or "Admin / Manager"

    if payload.user_id and payload.user_id not in ["unassigned", "none", ""]:
        user = await get_document_by_id(User, payload.user_id)
        if not user and payload.user_name:
            user = await User.find_one(User.full_name == payload.user_name)
        if not user:
            raise HTTPException(status_code=404, detail="Staff member not found")

        old_assignee = lead.assigned_to_user_name or "Unassigned"
        lead.assigned_to_user_id = str(user.id)
        lead.assigned_to_user_name = user.full_name

        # Increment assigned leads count for this user
        user.assigned_leads_count = (user.assigned_leads_count or 0) + 1
        await user.save()

        role_label = user.role.replace('_', ' ').title()
        timeline_note = f"Lead assigned to {user.full_name} ({role_label}"
        if getattr(user, 'designation', None):
            timeline_note += f" - {user.designation}"
        timeline_note += f") by {assigned_by}"
        if payload.note:
            timeline_note += f". Note: {payload.note}"

        lead.timeline.append(
            TimelineItem(
                activity_type="ASSIGNMENT",
                note=timeline_note,
                performed_by_id=payload.assigned_by_id or "ADMIN",
                performed_by_name=assigned_by
            )
        )
    else:
        # Unassign lead
        old_assignee = lead.assigned_to_user_name or "Staff"
        lead.assigned_to_user_id = None
        lead.assigned_to_user_name = None

        timeline_note = f"Lead unassigned from {old_assignee} by {assigned_by}"
        if payload.note:
            timeline_note += f". Note: {payload.note}"

        lead.timeline.append(
            TimelineItem(
                activity_type="ASSIGNMENT",
                note=timeline_note,
                performed_by_id=payload.assigned_by_id or "ADMIN",
                performed_by_name=assigned_by
            )
        )

    lead.updated_at = datetime.utcnow()
    await lead.save()
    return {
        "status": "success",
        "message": f"Lead assigned successfully to {lead.assigned_to_user_name or 'Unassigned'}",
        "lead": lead
    }

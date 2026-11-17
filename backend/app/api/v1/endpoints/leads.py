from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Query
from app.core.database import get_document_by_id
from app.models.tenant import Tenant
from app.models.lead import Lead, TimelineItem, FollowUpItem
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
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/leads", tags=["Leads CRM"])


class LeadAssignRequest(BaseModel):
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    note: Optional[str] = None
    assigned_by_id: Optional[str] = None
    assigned_by_name: Optional[str] = None


class ScheduleFollowUpRequest(BaseModel):
    scheduled_at: str  # ISO string e.g. "2026-11-17T11:00:00"
    follow_up_type: str = "call"  # "call", "whatsapp", "meeting", "email", "site_visit"
    note: str
    user_id: Optional[str] = None
    user_name: Optional[str] = None


class CompleteFollowUpRequest(BaseModel):
    note: Optional[str] = None
    completed_by_id: Optional[str] = None
    completed_by_name: Optional[str] = None


@router.get("/")
async def list_leads(
    tenant_id: str,
    stage: Optional[str] = None,
    source: Optional[str] = None,
    category: Optional[str] = None,
    assigned_to: Optional[str] = None,
    follow_up_filter: Optional[str] = None,
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

    # Follow-up Filtering
    now = datetime.utcnow()
    ist_offset = timedelta(hours=5, minutes=30)
    now_ist = now + ist_offset
    start_today_ist = datetime(now_ist.year, now_ist.month, now_ist.day) - ist_offset
    end_today_ist = start_today_ist + timedelta(days=1) - timedelta(microseconds=1)

    if follow_up_filter == "today":
        query["next_follow_up.scheduled_at"] = {"$gte": start_today_ist, "$lte": end_today_ist}
        query["next_follow_up.status"] = "PENDING"
    elif follow_up_filter == "overdue":
        query["next_follow_up.scheduled_at"] = {"$lt": start_today_ist}
        query["next_follow_up.status"] = "PENDING"
    elif follow_up_filter == "upcoming":
        query["next_follow_up.scheduled_at"] = {"$gt": end_today_ist}
        query["next_follow_up.status"] = "PENDING"
    elif follow_up_filter in ["has_followup", "followup"]:
        query["next_follow_up"] = {"$ne": None}

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
    assigned_to: Optional[str] = None,
    date_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """
    Returns leads grouped dynamically by the company's custom pipeline stages.
    Supports staff isolation (assigned_to) and date filtering.
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

    if assigned_to and assigned_to != "all":
        if assigned_to == "unassigned":
            query["$or"] = [
                {"assigned_to_user_id": None},
                {"assigned_to_user_id": {"$exists": False}},
                {"assigned_to_user_id": ""}
            ]
        else:
            query["assigned_to_user_id"] = assigned_to

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


@router.get("/followups/summary")
async def get_followups_summary(
    tenant_id: str,
    assigned_to: Optional[str] = None
):
    """
    Returns counts and top leads for Today, Overdue, and Upcoming follow-ups.
    Supports staff isolation filtering by assigned_to.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"slug": tenant_id}]})

    if tenant:
        allowed_ids = [str(tenant.id)]
        if tenant.slug in ["apex-machineries", "demo_tenant_01"] or tenant_id == "demo_tenant_01":
            allowed_ids.append("demo_tenant_01")
        query: Dict[str, Any] = {"tenant_id": {"$in": allowed_ids}}
    else:
        query = {"tenant_id": tenant_id}

    if assigned_to and assigned_to != "all":
        query["assigned_to_user_id"] = assigned_to

    now = datetime.utcnow()
    ist_offset = timedelta(hours=5, minutes=30)
    now_ist = now + ist_offset
    start_today_ist = datetime(now_ist.year, now_ist.month, now_ist.day) - ist_offset
    end_today_ist = start_today_ist + timedelta(days=1) - timedelta(microseconds=1)

    base_query = {**query, "next_follow_up.status": "PENDING"}

    # Overdue Follow-ups (scheduled before start of today IST)
    overdue_q = {**base_query, "next_follow_up.scheduled_at": {"$lt": start_today_ist}}
    overdue_leads = await Lead.find(overdue_q).sort("next_follow_up.scheduled_at").limit(20).to_list()
    overdue_count = await Lead.find(overdue_q).count()

    # Today's Follow-ups (scheduled between start and end of today IST)
    today_q = {**base_query, "next_follow_up.scheduled_at": {"$gte": start_today_ist, "$lte": end_today_ist}}
    today_leads = await Lead.find(today_q).sort("next_follow_up.scheduled_at").limit(20).to_list()
    today_count = await Lead.find(today_q).count()

    # Upcoming Follow-ups (scheduled after end of today IST)
    upcoming_q = {**base_query, "next_follow_up.scheduled_at": {"$gt": end_today_ist}}
    upcoming_leads = await Lead.find(upcoming_q).sort("next_follow_up.scheduled_at").limit(20).to_list()
    upcoming_count = await Lead.find(upcoming_q).count()

    return {
        "today_count": today_count,
        "overdue_count": overdue_count,
        "upcoming_count": upcoming_count,
        "total_active": today_count + overdue_count + upcoming_count,
        "today_leads": today_leads,
        "overdue_leads": overdue_leads,
        "upcoming_leads": upcoming_leads
    }


async def verify_lead_tenant_access(lead: Optional[Lead], tenant_id: str) -> bool:
    if not lead:
        return False
    if lead.tenant_id == tenant_id:
        return True
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"slug": tenant_id}]})
    allowed_ids = [tenant_id]
    if tenant:
        allowed_ids.append(str(tenant.id))
        if tenant.slug in ["apex-machineries", "demo_tenant_01"] or tenant_id == "demo_tenant_01":
            allowed_ids.append("demo_tenant_01")
    return lead.tenant_id in allowed_ids


@router.get("/{lead_id}")
async def get_lead(lead_id: str, tenant_id: str):
    lead = await get_document_by_id(Lead, lead_id)
    if not await verify_lead_tenant_access(lead, tenant_id):
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/{lead_id}")
async def update_lead(lead_id: str, tenant_id: str, payload: LeadUpdateRequest):
    lead = await get_document_by_id(Lead, lead_id)
    if not await verify_lead_tenant_access(lead, tenant_id):
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
    if not await verify_lead_tenant_access(lead, tenant_id):
        raise HTTPException(status_code=404, detail="Lead not found")

    old_stage = lead.stage
    lead.stage = payload.stage
    now = datetime.utcnow()
    lead.updated_at = now

    # Log to activity timeline
    stage_display = payload.stage.replace('_', ' ').title()
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

    # AUTO-RESOLVE ACTIVE / OVERDUE FOLLOW-UP:
    # When user takes an action such as sending a proposal or advancing stage,
    # any pending/overdue follow-up up to now is automatically marked completed!
    for f in lead.follow_ups:
        if f.status == "PENDING" and f.scheduled_at <= now:
            f.status = "COMPLETED"
            f.completed_at = now
            f.completion_note = f"Auto-resolved: Stage moved to {stage_display}"

    # Only future follow-ups scheduled strictly after now remain pending
    remaining = [f for f in lead.follow_ups if f.status == "PENDING" and f.scheduled_at > now]
    if remaining:
        remaining.sort(key=lambda x: x.scheduled_at)
        lead.next_follow_up = remaining[0]
    else:
        lead.next_follow_up = None

    await lead.save()
    return {"status": "success", "lead": lead}


@router.post("/{lead_id}/category")
async def update_lead_category(lead_id: str, tenant_id: str, payload: LeadCategoryUpdateRequest):
    lead = await get_document_by_id(Lead, lead_id)
    if not await verify_lead_tenant_access(lead, tenant_id):
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
    if not await verify_lead_tenant_access(lead, tenant_id):
        raise HTTPException(status_code=404, detail="Lead not found")

    now = datetime.utcnow()
    item = TimelineItem(
        activity_type=payload.activity_type,
        note=payload.note,
        performed_by_id="USER",
        performed_by_name="Sales Rep",
        metadata=payload.metadata
    )
    lead.timeline.append(item)

    # AUTO-RESOLVE ACTIVE / OVERDUE FOLLOW-UP:
    # Interaction was performed (e.g. Call logged, WhatsApp sent, Notes taken)
    for f in lead.follow_ups:
        if f.status == "PENDING" and f.scheduled_at <= now:
            f.status = "COMPLETED"
            f.completed_at = now
            f.completion_note = f"Auto-resolved: Action logged ({payload.activity_type}) - {payload.note}"

    # Only future follow-ups scheduled strictly after now remain pending
    remaining = [f for f in lead.follow_ups if f.status == "PENDING" and f.scheduled_at > now]
    if remaining:
        remaining.sort(key=lambda x: x.scheduled_at)
        lead.next_follow_up = remaining[0]
    else:
        lead.next_follow_up = None

    lead.updated_at = now
    await lead.save()
    return {"status": "success", "lead": lead}


@router.post("/{lead_id}/assign")
async def assign_lead(lead_id: str, tenant_id: str, payload: LeadAssignRequest):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"slug": tenant_id}]})

    lead = await get_document_by_id(Lead, lead_id)
    if not lead or not await verify_lead_tenant_access(lead, tenant_id):
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

        if user.role in ["company_admin", "super_admin"]:
            raise HTTPException(
                status_code=400,
                detail="Company Admin or Super Admin cannot be assigned leads. Leads can only be assigned to Sales Staff and Managers."
            )

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


@router.post("/{lead_id}/followup")
async def schedule_follow_up(lead_id: str, tenant_id: str, payload: ScheduleFollowUpRequest):
    """
    Schedule a follow-up (Call, WhatsApp, Meeting, Email, Visit) for this lead.
    Sets next_follow_up, records in follow_ups array, and adds to CRM activity timeline.
    """
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or not await verify_lead_tenant_access(lead, tenant_id):
        raise HTTPException(status_code=404, detail="Lead not found")

    try:
        raw_dt = payload.scheduled_at.replace("Z", "+00:00")
        sched_dt = datetime.fromisoformat(raw_dt)
        if sched_dt.tzinfo is not None:
            sched_dt = sched_dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid scheduled_at datetime format: {e}")

    import uuid
    followup_item = FollowUpItem(
        id=str(uuid.uuid4())[:8],
        scheduled_at=sched_dt,
        follow_up_type=payload.follow_up_type.lower(),
        note=payload.note,
        status="PENDING",
        assigned_to_user_id=payload.user_id or lead.assigned_to_user_id,
        assigned_to_user_name=payload.user_name or lead.assigned_to_user_name,
        created_at=datetime.utcnow()
    )

    lead.next_follow_up = followup_item
    lead.follow_ups.append(followup_item)
    lead.updated_at = datetime.utcnow()

    type_labels = {
        "call": "📞 Phone Call",
        "whatsapp": "💬 WhatsApp Message",
        "meeting": "👥 Direct Meeting",
        "email": "✉️ Email Follow-up",
        "site_visit": "🏢 Site Visit"
    }
    type_display = type_labels.get(payload.follow_up_type.lower(), payload.follow_up_type.title())

    timeline_note = f"Follow-up scheduled: {type_display} on {payload.scheduled_at}. Note: {payload.note}"
    lead.timeline.append(
        TimelineItem(
            activity_type="FOLLOWUP_SCHEDULED",
            note=timeline_note,
            performed_by_id=payload.user_id or "STAFF",
            performed_by_name=payload.user_name or lead.assigned_to_user_name or "Sales Team"
        )
    )

    await lead.save()
    return {"status": "success", "message": "Follow-up scheduled successfully", "lead": lead}


@router.post("/{lead_id}/followup/complete")
async def complete_follow_up(lead_id: str, tenant_id: str, payload: CompleteFollowUpRequest):
    """
    Mark an active follow-up as completed, update timestamps, and record notes.
    """
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or not await verify_lead_tenant_access(lead, tenant_id):
        raise HTTPException(status_code=404, detail="Lead not found")

    now = datetime.utcnow()
    comp_by = payload.completed_by_name or lead.assigned_to_user_name or "Sales Staff"

    if lead.next_follow_up:
        lead.next_follow_up.status = "COMPLETED"
        lead.next_follow_up.completed_at = now
        lead.next_follow_up.completion_note = payload.note or "Completed"

    completed_any = False
    for f in lead.follow_ups:
        if f.status == "PENDING" and f.scheduled_at <= now:
            f.status = "COMPLETED"
            f.completed_at = now
            f.completion_note = payload.note or "Completed"
            completed_any = True

    if not completed_any:
        for f in lead.follow_ups:
            if f.status == "PENDING":
                f.status = "COMPLETED"
                f.completed_at = now
                f.completion_note = payload.note or "Completed"
                break

    remaining = [f for f in lead.follow_ups if f.status == "PENDING"]
    if remaining:
        remaining.sort(key=lambda x: x.scheduled_at)
        lead.next_follow_up = remaining[0]
    else:
        lead.next_follow_up = None

    timeline_note = f"Follow-up marked as COMPLETED by {comp_by}"
    if payload.note:
        timeline_note += f". Completion remarks: {payload.note}"

    lead.timeline.append(
        TimelineItem(
            activity_type="FOLLOWUP_COMPLETED",
            note=timeline_note,
            performed_by_id=payload.completed_by_id or "STAFF",
            performed_by_name=comp_by
        )
    )
    lead.updated_at = now
    await lead.save()
    return {"status": "success", "message": "Follow-up marked as completed", "lead": lead}


@router.post("/send-followup-whatsapp-alerts")
async def send_followup_whatsapp_alerts(
    tenant_id: str,
    staff_user_id: Optional[str] = None
):
    """
    Scans all pending follow-ups for the company, groups them by staff member,
    and dispatches a WhatsApp notification to each staff member with pending count & preview.
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    target_tenant_id = str(tenant.id)
    allowed_ids = [target_tenant_id]
    if tenant.slug in ["apex-machineries", "demo_tenant_01"] or tenant_id == "demo_tenant_01":
        allowed_ids.append("demo_tenant_01")

    # Fetch all leads with pending next follow-up
    query: Dict[str, Any] = {
        "tenant_id": {"$in": allowed_ids},
        "next_follow_up.status": "PENDING"
    }
    if staff_user_id:
        query["assigned_to_user_id"] = staff_user_id

    leads = await Lead.find(query).to_list()
    if not leads:
        return {
            "status": "success",
            "message": "No pending follow-ups found for alerting.",
            "total_staff_notified": 0,
            "total_pending_leads": 0,
            "results": []
        }

    # Group leads by assigned_to_user_id
    staff_leads_map: Dict[str, List[Lead]] = {}
    unassigned_leads: List[Lead] = []

    for l in leads:
        uid = l.assigned_to_user_id
        if uid:
            staff_leads_map.setdefault(uid, []).append(l)
        else:
            unassigned_leads.append(l)

    results = []
    notified_count = 0

    for uid, staff_leads in staff_leads_map.items():
        staff_user = await get_document_by_id(User, uid)
        if not staff_user:
            staff_user = await User.find_one({"_id": uid})
        if not staff_user:
            continue

        res = await NotificationService.notify_staff_pending_followups(
            tenant=tenant,
            staff_user=staff_user,
            pending_leads=staff_leads
        )
        results.append({
            "staff_id": uid,
            "staff_name": staff_user.full_name,
            "phone": staff_user.whatsapp_number or staff_user.phone,
            "pending_count": len(staff_leads),
            "status": res.get("status"),
            "whatsapp_link": res.get("whatsapp_link"),
            "message": res.get("message")
        })
        if res.get("status") in ["success", "simulated"]:
            notified_count += 1

    return {
        "status": "success",
        "message": f"WhatsApp follow-up reminders processed for {notified_count} staff member(s).",
        "total_staff_notified": notified_count,
        "total_pending_leads": len(leads),
        "unassigned_pending_leads": len(unassigned_leads),
        "results": results
    }



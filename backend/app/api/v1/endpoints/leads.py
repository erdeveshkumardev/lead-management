"""
Leads CRM. The tenant always comes from the verified session; users without 'leads_view_all'
can only see and change leads assigned to them. Every change is attributed to the real user.
"""
import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.core import rate_limiter
from app.core.audit import audit
from app.core.config import settings
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_current_user, require_permission, resolve_tenant_id, scoped_assignee
from app.core.gst import gstin_error, normalize_gstin, resolve_state_code, state_name
from app.core.timeutil import local_day_bounds_utc, local_today, parse_client_date, parse_client_datetime
from app.core.validators import clean_text, safe_regex, sanitize_flat_dict
from app.models.lead import FollowUpItem, Lead, TimelineItem
from app.models.masters import CompanyMasters
from app.models.tenant import Tenant, get_default_pipeline_stages
from app.models.user import User
from app.schemas.lead import (
    ACTIVITY_TYPES, FOLLOW_UP_TYPES, PRIORITIES, BulkAssignRequest, CompleteFollowUpRequest, LeadAddActivityRequest,
    LeadAssignRequest, LeadCategoryUpdateRequest, LeadCreateRequest, LeadStageUpdateRequest, LeadUpdateRequest,
    ScheduleFollowUpRequest, SimulateLeadRequest,
)
from app.services import csv_service
from app.services.adapters.base import StandardLeadDTO
from app.services.adapters.facebook import FacebookAdapter
from app.services.adapters.indiamart import IndiaMARTAdapter
from app.services.adapters.website import WebsiteAdapter
from app.services.lead_service import (
    ASSIGNABLE_ROLES, adjust_assignment_counts, append_timeline, find_lead_summaries, lead_base_query, mutate_lead,
    normalize_email, normalize_phone_number, process_and_save_lead, refresh_follow_ups, serialize_lead,
)
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/leads", tags=["Leads CRM"])

KANBAN_PER_STAGE = 300
MAX_PAGE_SIZE = 200
MAX_IMPORT_BYTES = 5 * 1024 * 1024
FOLLOW_UP_LABELS = {"call": "Phone Call", "whatsapp": "WhatsApp Message", "meeting": "Direct Meeting",
                    "email": "Email Follow-up", "site_visit": "Site Visit"}


# ----------------------------------------------------------------- helpers
async def _tenant(tid: str) -> Tenant:
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant


def _stage_ids(tenant: Tenant) -> List[str]:
    stages = tenant.pipeline_stages or get_default_pipeline_stages()
    return [s.id for s in sorted(stages, key=lambda s: s.order)]


def _can_access(ctx: AuthContext, lead: Lead) -> bool:
    return ctx.has("leads_view_all") or lead.assigned_to_user_id == ctx.user_id


async def _load_lead(ctx: AuthContext, lead_id: str, tenant_id: Optional[str] = None) -> Lead:
    tid = await resolve_tenant_id(ctx, tenant_id)
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tid or lead.is_deleted or not _can_access(ctx, lead):
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


def _apply_assignee_filter(query: Dict[str, Any], assignee: Optional[str]) -> None:
    if assignee == "unassigned":
        query["assigned_to_user_id"] = {"$in": [None, ""]}
    elif assignee:
        query["assigned_to_user_id"] = assignee


def _apply_date_filter(query: Dict[str, Any], date_filter: Optional[str], start_date: Optional[str], end_date: Optional[str]) -> None:
    created: Dict[str, Any] = {}
    today_start, _ = local_day_bounds_utc()
    if date_filter == "today":
        created["$gte"] = today_start
    elif date_filter == "last_7_days":
        created["$gte"] = today_start - timedelta(days=6)
    elif date_filter == "last_30_days":
        created["$gte"] = today_start - timedelta(days=29)
    elif date_filter == "custom":
        try:
            if start_date:
                created["$gte"] = local_day_bounds_utc(parse_client_date(start_date))[0]
            if end_date:
                created["$lte"] = local_day_bounds_utc(parse_client_date(end_date))[1]
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be in YYYY-MM-DD format.")
    if created:
        query["created_at"] = created


def _apply_follow_up_filter(query: Dict[str, Any], follow_up_filter: Optional[str]) -> None:
    start, end = local_day_bounds_utc()
    if follow_up_filter == "today":
        query["next_follow_up.status"] = "PENDING"
        query["next_follow_up.scheduled_at"] = {"$gte": start, "$lte": end}
    elif follow_up_filter == "overdue":
        query["next_follow_up.status"] = "PENDING"
        query["next_follow_up.scheduled_at"] = {"$lt": start}
    elif follow_up_filter == "upcoming":
        query["next_follow_up.status"] = "PENDING"
        query["next_follow_up.scheduled_at"] = {"$gt": end}
    elif follow_up_filter in ("has_followup", "followup"):
        query["next_follow_up.status"] = "PENDING"


def _build_list_query(
    ctx: AuthContext, tid: str, *, stage: Optional[str] = None, source: Optional[str] = None,
    category: Optional[str] = None, assigned_to: Optional[str] = None, follow_up_filter: Optional[str] = None,
    date_filter: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    query = lead_base_query(tid)
    if stage and stage != "all":
        query["stage"] = stage[:40]
    if source and source != "all":
        query["source"] = source.lower()[:30]
    if category and category != "all":
        query["category"] = category.upper()[:20]
    _apply_assignee_filter(query, scoped_assignee(ctx, assigned_to))
    _apply_follow_up_filter(query, follow_up_filter)
    _apply_date_filter(query, date_filter, start_date, end_date)
    term = (search or "").strip()
    if term:
        pattern = {"$regex": safe_regex(term), "$options": "i"}
        query["$and"] = [{"$or": [{"full_name": pattern}, {"phone": pattern}, {"company_name": pattern},
                                  {"product_inquired": pattern}, {"email": pattern}]}]
    return query


def _actor(ctx: AuthContext) -> Dict[str, str]:
    return {"performed_by_id": ctx.user_id, "performed_by_name": ctx.display_name}


async def _team_member(tid: str, user_id: str, assignable: bool = False) -> User:
    user = await get_document_by_id(User, user_id)
    if not user or user.tenant_id != tid or not user.is_active:
        raise HTTPException(status_code=404, detail="Team member not found or inactive")
    if assignable and user.role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Company Admin cannot be assigned leads. Leads can only be assigned to Sales Staff and Managers.",
        )
    return user


async def _valid_categories(tenant: Tenant) -> List[str]:
    masters = {**CompanyMasters().model_dump(), **(tenant.company_masters or {})}
    ids = [str(c.get("id", "")).upper() for c in masters.get("lead_categories", []) if isinstance(c, dict)]
    return [i for i in ids if i] or ["HOT", "WARM", "COLD"]


# ----------------------------------------------------------------- listing
@router.get("/")
async def list_leads(
    tenant_id: Optional[str] = None, stage: Optional[str] = None, source: Optional[str] = None,
    category: Optional[str] = None, assigned_to: Optional[str] = None, follow_up_filter: Optional[str] = None,
    date_filter: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None,
    search: Optional[str] = Query(default=None, max_length=100),
    skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
    ctx: AuthContext = Depends(get_current_user),
):
    tid = await resolve_tenant_id(ctx, tenant_id)
    query = _build_list_query(ctx, tid, stage=stage, source=source, category=category, assigned_to=assigned_to,
                              follow_up_filter=follow_up_filter, date_filter=date_filter, start_date=start_date,
                              end_date=end_date, search=search)
    items = await find_lead_summaries(query, skip=skip, limit=limit)
    total = await Lead.get_motor_collection().count_documents(query)
    return {"total": total, "skip": skip, "limit": limit, "items": items}


@router.get("/kanban")
async def get_kanban_board(
    tenant_id: Optional[str] = None, assigned_to: Optional[str] = None, date_filter: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None, ctx: AuthContext = Depends(get_current_user),
):
    """Leads grouped by the company's pipeline stages (most recent leads per stage, bounded per column)."""
    tid = await resolve_tenant_id(ctx, tenant_id)
    stage_list = _stage_ids(await _tenant(tid))
    base = _build_list_query(ctx, tid, assigned_to=assigned_to, date_filter=date_filter, start_date=start_date, end_date=end_date)

    async def column(stage_filter: Any) -> List[Dict[str, Any]]:
        return await find_lead_summaries({**base, "stage": stage_filter}, limit=KANBAN_PER_STAGE)

    columns = await asyncio.gather(*[column(s) for s in stage_list], column({"$nin": stage_list}))
    kanban = {stage: rows for stage, rows in zip(stage_list, columns)}
    orphans = columns[-1]
    if orphans and stage_list:
        kanban[stage_list[0]] = sorted(kanban[stage_list[0]] + orphans, key=lambda d: d.get("created_at") or datetime.min, reverse=True)
    return kanban


@router.get("/followups/summary")
async def get_followups_summary(tenant_id: Optional[str] = None, assigned_to: Optional[str] = None,
                                ctx: AuthContext = Depends(get_current_user)):
    tid = await resolve_tenant_id(ctx, tenant_id)
    base = lead_base_query(tid)
    _apply_assignee_filter(base, scoped_assignee(ctx, assigned_to))
    base["next_follow_up.status"] = "PENDING"
    start, end = local_day_bounds_utc()
    collection = Lead.get_motor_collection()
    sort = [("next_follow_up.scheduled_at", 1)]

    async def bucket(condition: Dict[str, Any]):
        query = {**base, "next_follow_up.scheduled_at": condition}
        return await find_lead_summaries(query, limit=20, sort=sort), await collection.count_documents(query)

    (overdue, overdue_n), (today, today_n), (upcoming, upcoming_n) = await asyncio.gather(
        bucket({"$lt": start}), bucket({"$gte": start, "$lte": end}), bucket({"$gt": end}))
    return {
        "today_count": today_n, "overdue_count": overdue_n, "upcoming_count": upcoming_n,
        "total_active": today_n + overdue_n + upcoming_n,
        "today_leads": today, "overdue_leads": overdue, "upcoming_leads": upcoming,
    }


@router.get("/deleted")
async def list_deleted_leads(skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
                             ctx: AuthContext = Depends(require_permission("leads_delete"))):
    """Recycle bin: soft-deleted leads of the caller's company (most recently deleted first)."""
    tid = await resolve_tenant_id(ctx)
    query: Dict[str, Any] = {"tenant_id": tid, "is_deleted": True}
    if not ctx.has("leads_view_all"):
        query["assigned_to_user_id"] = ctx.user_id
    items = await find_lead_summaries(query, skip=skip, limit=limit, sort=[("deleted_at", -1)])
    total = await Lead.get_motor_collection().count_documents(query)
    return {"total": total, "skip": skip, "limit": limit, "items": items}


# ----------------------------------------------------------------- export / import
@router.get("/export")
async def export_leads_csv(
    tenant_id: Optional[str] = None, stage: Optional[str] = None, source: Optional[str] = None,
    category: Optional[str] = None, assigned_to: Optional[str] = None, date_filter: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
    search: Optional[str] = Query(default=None, max_length=100),
    ctx: AuthContext = Depends(require_permission("leads_export")),
):
    tid = await resolve_tenant_id(ctx, tenant_id)
    await rate_limiter.enforce(f"export:{ctx.user_id}", 5, 300, "Export limit reached. Please try again in a few minutes.")
    query = _build_list_query(ctx, tid, stage=stage, source=source, category=category, assigned_to=assigned_to,
                              date_filter=date_filter, start_date=start_date, end_date=end_date, search=search)
    rows = await find_lead_summaries(query, limit=50_000)
    await audit("lead.exported", ctx=ctx, tenant_id=tid, entity_type="lead", details={"rows": len(rows)})
    filename = f"leads_{local_today().isoformat()}.csv"
    return StreamingResponse(
        csv_service.leads_to_csv_rows(rows), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_leads_csv(file: UploadFile = File(...), tenant_id: Optional[str] = None,
                           ctx: AuthContext = Depends(require_permission("leads_import"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    await rate_limiter.enforce(f"import:{ctx.user_id}", 5, 300, "Import limit reached. Please try again in a few minutes.")
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")
    content = await file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="CSV file is too large (maximum 5 MB).")
    rows, errors = csv_service.parse_import_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail=" ".join(errors) or "No rows found in the file.")

    created = duplicates = 0
    for row in rows:
        line = row.pop("_line", "?")
        try:
            gstin = normalize_gstin(row.get("gstin"))
            if gstin and gstin_error(gstin):
                gstin = None
            deal_value = 0.0
            if row.get("deal_value"):
                deal_value = max(0.0, float(str(row["deal_value"]).replace(",", "")))
            dto = StandardLeadDTO(
                tenant_id=tid, source="import", full_name=row.get("full_name") or "", phone=row.get("phone") or "",
                email=row.get("email"), company_name=row.get("company_name"), city=row.get("city"),
                state=row.get("state"), pincode=row.get("pincode"), address=row.get("address"), gstin=gstin,
                product_inquired=row.get("product_inquired"), inquiry_message=row.get("inquiry_message"),
                deal_value=deal_value, category=(row.get("category") or "WARM"),
                raw_payload={"source": "csv_import", "line": line},
            )
            if not dto.full_name.strip():
                raise ValueError("Name is missing")
            _, is_dup = await process_and_save_lead(dto, actor_id=ctx.user_id, actor_name=ctx.display_name)
            duplicates += int(is_dup)
            created += int(not is_dup)
        except Exception as exc:
            if len(errors) < 50:
                errors.append(f"Line {line}: {str(exc)[:120] if isinstance(exc, ValueError) else 'invalid row'}")
    await audit("lead.imported", ctx=ctx, tenant_id=tid, entity_type="lead",
                details={"created": created, "duplicates": duplicates, "errors": len(errors)})
    return {"status": "success", "created": created, "duplicates": duplicates, "errors": errors,
            "message": f"Import finished: {created} new, {duplicates} already existed, {len(errors)} skipped."}


# ----------------------------------------------------------------- create
@router.post("/", status_code=201)
async def create_lead_manual(payload: LeadCreateRequest, tenant_id: Optional[str] = None,
                             ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    gstin = normalize_gstin(payload.gstin)
    if gstin:
        err = gstin_error(gstin)
        if err:
            raise HTTPException(status_code=400, detail=err)
    category = (payload.category or "WARM").upper()
    if category not in await _valid_categories(await _tenant(tid)):
        category = "WARM"
    code = resolve_state_code(payload.state_code) or resolve_state_code(payload.state)
    dto = StandardLeadDTO(
        tenant_id=tid, source=payload.source.lower(), full_name=payload.full_name, phone=payload.phone,
        email=payload.email, company_name=payload.company_name, city=payload.city,
        state=state_name(code) or payload.state, pincode=payload.pincode, address=payload.address, gstin=gstin,
        product_inquired=payload.product_inquired, inquiry_message=payload.inquiry_message,
        deal_value=payload.deal_value, category=category, custom_fields=payload.custom_fields,
        raw_payload={"source": "manual_entry"},
    )
    # sales staff keep ownership of the leads they enter themselves
    owner = None if ctx.has("leads_view_all") else (ctx.user_id, ctx.display_name)
    try:
        lead, is_duplicate = await process_and_save_lead(dto, actor_id=ctx.user_id, actor_name=ctx.display_name, assignee=owner)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if is_duplicate and not _can_access(ctx, lead):
        return {"lead": None, "is_duplicate": True,
                "message": f"This contact already exists and is handled by {lead.assigned_to_user_name or 'another team member'}."}
    if not is_duplicate:
        await audit("lead.created", ctx=ctx, tenant_id=tid, entity_type="lead", entity_id=str(lead.id))
    return {"lead": serialize_lead(lead), "is_duplicate": is_duplicate,
            "message": "This contact already exists; the inquiry was added to its timeline." if is_duplicate else "Lead created"}


@router.post("/simulate")
async def simulate_inbound_lead(payload: SimulateLeadRequest, ctx: AuthContext = Depends(require_permission("settings_manage"))):
    """Administrator tool: pushes a sample marketplace payload through the real ingestion pipeline."""
    if not settings.lead_simulator_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    tid = await resolve_tenant_id(ctx)
    ref = uuid.uuid4().hex[:10].upper()
    if payload.source == "indiamart":
        dto = IndiaMARTAdapter().parse_payload({
            "SENDER_NAME": "Test Buyer (IndiaMART)", "SENDER_MOBILE": "+91-9825012345", "SENDER_EMAIL": "test.buyer@example.com",
            "SENDER_COMPANY": "Sample Engineering Works", "SENDER_CITY": "Surat", "SENDER_STATE": "Gujarat",
            "QUERY_PRODUCT_NAME": "CNC Milling Center 3-Axis", "QUERY_MESSAGE": "Test inquiry generated by the lead simulator.",
            "UNIQUE_QUERY_ID": f"SIM-IM-{ref}"}, tid)
    elif payload.source == "facebook":
        dto = FacebookAdapter().parse_payload({"id": f"SIM-FB-{ref}", "field_data": [
            {"name": "full_name", "values": ["Test Lead (Meta Ads)"]}, {"name": "phone_number", "values": ["+919898011223"]},
            {"name": "email", "values": ["test.lead@example.com"]}, {"name": "city", "values": ["Mumbai"]},
            {"name": "state", "values": ["Maharashtra"]}]}, tid)
    else:
        dto = WebsiteAdapter().parse_payload({
            "name": "Test Visitor (Website)", "phone": "9811122334", "email": "test.visitor@example.com",
            "company": "Sample Global Exports", "city": "Delhi", "state": "Delhi", "product": "Hydraulic Press Machine 50 Ton",
            "message": "Test inquiry generated by the lead simulator.", "submission_id": f"SIM-WEB-{ref}"}, tid)
        dto.source = payload.source if payload.source in ("tradeindia", "justdial") else "website"
    dto.custom_fields["test_lead"] = True
    lead, is_duplicate = await process_and_save_lead(dto)
    await audit("lead.simulated", ctx=ctx, tenant_id=tid, entity_type="lead", entity_id=str(lead.id), details={"source": payload.source})
    return {"status": "success", "lead_id": str(lead.id), "is_duplicate": is_duplicate,
            "message": "Existing lead updated (duplicate inquiry)" if is_duplicate else "Test lead ingested successfully"}


@router.post("/bulk-assign")
async def bulk_assign_leads(payload: BulkAssignRequest, tenant_id: Optional[str] = None,
                            ctx: AuthContext = Depends(require_permission("leads_assign"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    target = await _team_member(tid, payload.user_id, assignable=True) if payload.user_id else None
    updated = 0
    for lead_id in dict.fromkeys(payload.lead_ids):
        lead = await get_document_by_id(Lead, lead_id)
        if not lead or lead.tenant_id != tid or lead.is_deleted:
            continue
        if await _assign(ctx, lead, target, payload.note):
            updated += 1
    await audit("lead.bulk_assigned", ctx=ctx, tenant_id=tid, entity_type="lead",
                details={"count": updated, "assignee": str(target.id) if target else "unassigned"})
    return {"status": "success", "updated": updated,
            "message": f"{updated} lead(s) assigned to {target.full_name if target else 'Unassigned'}."}


@router.post("/send-followup-whatsapp-alerts")
async def send_followup_whatsapp_alerts(tenant_id: Optional[str] = None, staff_user_id: Optional[str] = None,
                                        ctx: AuthContext = Depends(require_permission("leads_view_all"))):
    """Sends each team member a WhatsApp reminder listing their pending follow-ups (manager / administrator action)."""
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await _tenant(tid)
    await rate_limiter.enforce(f"fu-alerts:{tid}", 6, 600, "Reminders were sent recently. Please wait a few minutes.")

    query = lead_base_query(tid)
    query["next_follow_up.status"] = "PENDING"
    if staff_user_id:
        query["assigned_to_user_id"] = staff_user_id
    leads = await find_lead_summaries(query, limit=5000, sort=[("next_follow_up.scheduled_at", 1)])
    by_staff: Dict[str, List[Dict[str, Any]]] = {}
    unassigned = 0
    for lead in leads:
        owner = lead.get("assigned_to_user_id")
        if owner:
            by_staff.setdefault(owner, []).append(lead)
        else:
            unassigned += 1

    results: List[Dict[str, Any]] = []
    notified = 0
    for user_id, staff_leads in by_staff.items():
        member = await get_document_by_id(User, user_id)
        if not member or member.tenant_id != tid or not member.is_active:
            continue
        outcome = await NotificationService.notify_staff_pending_followups(tenant, member, staff_leads)
        results.append({
            "staff_id": user_id, "staff_name": member.full_name, "phone": member.whatsapp_number or member.phone,
            "pending_count": len(staff_leads), "status": outcome.get("status"),
            "whatsapp_link": outcome.get("whatsapp_link"), "message": outcome.get("message"),
        })
        if outcome.get("status") in ("success", "simulated"):
            notified += 1
    await audit("lead.followup_alerts_sent", ctx=ctx, tenant_id=tid, details={"staff": notified, "pending_leads": len(leads)})
    return {
        "status": "success",
        "message": (f"WhatsApp follow-up reminders processed for {notified} staff member(s)." if leads
                    else "No pending follow-ups found for alerting."),
        "total_staff_notified": notified,
        "total_pending_leads": len(leads),
        "unassigned_pending_leads": unassigned,
        "results": results,
    }


# ----------------------------------------------------------------- single lead
@router.get("/{lead_id}")
async def get_lead(lead_id: str, tenant_id: Optional[str] = None, ctx: AuthContext = Depends(get_current_user)):
    return serialize_lead(await _load_lead(ctx, lead_id, tenant_id))


@router.patch("/{lead_id}")
async def update_lead(lead_id: str, payload: LeadUpdateRequest, tenant_id: Optional[str] = None,
                      ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return serialize_lead(lead)
    updates: Dict[str, Any] = {}

    if "gstin" in data:
        gstin = normalize_gstin(data["gstin"])
        if gstin:
            err = gstin_error(gstin)
            if err:
                raise HTTPException(status_code=400, detail=err)
            updates["state_code"] = gstin[:2]
            updates["state"] = state_name(gstin[:2])
        updates["gstin"] = gstin
    if ("state" in data or "state_code" in data) and not updates.get("gstin"):
        code = resolve_state_code(data.get("state_code")) or resolve_state_code(data.get("state"))
        updates["state_code"] = code
        updates["state"] = state_name(code) or clean_text(data.get("state"), 100)
    if "phone" in data:
        phone = normalize_phone_number(data["phone"])
        if not phone and not (data.get("email") or lead.email):
            raise HTTPException(status_code=400, detail="A lead needs a phone number or an e-mail address.")
        if phone and phone != lead.phone:
            clash = await Lead.find_one({**lead_base_query(lead.tenant_id), "phone": phone})
            if clash and str(clash.id) != str(lead.id):
                raise HTTPException(status_code=409, detail="Another lead already uses this phone number.")
        updates["phone"] = phone
    if "email" in data:
        email = normalize_email(data["email"])
        if data["email"] and not email:
            raise HTTPException(status_code=400, detail="E-mail address is not valid.")
        updates["email"] = email
    if "priority" in data and data["priority"]:
        priority = data["priority"].upper()
        if priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail=f"priority must be one of: {', '.join(sorted(PRIORITIES))}.")
        updates["priority"] = priority
    if data.get("full_name"):
        updates["full_name"] = clean_text(data["full_name"], 200)
    for field, max_len in (("company_name", 200), ("city", 100), ("pincode", 10), ("address", 500), ("product_inquired", 300)):
        if field in data:
            updates[field] = clean_text(data[field], max_len)
    if data.get("deal_value") is not None:
        updates["deal_value"] = float(data["deal_value"])
    custom = sanitize_flat_dict(data["custom_fields"]) if data.get("custom_fields") else None

    def _mutate(l: Lead) -> None:
        for key, value in updates.items():
            setattr(l, key, value)
        if custom:
            l.custom_fields.update(custom)
        append_timeline(l, TimelineItem(activity_type="LEAD_UPDATED",
                                        note="Lead details updated: " + ", ".join(sorted(data.keys())), **_actor(ctx)))

    lead = await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    await audit("lead.updated", ctx=ctx, tenant_id=lead.tenant_id, entity_type="lead", entity_id=str(lead.id),
                details={"fields": ", ".join(sorted(data.keys()))})
    return serialize_lead(lead)


@router.delete("/{lead_id}")
async def delete_lead(lead_id: str, tenant_id: Optional[str] = None,
                      ctx: AuthContext = Depends(require_permission("leads_delete"))):
    """Soft delete: the lead disappears from the CRM but is retained for audit and can be restored."""
    lead = await _load_lead(ctx, lead_id, tenant_id)
    old_assignee = lead.assigned_to_user_id

    def _mutate(l: Lead) -> None:
        l.is_deleted = True
        l.deleted_at = datetime.utcnow()
        l.deleted_by = ctx.user_id
        append_timeline(l, TimelineItem(activity_type="LEAD_DELETED", note="Lead deleted", **_actor(ctx)))

    await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    await adjust_assignment_counts(old_assignee, None)
    await audit("lead.deleted", ctx=ctx, tenant_id=lead.tenant_id, entity_type="lead", entity_id=str(lead.id),
                details={"name": lead.full_name})
    return {"status": "success", "message": "Lead deleted"}


@router.post("/{lead_id}/restore")
async def restore_lead(lead_id: str, tenant_id: Optional[str] = None,
                       ctx: AuthContext = Depends(require_permission("leads_delete"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tid or not lead.is_deleted or not _can_access(ctx, lead):
        raise HTTPException(status_code=404, detail="Deleted lead not found")
    lead.is_deleted = False
    lead.deleted_at = None
    lead.deleted_by = None
    append_timeline(lead, TimelineItem(activity_type="LEAD_RESTORED", note="Lead restored", **_actor(ctx)))
    lead.updated_at = datetime.utcnow()
    await lead.save()
    await adjust_assignment_counts(None, lead.assigned_to_user_id)
    await audit("lead.restored", ctx=ctx, tenant_id=tid, entity_type="lead", entity_id=str(lead.id))
    return {"status": "success", "lead": serialize_lead(lead)}


@router.post("/{lead_id}/stage")
async def update_lead_stage(lead_id: str, payload: LeadStageUpdateRequest, tenant_id: Optional[str] = None,
                            ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    stage_ids = _stage_ids(await _tenant(lead.tenant_id))
    if payload.stage not in stage_ids:
        raise HTTPException(status_code=400, detail=f"'{payload.stage}' is not a stage of your pipeline.")
    stage_display = payload.stage.replace("_", " ").title()

    def _mutate(l: Lead) -> None:
        old_stage = l.stage
        l.stage = payload.stage
        note = f"Stage changed from {old_stage} to {payload.stage}"
        if payload.stage == "LOST" and payload.lost_reason:
            l.lost_reason = clean_text(payload.lost_reason, 200)
            note += f". Reason: {l.lost_reason}"
        if payload.note:
            note += f". Note: {clean_text(payload.note, 2000)}"
        append_timeline(l, TimelineItem(activity_type="STAGE_CHANGE", note=note, **_actor(ctx),
                                        metadata={"from": old_stage, "to": payload.stage}))
        refresh_follow_ups(l, datetime.utcnow(), f"Auto-resolved: Stage moved to {stage_display}")

    lead = await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    return {"status": "success", "lead": serialize_lead(lead)}


@router.post("/{lead_id}/category")
async def update_lead_category(lead_id: str, payload: LeadCategoryUpdateRequest, tenant_id: Optional[str] = None,
                               ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    category = payload.category.upper()
    if category not in await _valid_categories(await _tenant(lead.tenant_id)):
        raise HTTPException(status_code=400, detail=f"'{payload.category}' is not a configured lead category.")

    def _mutate(l: Lead) -> None:
        old = l.category or "WARM"
        l.category = category
        note = f"Lead category changed from {old} to {category}"
        if payload.note:
            note += f". Note: {clean_text(payload.note, 2000)}"
        append_timeline(l, TimelineItem(activity_type="CATEGORY_CHANGE", note=note, **_actor(ctx)))

    lead = await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    return {"status": "success", "lead": serialize_lead(lead)}


@router.post("/{lead_id}/activity")
async def add_lead_activity(lead_id: str, payload: LeadAddActivityRequest, tenant_id: Optional[str] = None,
                            ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    activity_type = payload.activity_type.upper()
    if activity_type not in ACTIVITY_TYPES:
        raise HTTPException(status_code=400, detail=f"activity_type must be one of: {', '.join(sorted(ACTIVITY_TYPES))}.")
    note = clean_text(payload.note, 5000) or ""

    def _mutate(l: Lead) -> None:
        append_timeline(l, TimelineItem(activity_type=activity_type, note=note, **_actor(ctx),
                                        metadata=sanitize_flat_dict(payload.metadata, max_items=20, max_value_len=500)))
        refresh_follow_ups(l, datetime.utcnow(), f"Auto-resolved: Action logged ({activity_type}) - {note[:200]}")

    lead = await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    return {"status": "success", "lead": serialize_lead(lead)}


async def _assign(ctx: AuthContext, lead: Lead, target: Optional[User], note: Optional[str]) -> bool:
    new_id = str(target.id) if target else None
    old_id = lead.assigned_to_user_id
    if new_id == old_id:
        return False

    def _mutate(l: Lead) -> None:
        old_name = l.assigned_to_user_name or "Unassigned"
        l.assigned_to_user_id = new_id
        l.assigned_to_user_name = target.full_name if target else None
        if target:
            role = target.role.replace("_", " ").title()
            text = f"Lead assigned to {target.full_name} ({role}{' - ' + target.designation if target.designation else ''}) by {ctx.display_name}"
        else:
            text = f"Lead unassigned from {old_name} by {ctx.display_name}"
        if note:
            text += f". Note: {clean_text(note, 2000)}"
        append_timeline(l, TimelineItem(activity_type="ASSIGNMENT", note=text, **_actor(ctx),
                                        metadata={"from": old_id, "to": new_id}))

    await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    await adjust_assignment_counts(old_id, new_id)
    return True


@router.post("/{lead_id}/assign")
async def assign_lead(lead_id: str, payload: LeadAssignRequest, tenant_id: Optional[str] = None,
                      ctx: AuthContext = Depends(require_permission("leads_assign"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    target = None
    if payload.user_id and payload.user_id not in ("unassigned", "none"):
        target = await _team_member(lead.tenant_id, payload.user_id, assignable=True)
    await _assign(ctx, lead, target, payload.note)
    lead = await get_document_by_id(Lead, lead_id)
    await audit("lead.assigned", ctx=ctx, tenant_id=lead.tenant_id, entity_type="lead", entity_id=str(lead.id),
                details={"assignee": str(target.id) if target else "unassigned"})
    return {"status": "success", "message": f"Lead assigned to {lead.assigned_to_user_name or 'Unassigned'}",
            "lead": serialize_lead(lead)}


@router.post("/{lead_id}/followup")
async def schedule_follow_up(lead_id: str, payload: ScheduleFollowUpRequest, tenant_id: Optional[str] = None,
                             ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    follow_type = payload.follow_up_type.lower()
    if follow_type not in FOLLOW_UP_TYPES:
        raise HTTPException(status_code=400, detail=f"follow_up_type must be one of: {', '.join(sorted(FOLLOW_UP_TYPES))}.")
    try:
        scheduled = parse_client_datetime(payload.scheduled_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="scheduled_at must be an ISO date-time.")
    now = datetime.utcnow()
    if scheduled < now - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Follow-up time cannot be in the past.")
    if scheduled > now + timedelta(days=730):
        raise HTTPException(status_code=400, detail="Follow-up time is too far in the future.")

    owner_id, owner_name = ctx.user_id, ctx.display_name
    if payload.user_id and payload.user_id != ctx.user_id and ctx.has("leads_assign"):
        member = await _team_member(lead.tenant_id, payload.user_id)
        owner_id, owner_name = str(member.id), member.full_name
    note = clean_text(payload.note, 2000) or ""

    def _mutate(l: Lead) -> None:
        if sum(1 for f in l.follow_ups if f.status == "PENDING") >= 50:
            raise HTTPException(status_code=400, detail="This lead already has too many pending follow-ups.")
        l.follow_ups.append(FollowUpItem(
            id=uuid.uuid4().hex[:12], scheduled_at=scheduled, follow_up_type=follow_type, note=note, status="PENDING",
            assigned_to_user_id=owner_id, assigned_to_user_name=owner_name,
        ))
        l.follow_ups = l.follow_ups[-200:]
        refresh_follow_ups(l, now)
        append_timeline(l, TimelineItem(
            activity_type="FOLLOWUP_SCHEDULED",
            note=f"Follow-up scheduled: {FOLLOW_UP_LABELS[follow_type]}. Note: {note}", **_actor(ctx),
            metadata={"scheduled_at": scheduled.isoformat() + "Z", "follow_up_type": follow_type},
        ))

    lead = await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    return {"status": "success", "message": "Follow-up scheduled successfully", "lead": serialize_lead(lead)}


@router.post("/{lead_id}/followup/complete")
async def complete_follow_up(lead_id: str, payload: CompleteFollowUpRequest, tenant_id: Optional[str] = None,
                             ctx: AuthContext = Depends(require_permission("leads_create_edit"))):
    lead = await _load_lead(ctx, lead_id, tenant_id)
    remark = clean_text(payload.note, 2000)

    def _mutate(l: Lead) -> None:
        now = datetime.utcnow()
        pending = sorted((f for f in l.follow_ups if f.status == "PENDING"), key=lambda f: f.scheduled_at)
        if payload.follow_up_id:
            targets = [f for f in pending if f.id == payload.follow_up_id]
        else:
            targets = [f for f in pending if f.scheduled_at <= now] or pending[:1]
        if not targets:
            raise HTTPException(status_code=400, detail="There is no pending follow-up to complete.")
        for f in targets:
            f.status = "COMPLETED"
            f.completed_at = now
            f.completion_note = remark or "Completed"
        refresh_follow_ups(l, now)
        text = f"Follow-up marked as COMPLETED by {ctx.display_name}"
        if remark:
            text += f". Completion remarks: {remark}"
        append_timeline(l, TimelineItem(activity_type="FOLLOWUP_COMPLETED", note=text, **_actor(ctx)))

    lead = await mutate_lead(str(lead.id), lead.tenant_id, _mutate)
    return {"status": "success", "message": "Follow-up marked as completed", "lead": serialize_lead(lead)}

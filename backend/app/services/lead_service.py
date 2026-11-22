"""
Lead ingestion pipeline: normalisation, idempotency, de-duplication, round-robin assignment,
bounded activity timeline and follow-up bookkeeping.
"""
import logging
import re
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

import phonenumbers
from beanie.exceptions import RevisionIdWasChanged
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.core.gst import normalize_gstin, resolve_state_code, to_decimal
from app.core.validators import cap_json_size, clean_text, sanitize_flat_dict, sanitize_nested
from app.models.lead import Lead, TimelineItem
from app.models.user import User
from app.services.adapters.base import StandardLeadDTO

logger = logging.getLogger(__name__)

MAX_TIMELINE_ITEMS = 500
IDEMPOTENT_SOURCES = {"indiamart", "tradeindia", "facebook", "justdial", "website"}
ACTIVE_LEAD = {"is_deleted": {"$ne": True}}


def lead_base_query(tenant_id: str) -> Dict[str, Any]:
    return {"tenant_id": tenant_id, **ACTIVE_LEAD}


def normalize_phone_number(phone_raw: Optional[str], default_region: str = "IN") -> str:
    """Standardises to a 10-digit national number for India, E.164 for other countries."""
    if not phone_raw:
        return ""
    raw = str(phone_raw).strip()
    cleaned = re.sub(r"[^\d+]", "", raw)
    if cleaned.startswith("91") and len(cleaned) == 12:
        cleaned = "+" + cleaned
    try:
        parsed = phonenumbers.parse(cleaned, default_region)
        if phonenumbers.is_valid_number(parsed):
            if parsed.country_code == 91:
                return str(parsed.national_number)
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException:
        pass
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("91"):
        return digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        return digits[1:]
    return digits[:15]


def normalize_email(email: Optional[str]) -> Optional[str]:
    value = (email or "").strip().lower()
    if not value or "@" not in value or len(value) > 254:
        return None
    return value


def append_timeline(lead: Lead, item: TimelineItem) -> None:
    lead.timeline.append(item)
    if len(lead.timeline) > MAX_TIMELINE_ITEMS:
        lead.timeline = lead.timeline[-MAX_TIMELINE_ITEMS:]


def refresh_follow_ups(lead: Lead, now: datetime, auto_resolve_note: Optional[str] = None) -> None:
    """Optionally auto-completes due follow-ups, then recomputes next_follow_up."""
    if auto_resolve_note:
        for f in lead.follow_ups:
            if f.status == "PENDING" and f.scheduled_at <= now:
                f.status = "COMPLETED"
                f.completed_at = now
                f.completion_note = auto_resolve_note[:500]
    pending = sorted((f for f in lead.follow_ups if f.status == "PENDING"), key=lambda f: f.scheduled_at)
    lead.next_follow_up = pending[0] if pending else None


async def mutate_lead(
    lead_id: str,
    tenant_id: str,
    mutation: Callable[[Lead], Any],
    retries: int = 3,
) -> Lead:
    """Load -> mutate -> save with optimistic concurrency retries (no lost updates)."""
    from app.core.database import get_document_by_id

    for _ in range(retries):
        lead = await get_document_by_id(Lead, lead_id)
        if not lead or lead.tenant_id != tenant_id or lead.is_deleted:
            raise HTTPException(status_code=404, detail="Lead not found")
        result = mutation(lead)
        if hasattr(result, "__await__"):
            await result  # type: ignore[func-returns-value]
        lead.updated_at = datetime.utcnow()
        try:
            await lead.save()
            return lead
        except RevisionIdWasChanged:
            continue
    raise HTTPException(status_code=409, detail="This lead was updated by someone else. Please refresh and try again.")


ASSIGNABLE_ROLES = ("staff", "agent", "manager")  # company / platform administrators never own leads


async def assign_lead_round_robin(tenant_id: str) -> Tuple[Optional[str], Optional[str]]:
    """Atomically picks the active sales user with the fewest assigned leads (administrators are excluded)."""
    doc = await User.get_motor_collection().find_one_and_update(
        {"tenant_id": tenant_id, "is_active": True, "role": {"$in": list(ASSIGNABLE_ROLES)}},
        {"$inc": {"assigned_leads_count": 1}},
        sort=[("assigned_leads_count", 1), ("_id", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if doc:
        return str(doc["_id"]), doc.get("full_name")
    return None, None


async def find_existing_lead(dto: StandardLeadDTO, phone: str, email: Optional[str]) -> Tuple[Optional[Lead], bool]:
    """Returns (lead, already_processed). already_processed=True means the exact external inquiry was seen before."""
    base = lead_base_query(dto.tenant_id)
    if dto.source_lead_id and dto.source in IDEMPOTENT_SOURCES:
        seen = await Lead.find_one({
            **base,
            "$or": [
                {"source": dto.source, "source_lead_id": dto.source_lead_id},
                {"timeline.metadata.source_lead_id": dto.source_lead_id, "timeline.metadata.raw_source": dto.source},
            ],
        })
        if seen:
            return seen, True
    if phone and len(phone) >= 7:
        found = await Lead.find_one({**base, "phone": phone})
        if found:
            return found, False
    if email:
        found = await Lead.find_one({**base, "email": email})
        if found:
            return found, False
    return None, False


async def process_and_save_lead(
    dto: StandardLeadDTO,
    actor_id: Optional[str] = None,
    actor_name: Optional[str] = None,
    auto_assign: bool = False,
    assignee: Optional[Tuple[str, str]] = None,
) -> Tuple[Lead, bool]:
    """
    New leads start in the Unassigned (open pool) state; a manager / administrator assigns them.
    `assignee` keeps ownership with the sales user who entered the lead; `auto_assign` enables round-robin.
    """
    phone = normalize_phone_number(dto.phone)
    email = normalize_email(dto.email)
    if not phone and not email:
        raise ValueError("A valid phone number or e-mail address is required.")

    existing, already_processed = await find_existing_lead(dto, phone, email)
    raw_payload = cap_json_size(sanitize_nested(dto.raw_payload or {}))

    if existing:
        if already_processed:
            logger.info("Inquiry %s/%s already processed for lead %s", dto.source, dto.source_lead_id, existing.id)
            return existing, True

        def _merge(lead: Lead) -> None:
            append_timeline(lead, TimelineItem(
                activity_type="DUPLICATE_INQUIRY",
                note=(f"Re-inquired from {dto.source.upper()}. Product: {dto.product_inquired or 'N/A'}. "
                      f"Message: {(dto.inquiry_message or 'No message')[:1000]}"),
                performed_by_id=actor_id or "SYSTEM",
                performed_by_name=actor_name or "Ingestion Worker",
                metadata={"raw_source": dto.source, "source_lead_id": dto.source_lead_id,
                          "payload": cap_json_size(raw_payload, 4000)},
            ))
            if dto.product_inquired and not lead.product_inquired:
                lead.product_inquired = clean_text(dto.product_inquired, 300)
            if email and not lead.email:
                lead.email = email

        lead = await mutate_lead(str(existing.id), dto.tenant_id, _merge)
        return lead, True

    agent_id, agent_name = (None, None)
    if assignee:
        agent_id, agent_name = assignee
        await adjust_assignment_counts(None, agent_id)
    elif auto_assign:
        agent_id, agent_name = await assign_lead_round_robin(dto.tenant_id)

    gstin = normalize_gstin(dto.gstin)
    state_code = resolve_state_code(gstin) or resolve_state_code(dto.state)
    lead = Lead(
        tenant_id=dto.tenant_id,
        source=(dto.source or "manual").lower()[:30],
        source_lead_id=clean_text(dto.source_lead_id, 120),
        full_name=clean_text(dto.full_name, 200) or "Unknown",
        phone=phone,
        email=email,
        company_name=clean_text(dto.company_name, 200),
        city=clean_text(dto.city, 100),
        state=clean_text(dto.state, 100),
        state_code=state_code,
        pincode=clean_text(dto.pincode, 10),
        address=clean_text(dto.address, 500),
        gstin=gstin,
        product_inquired=clean_text(dto.product_inquired, 300),
        inquiry_message=clean_text(dto.inquiry_message, 5000),
        deal_value=max(0.0, float(dto.deal_value or 0)),
        stage="NEW",
        category=(dto.category or "WARM").upper()[:20],
        assigned_to_user_id=agent_id,
        assigned_to_user_name=agent_name,
        custom_fields=sanitize_flat_dict(dto.custom_fields),
        raw_payload=raw_payload,
        created_by_id=actor_id,
        timeline=[TimelineItem(
            activity_type="LEAD_CREATED",
            note=f"New lead captured from {(dto.source or 'manual').upper()}."
                 + ("" if (assignee or auto_assign) else " Placed in Open Pool (Unassigned)."),
            performed_by_id=actor_id or "SYSTEM",
            performed_by_name=actor_name or "Ingestion Worker",
            metadata={"raw_source": dto.source, "source_lead_id": dto.source_lead_id} if dto.source_lead_id else {},
        )],
    )
    if agent_name:
        lead.timeline.append(TimelineItem(
            activity_type="ASSIGNMENT",
            note=(f"Assigned to {agent_name} (lead owner)." if assignee
                  else f"Auto-assigned to {agent_name} via Round-Robin rule."),
            performed_by_id="SYSTEM",
            performed_by_name="Rule Engine",
        ))
    await lead.insert()
    logger.info("Created lead %s (source=%s) assigned to %s", lead.id, lead.source, agent_id)
    return lead, False


async def adjust_assignment_counts(old_user_id: Optional[str], new_user_id: Optional[str]) -> None:
    from bson import ObjectId

    collection = User.get_motor_collection()
    if old_user_id and old_user_id != new_user_id and ObjectId.is_valid(old_user_id):
        await collection.update_one({"_id": ObjectId(old_user_id), "assigned_leads_count": {"$gt": 0}},
                                    {"$inc": {"assigned_leads_count": -1}})
    if new_user_id and old_user_id != new_user_id and ObjectId.is_valid(new_user_id):
        await collection.update_one({"_id": ObjectId(new_user_id)}, {"$inc": {"assigned_leads_count": 1}})


SUMMARY_EXCLUDE = {"raw_payload": 0, "timeline": 0, "follow_ups": 0, "revision_id": 0}


def _clean_lead_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc["_id"] = str(doc["_id"])
    doc["id"] = doc["_id"]
    doc.pop("revision_id", None)
    doc.pop("raw_payload", None)
    if "deal_value" in doc:
        doc["deal_value"] = float(to_decimal(doc["deal_value"]))
    return doc


async def find_lead_summaries(query: Dict[str, Any], *, skip: int = 0, limit: int = 100,
                              sort: Optional[List[Tuple[str, int]]] = None) -> List[Dict[str, Any]]:
    """Lean list rows straight from MongoDB (no timelines / raw payloads are loaded for list views)."""
    cursor = Lead.get_motor_collection().find(query, SUMMARY_EXCLUDE).sort(sort or [("created_at", -1)]).skip(skip).limit(limit)
    return [_clean_lead_doc(doc) async for doc in cursor]


def serialize_lead(lead: Lead) -> Dict[str, Any]:
    data = lead.model_dump(mode="json", exclude={"raw_payload", "revision_id", "id"})
    data["_id"] = data["id"] = str(lead.id)
    return data


def serialize_leads(leads: List[Lead], summary: bool = False) -> List[Dict[str, Any]]:
    out = []
    for lead in leads:
        data = serialize_lead(lead)
        if summary:
            data.pop("timeline", None)
            data.pop("follow_ups", None)
        out.append(data)
    return out

import re
import logging
from typing import Tuple, Optional
from datetime import datetime
import phonenumbers

from app.models.lead import Lead, TimelineItem
from app.models.user import User
from app.services.adapters.base import StandardLeadDTO

logger = logging.getLogger(__name__)


def normalize_phone_number(phone_raw: str, default_region: str = "IN") -> str:
    """
    Cleans and standardizes phone numbers into E.164 / standard 10-digit format.
    Handles +91, 0 prefix, spaces, dashes.
    """
    if not phone_raw:
        return ""
    
    cleaned = re.sub(r"[^\d+]", "", phone_raw)
    try:
        parsed = phonenumbers.parse(cleaned, default_region)
        if phonenumbers.is_valid_number(parsed):
            # For Indian numbers, return 10-digit National number for standard dedup matching
            if parsed.country_code == 91:
                return str(parsed.national_number)
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        pass

    # Fallback cleanup: remove leading +91 or 0
    cleaned_digits = re.sub(r"\D", "", phone_raw)
    if len(cleaned_digits) == 12 and cleaned_digits.startswith("91"):
        return cleaned_digits[2:]
    if len(cleaned_digits) == 11 and cleaned_digits.startswith("0"):
        return cleaned_digits[1:]
    return cleaned_digits


async def assign_lead_round_robin(tenant_id: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Round-robin lead assignment among active agents/staff of the tenant.
    Picks the sales agent with the lowest assigned lead count.
    Excludes Company Admin and Super Admin (admins cannot be assigned leads).
    """
    agents = await User.find(
        {
            "tenant_id": tenant_id,
            "is_active": True,
            "role": {"$nin": ["company_admin", "super_admin"]}
        }
    ).sort("assigned_leads_count").to_list()

    if not agents:
        # No staff available - lead remains in unassigned pool (admins never assigned)
        return None, None

    selected_agent = agents[0]
    selected_agent.assigned_leads_count = (selected_agent.assigned_leads_count or 0) + 1
    await selected_agent.save()
    return str(selected_agent.id), selected_agent.full_name


async def process_and_save_lead(dto: StandardLeadDTO) -> Tuple[Lead, bool]:
    """
    Core pipeline:
    1. Normalize phone
    2. Duplicate check (same tenant & phone)
    3. If duplicate -> append activity to timeline & update note
    4. If new -> auto-assign agent via round-robin, create lead
    """
    norm_phone = normalize_phone_number(dto.phone)
    if not norm_phone:
        norm_phone = str(dto.phone).strip() if dto.phone else ""

    # Deduplication check: Only deduplicate if a valid phone (>= 5 digits) or valid email exists
    existing_lead = None
    if norm_phone and len(norm_phone) >= 5:
        existing_lead = await Lead.find_one({
            "tenant_id": dto.tenant_id,
            "phone": norm_phone
        })
    elif dto.email and "@" in str(dto.email):
        existing_lead = await Lead.find_one({
            "tenant_id": dto.tenant_id,
            "email": str(dto.email).strip().lower()
        })

    if existing_lead:
        # Append duplicate inquiry note to existing lead's timeline
        timeline_entry = TimelineItem(
            activity_type="DUPLICATE_INQUIRY",
            note=f"Re-inquired from {dto.source.upper()}. Product: {dto.product_inquired or 'N/A'}. Message: {dto.inquiry_message or 'No message'}",
            performed_by_id="SYSTEM",
            performed_by_name="Ingestion Worker",
            metadata={"raw_source": dto.source, "new_payload": dto.raw_payload}
        )
        existing_lead.timeline.append(timeline_entry)
        existing_lead.updated_at = datetime.utcnow()
        if dto.product_inquired and not existing_lead.product_inquired:
            existing_lead.product_inquired = dto.product_inquired
        await existing_lead.save()
        logger.info(f"Duplicate lead detected for phone {norm_phone}. Updated lead ID {existing_lead.id}")
        return existing_lead, True

    # All incoming new leads start in Unassigned (Open Pool) state
    # Company Admin / Sales Manager can manually review and assign them to staff
    new_lead = Lead(
        tenant_id=dto.tenant_id,
        source=dto.source,
        source_lead_id=dto.source_lead_id,
        full_name=dto.full_name,
        phone=norm_phone,
        email=dto.email,
        company_name=dto.company_name,
        city=dto.city,
        state=dto.state,
        pincode=dto.pincode,
        address=dto.address,
        gstin=dto.gstin,
        product_inquired=dto.product_inquired,
        inquiry_message=dto.inquiry_message,
        deal_value=dto.deal_value,
        stage="NEW",
        category=getattr(dto, 'category', 'WARM') or 'WARM',
        assigned_to_user_id=None,
        assigned_to_user_name=None,
        custom_fields=dto.custom_fields,
        raw_payload=dto.raw_payload,
        timeline=[
            TimelineItem(
                activity_type="LEAD_CREATED",
                note=f"New lead captured from {dto.source.upper()}. Placed in Open Pool (Unassigned).",
                performed_by_id="SYSTEM",
                performed_by_name="Ingestion Worker"
            )
        ]
    )

    await new_lead.insert()
    logger.info(f"Created new lead ID {new_lead.id} in Unassigned pool from {dto.source.upper()}")
    return new_lead, False

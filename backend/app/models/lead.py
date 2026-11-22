from datetime import datetime
from typing import Dict, Any, List, Optional
from beanie import Document, Indexed
from pydantic import BaseModel, Field
from app.core.types import Currency


class TimelineItem(BaseModel):
    activity_type: str  # "CALL_LOG", "WHATSAPP", "NOTE", "STAGE_CHANGE", "QUOTE_GENERATED", "INVOICE_GENERATED"
    note: str
    performed_by_id: Optional[str] = "SYSTEM"
    performed_by_name: Optional[str] = "System"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ConvertedBillInfo(BaseModel):
    is_converted: bool = False
    quotation_id: Optional[str] = None
    invoice_id: Optional[str] = None
    invoice_number: Optional[str] = None
    converted_at: Optional[datetime] = None


class FollowUpItem(BaseModel):
    id: Optional[str] = None
    scheduled_at: datetime  # Scheduled date & time
    follow_up_type: str = "call"  # "call", "whatsapp", "meeting", "email", "site_visit"
    note: str
    status: str = "PENDING"  # "PENDING", "COMPLETED", "CANCELLED"
    assigned_to_user_id: Optional[str] = None
    assigned_to_user_name: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    completion_note: Optional[str] = None


class Lead(Document):
    tenant_id: Indexed(str)
    source: str = "manual"  # "indiamart", "tradeindia", "facebook", "website", "manual"
    source_lead_id: Optional[str] = None  # External ID from IndiaMART / Meta
    
    # Contact Details
    full_name: str
    phone: Indexed(str)  # Standardized e.g. "9876543210" for fast deduplication lookup
    email: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    state_code: Optional[str] = None  # GST state code (place of supply), e.g. "24"

    # Requirement details
    product_inquired: Optional[str] = None
    inquiry_message: Optional[str] = None
    deal_value: Currency = 0.0

    # Pipeline Stage
    stage: str = "NEW"  # "NEW", "CONTACTED", "DEMO_SCHEDULED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"
    priority: str = "MEDIUM"  # "LOW", "MEDIUM", "HIGH", "HOT"
    category: str = "WARM"  # "HOT", "WARM", "COLD" (CRM Masters Lead Category)
    assigned_to_user_id: Optional[str] = None
    assigned_to_user_name: Optional[str] = None
    lost_reason: Optional[str] = None

    # Multi-Company Type dynamic attributes (e.g. {"machine_model": "CNC-20", "power": "15kW"})
    custom_fields: Dict[str, Any] = Field(default_factory=dict)

    # Raw Payload (Preserved for audits & debugging)
    raw_payload: Optional[Dict[str, Any]] = None

    # Conversion to Bill
    conversion_info: ConvertedBillInfo = Field(default_factory=ConvertedBillInfo)

    # Follow-up System
    next_follow_up: Optional[FollowUpItem] = None
    follow_ups: List[FollowUpItem] = Field(default_factory=list)

    # Activity Timeline (Audit trail & CRM history)
    timeline: List[TimelineItem] = Field(default_factory=list)

    # Soft delete (records are retained for audit)
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[str] = None

    created_by_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "leads"
        use_revision = True  # optimistic concurrency: concurrent edits never silently overwrite each other
        indexes = [
            [("tenant_id", 1), ("source", 1), ("source_lead_id", 1)],
            [("tenant_id", 1), ("email", 1)],
            [("tenant_id", 1), ("assigned_to_user_id", 1)],
            [("tenant_id", 1), ("next_follow_up.scheduled_at", 1)],
            [("tenant_id", 1), ("phone", 1)],
            [("tenant_id", 1), ("stage", 1)],
            [("tenant_id", 1), ("source", 1)],
            [("tenant_id", 1), ("created_at", -1)],
        ]

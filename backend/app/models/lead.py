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

    # Multi-Company Type dynamic attributes (e.g. {"machine_model": "CNC-20", "power": "15kW"})
    custom_fields: Dict[str, Any] = Field(default_factory=dict)

    # Raw Payload (Preserved for audits & debugging)
    raw_payload: Optional[Dict[str, Any]] = None

    # Conversion to Bill
    conversion_info: ConvertedBillInfo = Field(default_factory=ConvertedBillInfo)

    # Activity Timeline (Audit trail & CRM history)
    timeline: List[TimelineItem] = Field(default_factory=list)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "leads"
        indexes = [
            [("tenant_id", 1), ("phone", 1)],
            [("tenant_id", 1), ("stage", 1)],
            [("tenant_id", 1), ("source", 1)],
            [("tenant_id", 1), ("created_at", -1)],
        ]

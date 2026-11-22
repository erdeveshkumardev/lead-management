from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

ACTIVITY_TYPES = {"CALL_LOG", "WHATSAPP", "NOTE", "MEETING", "EMAIL", "SITE_VISIT"}
FOLLOW_UP_TYPES = {"call", "whatsapp", "meeting", "email", "site_visit"}
PRIORITIES = {"LOW", "MEDIUM", "HIGH", "HOT"}


class LeadCreateRequest(BaseModel):
    source: str = Field(default="manual", max_length=30, pattern=r"^[a-zA-Z0-9_\-]+$")
    full_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=30)
    email: Optional[str] = Field(default=None, max_length=254)
    company_name: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100)
    state_code: Optional[str] = Field(default=None, max_length=2)
    pincode: Optional[str] = Field(default=None, max_length=10)
    address: Optional[str] = Field(default=None, max_length=500)
    gstin: Optional[str] = Field(default=None, max_length=20)
    product_inquired: Optional[str] = Field(default=None, max_length=300)
    inquiry_message: Optional[str] = Field(default=None, max_length=5000)
    deal_value: float = Field(default=0.0, ge=0, le=1_000_000_000_000)
    category: Optional[str] = Field(default="WARM", max_length=20)
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class LeadUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=254)
    company_name: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100)
    state_code: Optional[str] = Field(default=None, max_length=2)
    pincode: Optional[str] = Field(default=None, max_length=10)
    address: Optional[str] = Field(default=None, max_length=500)
    gstin: Optional[str] = Field(default=None, max_length=20)
    product_inquired: Optional[str] = Field(default=None, max_length=300)
    priority: Optional[str] = Field(default=None, max_length=10)
    deal_value: Optional[float] = Field(default=None, ge=0, le=1_000_000_000_000)
    custom_fields: Optional[Dict[str, Any]] = None


class LeadAddActivityRequest(BaseModel):
    activity_type: str = Field(max_length=30)
    note: str = Field(min_length=1, max_length=5000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LeadStageUpdateRequest(BaseModel):
    stage: str = Field(min_length=1, max_length=40)
    note: Optional[str] = Field(default=None, max_length=2000)
    lost_reason: Optional[str] = Field(default=None, max_length=200)


class LeadCategoryUpdateRequest(BaseModel):
    category: str = Field(min_length=1, max_length=20)
    note: Optional[str] = Field(default=None, max_length=2000)


class LeadAssignRequest(BaseModel):
    user_id: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=2000)


class BulkAssignRequest(BaseModel):
    lead_ids: List[str] = Field(min_length=1, max_length=500)
    user_id: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=2000)


class ScheduleFollowUpRequest(BaseModel):
    scheduled_at: str = Field(min_length=10, max_length=40)
    follow_up_type: str = Field(default="call", max_length=20)
    note: str = Field(min_length=1, max_length=2000)
    user_id: Optional[str] = Field(default=None, max_length=40)


class CompleteFollowUpRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)
    follow_up_id: Optional[str] = Field(default=None, max_length=40)


class SimulateLeadRequest(BaseModel):
    source: str = Field(pattern=r"^(indiamart|facebook|website|tradeindia|justdial)$")

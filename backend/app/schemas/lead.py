from datetime import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class LeadCreateRequest(BaseModel):
    source: str = "manual"
    full_name: str
    phone: str
    email: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    product_inquired: Optional[str] = None
    inquiry_message: Optional[str] = None
    deal_value: float = 0.0
    category: Optional[str] = "WARM"
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class LeadUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    stage: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    deal_value: Optional[float] = None
    assigned_to_user_id: Optional[str] = None
    assigned_to_user_name: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None


class LeadAddActivityRequest(BaseModel):
    activity_type: str  # "CALL_LOG", "WHATSAPP", "NOTE", "MEETING"
    note: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LeadStageUpdateRequest(BaseModel):
    stage: str
    note: Optional[str] = None


class LeadCategoryUpdateRequest(BaseModel):
    category: str  # "HOT", "WARM", "COLD"
    note: Optional[str] = None

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class StandardLeadDTO(BaseModel):
    """
    Common Lead Format (Normalized DTO)
    All channel adapters (IndiaMART, TradeIndia, Facebook, Webhook) must map their
    incoming vendor-specific payload into this standard model.
    """
    tenant_id: str
    source: str  # "indiamart", "tradeindia", "facebook", "website", "manual"
    source_lead_id: Optional[str] = None
    
    # Customer Info
    full_name: str
    phone: str
    email: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None

    # Inquired Item & Message
    product_inquired: Optional[str] = None
    inquiry_message: Optional[str] = None
    deal_value: float = 0.0
    category: Optional[str] = "WARM"

    # Dynamic attributes extracted from custom fields
    custom_fields: Dict[str, Any] = Field(default_factory=dict)
    
    # Raw source payload for auditing
    raw_payload: Dict[str, Any] = Field(default_factory=dict)


class BaseLeadAdapter(ABC):
    @abstractmethod
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        """Parse third-party raw payload into the StandardLeadDTO"""
        pass

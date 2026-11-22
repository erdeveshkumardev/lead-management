from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


def first_value(data: Dict[str, Any], *keys: str) -> Optional[str]:
    """Returns the first non-empty value for the given keys (case-insensitive) as a stripped string."""
    if not isinstance(data, dict):
        return None
    lowered = {str(k).lower(): v for k, v in data.items()}
    for key in keys:
        value = data.get(key)
        if value in (None, ""):
            value = lowered.get(key.lower())
        if value not in (None, "") and not isinstance(value, (dict, list)):
            text = str(value).strip()
            if text:
                return text
    return None


class StandardLeadDTO(BaseModel):
    """
    Common Lead Format. Every channel adapter maps its vendor payload into this model.
    """
    tenant_id: str
    source: str
    source_lead_id: Optional[str] = None

    full_name: str
    phone: str = ""
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
    raw_payload: Dict[str, Any] = Field(default_factory=dict)


class BaseLeadAdapter(ABC):
    @abstractmethod
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        """Parse a third-party payload into the StandardLeadDTO."""

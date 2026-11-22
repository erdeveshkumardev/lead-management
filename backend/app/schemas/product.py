from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.core.gst import HSN_RE, VALID_GST_RATES

ITEM_TYPES = {"product", "service"}


def _check_gst_rate(value: Optional[float]) -> Optional[float]:
    if value is None:
        return value
    if Decimal(str(value)) not in VALID_GST_RATES:
        raise ValueError("GST rate must be a valid slab (0, 0.25, 3, 5, 12, 18, 28 ...).")
    return value


def _check_hsn(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    text = value.strip()
    if text and not HSN_RE.match(text):
        raise ValueError("HSN/SAC code must be 4 to 8 digits.")
    return text or None


class ProductCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sku: Optional[str] = Field(default=None, max_length=60)
    item_type: str = "product"
    hsn_sac_code: Optional[str] = Field(default=None, max_length=8)
    description: Optional[str] = Field(default=None, max_length=1000)
    unit: str = Field(default="Nos", max_length=20)
    unit_price: float = Field(ge=0, le=1_000_000_000_000)
    gst_rate: float = 18.0

    _v_rate = field_validator("gst_rate")(_check_gst_rate)
    _v_hsn = field_validator("hsn_sac_code")(_check_hsn)

    @field_validator("item_type")
    @classmethod
    def _v_type(cls, value: str) -> str:
        if value not in ITEM_TYPES:
            raise ValueError("item_type must be 'product' or 'service'.")
        return value


class ProductUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    sku: Optional[str] = Field(default=None, max_length=60)
    item_type: Optional[str] = None
    hsn_sac_code: Optional[str] = Field(default=None, max_length=8)
    description: Optional[str] = Field(default=None, max_length=1000)
    unit: Optional[str] = Field(default=None, max_length=20)
    unit_price: Optional[float] = Field(default=None, ge=0, le=1_000_000_000_000)
    gst_rate: Optional[float] = None
    is_active: Optional[bool] = None

    _v_rate = field_validator("gst_rate")(_check_gst_rate)
    _v_hsn = field_validator("hsn_sac_code")(_check_hsn)

    @field_validator("item_type")
    @classmethod
    def _v_type(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in ITEM_TYPES:
            raise ValueError("item_type must be 'product' or 'service'.")
        return value

from typing import Optional
from pydantic import BaseModel


class ProductCreateRequest(BaseModel):
    name: str
    sku: Optional[str] = None
    item_type: str = "product"  # "product" or "service"
    hsn_sac_code: Optional[str] = None
    description: Optional[str] = None
    unit: str = "Nos"
    unit_price: float
    gst_rate: float = 18.0


class ProductUpdateRequest(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    item_type: Optional[str] = None
    hsn_sac_code: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    gst_rate: Optional[float] = None
    is_active: Optional[bool] = None

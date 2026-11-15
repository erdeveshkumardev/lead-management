from datetime import datetime
from typing import Optional
from beanie import Document, Indexed
from pydantic import Field
from app.core.types import Currency


class Product(Document):
    """
    Product & Services Catalog for generating Quotations and Invoices.
    Supports Indian GST HSN/SAC codes and standard tax rates.
    """
    tenant_id: Indexed(str)
    name: str
    sku: Optional[str] = None
    item_type: str = "product"  # "product" or "service"
    hsn_sac_code: Optional[str] = None  # Mandatory for GST compliant billing
    description: Optional[str] = None
    unit: str = "Nos"  # "Nos", "Kg", "Pcs", "Hours", "Mtrs", "Box"
    unit_price: Currency = 0.0
    gst_rate: Currency = 18.0  # 0, 5, 12, 18, 28
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "products"
        indexes = [
            [("tenant_id", 1), ("name", 1)],
            [("tenant_id", 1), ("is_active", 1)]
        ]

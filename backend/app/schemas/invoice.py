from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class InvoiceItemInput(BaseModel):
    product_id: Optional[str] = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=300)
    description: Optional[str] = Field(default=None, max_length=1000)
    hsn_sac_code: Optional[str] = Field(default=None, max_length=8)
    quantity: float = Field(default=1.0, gt=0, le=1_000_000_000)
    unit: str = Field(default="Nos", max_length=20)
    unit_price: float = Field(ge=0, le=1_000_000_000_000)
    discount_percentage: float = Field(default=0.0, ge=0, le=100)
    gst_rate: float = Field(default=18.0, ge=0, le=40)


class CustomerOverride(BaseModel):
    """Billing details captured while converting a lead (saved back to the lead)."""
    company_name: Optional[str] = Field(default=None, max_length=200)
    gstin: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=100)
    pincode: Optional[str] = Field(default=None, max_length=10)
    state_code: Optional[str] = Field(default=None, max_length=2)
    state: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)


class ConvertLeadToInvoiceRequest(BaseModel):
    document_type: str = Field(default="TAX_INVOICE", pattern=r"^(TAX_INVOICE|QUOTATION|PROFORMA)$")
    due_date: Optional[date] = None
    items: List[InvoiceItemInput] = Field(min_length=1, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=2000)
    place_of_supply_code: Optional[str] = Field(default=None, max_length=2)
    customer: Optional[CustomerOverride] = None
    allow_additional_invoice: bool = False


class RecordPaymentRequest(BaseModel):
    amount: float = Field(gt=0, le=1_000_000_000_000)
    payment_mode: str = Field(min_length=2, max_length=20)
    reference_number: Optional[str] = Field(default=None, max_length=60)
    note: Optional[str] = Field(default=None, max_length=500)
    paid_on: Optional[date] = None


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class ConvertQuotationRequest(BaseModel):
    due_date: Optional[date] = None
    allow_additional_invoice: bool = False

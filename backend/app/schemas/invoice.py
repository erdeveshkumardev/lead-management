from datetime import date
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class InvoiceItemInput(BaseModel):
    product_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    hsn_sac_code: Optional[str] = None
    quantity: float = 1.0
    unit: str = "Nos"
    unit_price: float
    discount_percentage: float = 0.0
    gst_rate: float = 18.0


class ConvertLeadToInvoiceRequest(BaseModel):
    document_type: str = "TAX_INVOICE"  # "QUOTATION" or "TAX_INVOICE"
    due_date: Optional[date] = None
    items: List[InvoiceItemInput]
    notes: Optional[str] = None


class RecordPaymentRequest(BaseModel):
    amount: float
    payment_mode: str  # "UPI", "NEFT", "RTGS", "CASH", "CHEQUE"
    reference_number: Optional[str] = None
    note: Optional[str] = None

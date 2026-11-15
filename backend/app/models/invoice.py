from datetime import datetime, date
from typing import List, Optional
from beanie import Document, Indexed
from pydantic import BaseModel, Field
from app.core.types import Currency


class InvoiceParty(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    company_name: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    state_code: Optional[str] = None  # e.g. "24"


class InvoiceItem(BaseModel):
    product_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    hsn_sac_code: Optional[str] = None
    quantity: Currency = 1.0
    unit: str = "Nos"
    unit_price: Currency = 0.0
    discount_percentage: Currency = 0.0
    discount_amount: Currency = 0.0
    taxable_amount: Currency = 0.0
    gst_rate: Currency = 18.0  # e.g. 18.00%
    cgst_rate: Currency = 0.0
    cgst_amount: Currency = 0.0
    sgst_rate: Currency = 0.0
    sgst_amount: Currency = 0.0
    igst_rate: Currency = 0.0
    igst_amount: Currency = 0.0
    total_amount: Currency = 0.0


class InvoiceFinancials(BaseModel):
    taxable_subtotal: Currency = 0.0
    total_discount: Currency = 0.0
    total_cgst: Currency = 0.0
    total_sgst: Currency = 0.0
    total_igst: Currency = 0.0
    total_tax: Currency = 0.0
    round_off: Currency = 0.0
    grand_total: Currency = 0.0
    paid_amount: Currency = 0.0
    balance_due: Currency = 0.0


class PaymentRecord(BaseModel):
    payment_id: str
    amount: Currency
    payment_mode: str  # "UPI", "NEFT", "RTGS", "CASH", "CHEQUE", "CARD"
    reference_number: Optional[str] = None  # UTR or Cheque number
    note: Optional[str] = None
    paid_at: datetime = Field(default_factory=datetime.utcnow)
    recorded_by_id: Optional[str] = None


class Invoice(Document):
    tenant_id: Indexed(str)
    invoice_number: Indexed(str)  # e.g. "INV/2026-27/00042" or "QUOT/2026-27/00012"
    document_type: str = "TAX_INVOICE"  # "QUOTATION", "PROFORMA", "TAX_INVOICE"
    
    # Associated Lead
    lead_id: Optional[str] = None
    
    # Parties
    seller: InvoiceParty
    customer: InvoiceParty

    # Dates
    invoice_date: date
    due_date: Optional[date] = None

    # Line Items & Money
    items: List[InvoiceItem] = Field(default_factory=list)
    financials: InvoiceFinancials = Field(default_factory=InvoiceFinancials)
    
    # Payments
    payment_status: str = "UNPAID"  # "UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"
    payments: List[PaymentRecord] = Field(default_factory=list)

    # Terms & Notes
    terms_and_conditions: Optional[str] = None
    notes: Optional[str] = None
    pdf_file_path: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "invoices"
        indexes = [
            [("tenant_id", 1), ("invoice_number", 1)],
            [("tenant_id", 1), ("document_type", 1)],
            [("tenant_id", 1), ("payment_status", 1)],
            [("tenant_id", 1), ("invoice_date", -1)],
            [("lead_id", 1)]
        ]

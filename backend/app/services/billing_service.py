"""
Lead-to-Cash billing engine: GST computation (Decimal maths), place-of-supply rules,
sequential numbering per financial year, quotation conversion, cancellation and payment ledger.
"""
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from beanie.exceptions import RevisionIdWasChanged
from pymongo import ReturnDocument

from app.core.database import get_db
from app.core.gst import (
    HSN_RE, VALID_GST_RATES, amount_in_words, gstin_error, normalize_gstin, q2, resolve_state_code,
    round_rupee, state_name, to_decimal,
)
from app.core.timeutil import financial_year_label, local_today
from app.core.validators import clean_text
from app.models.invoice import Invoice, InvoiceFinancials, InvoiceItem, InvoiceParty, PaymentRecord
from app.models.lead import Lead, TimelineItem
from app.models.tenant import Tenant
from app.services.lead_service import append_timeline, mutate_lead, refresh_follow_ups

logger = logging.getLogger("app.billing")

DOC_PREFIX = {"TAX_INVOICE": "INV", "QUOTATION": "QUOT", "PROFORMA": "PI"}
DOC_LABEL = {"TAX_INVOICE": "Tax Invoice", "QUOTATION": "Quotation", "PROFORMA": "Proforma Invoice"}
PAYMENT_MODES = {"UPI", "NEFT", "RTGS", "IMPS", "CASH", "CHEQUE", "CARD", "BANK_TRANSFER", "OTHER"}
CASH_LIMIT_PER_TRANSACTION = Decimal("200000")  # Income-tax Act s.269ST: cash of Rs 2 lakh or more is not permitted
MAX_ITEMS = 100


class BillingError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def round_curr(val) -> float:
    return float(q2(val))


async def get_next_document_number(tenant_id: str, doc_type: str = "TAX_INVOICE") -> str:
    """Atomic sequential numbering per tenant, document type and Indian financial year (Apr-Mar, IST)."""
    fy = financial_year_label(local_today())
    prefix = DOC_PREFIX.get(doc_type.upper(), "QUOT")
    counter_id = f"{prefix.lower()}_{tenant_id}_{fy}"
    result = await get_db()["sequence_counters"].find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}, "$setOnInsert": {"tenant_id": tenant_id, "counter_type": doc_type, "financial_year": fy}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"{prefix}/{fy}/{str(result['seq']).zfill(5)}"


def seller_state_code(tenant: Tenant) -> Optional[str]:
    return resolve_state_code(normalize_gstin(tenant.gstin)) or resolve_state_code(tenant.state_code) or resolve_state_code(tenant.state_name)


def calculate_line_item_gst(item_data: Dict[str, Any], is_interstate: bool) -> InvoiceItem:
    qty = to_decimal(item_data.get("quantity", 1))
    rate = to_decimal(item_data.get("unit_price", 0))
    disc_pct = to_decimal(item_data.get("discount_percentage", 0))
    gst_rate = to_decimal(item_data.get("gst_rate", 18))
    if qty <= 0:
        raise BillingError("Item quantity must be greater than zero.")
    if rate < 0:
        raise BillingError("Item price cannot be negative.")
    if not (Decimal("0") <= disc_pct <= Decimal("100")):
        raise BillingError("Discount must be between 0 and 100 percent.")
    if gst_rate not in VALID_GST_RATES:
        raise BillingError(f"GST rate {gst_rate}% is not a valid GST slab.")

    base_amount = q2(qty * rate)
    disc_amt = q2(base_amount * disc_pct / 100)
    taxable = base_amount - disc_amt
    cgst = sgst = igst = Decimal("0")
    cgst_rate = sgst_rate = igst_rate = Decimal("0")
    if is_interstate:
        igst_rate = gst_rate
        igst = q2(taxable * igst_rate / 100)
    else:
        cgst_rate = sgst_rate = gst_rate / 2
        cgst = q2(taxable * cgst_rate / 100)
        sgst = q2(taxable * sgst_rate / 100)
    total = taxable + cgst + sgst + igst
    return InvoiceItem(
        product_id=clean_text(item_data.get("product_id"), 40),
        name=clean_text(item_data.get("name"), 300) or "Product / Service",
        description=clean_text(item_data.get("description"), 1000),
        hsn_sac_code=clean_text(item_data.get("hsn_sac_code"), 8),
        unit=clean_text(item_data.get("unit"), 20) or "Nos",
        quantity=float(qty),
        unit_price=float(rate),
        discount_percentage=float(disc_pct),
        discount_amount=float(disc_amt),
        taxable_amount=float(taxable),
        gst_rate=float(gst_rate),
        cgst_rate=float(cgst_rate),
        cgst_amount=float(cgst),
        sgst_rate=float(sgst_rate),
        sgst_amount=float(sgst),
        igst_rate=float(igst_rate),
        igst_amount=float(igst),
        total_amount=float(total),
    )


def compute_financials(items: List[InvoiceItem]) -> InvoiceFinancials:
    taxable = sum((to_decimal(i.taxable_amount) for i in items), Decimal("0"))
    discount = sum((to_decimal(i.discount_amount) for i in items), Decimal("0"))
    cgst = sum((to_decimal(i.cgst_amount) for i in items), Decimal("0"))
    sgst = sum((to_decimal(i.sgst_amount) for i in items), Decimal("0"))
    igst = sum((to_decimal(i.igst_amount) for i in items), Decimal("0"))
    exact = taxable + cgst + sgst + igst
    grand = round_rupee(exact)
    return InvoiceFinancials(
        taxable_subtotal=float(q2(taxable)),
        total_discount=float(q2(discount)),
        total_cgst=float(q2(cgst)),
        total_sgst=float(q2(sgst)),
        total_igst=float(q2(igst)),
        total_tax=float(q2(cgst + sgst + igst)),
        round_off=float(q2(grand - exact)),
        grand_total=float(grand),
        paid_amount=0.0,
        balance_due=float(grand),
    )


def _won_stage(tenant: Tenant, preferred: str) -> Optional[str]:
    ids = {s.id for s in (tenant.pipeline_stages or [])}
    return preferred if (not ids or preferred in ids) else None


def apply_customer_override(lead: Lead, override: Optional[Dict[str, Any]]) -> None:
    if not override:
        return
    gstin = normalize_gstin(override.get("gstin"))
    if gstin:
        err = gstin_error(gstin)
        if err:
            raise BillingError(f"Customer {err}")
        lead.gstin = gstin
    for field, max_len in (("company_name", 200), ("address", 500), ("city", 100), ("pincode", 10), ("email", 254)):
        value = clean_text(override.get(field), max_len)
        if value:
            setattr(lead, field, value.lower() if field == "email" else value)
    # the state embedded in a GSTIN is authoritative; otherwise use the state chosen in the billing dialog
    code = (resolve_state_code(gstin) or resolve_state_code(override.get("state_code"))
            or resolve_state_code(override.get("state")))
    if code:
        lead.state_code = code
        lead.state = state_name(code)


async def create_invoice_from_lead(
    *,
    lead: Lead,
    tenant: Tenant,
    document_type: str,
    items_raw: List[Dict[str, Any]],
    actor_id: Optional[str],
    actor_name: Optional[str],
    due_date: Optional[date] = None,
    notes: Optional[str] = None,
    place_of_supply_code: Optional[str] = None,
    customer_override: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
    allow_additional_invoice: bool = False,
    source_quotation_id: Optional[str] = None,
) -> Invoice:
    document_type = (document_type or "").upper()
    if document_type not in DOC_PREFIX:
        raise BillingError("document_type must be TAX_INVOICE, QUOTATION or PROFORMA.")
    tenant_id = str(tenant.id)

    if idempotency_key:
        existing = await Invoice.find_one({"tenant_id": tenant_id, "idempotency_key": idempotency_key})
        if existing:
            return existing

    if not items_raw:
        raise BillingError("At least one line item is required.")
    if len(items_raw) > MAX_ITEMS:
        raise BillingError(f"A document can contain at most {MAX_ITEMS} line items.")

    seller_code = seller_state_code(tenant)
    if document_type == "TAX_INVOICE":
        err = gstin_error(tenant.gstin)
        if err:
            raise BillingError(f"Company GSTIN problem: {err} Update it in Settings > Company Profile before issuing tax invoices.")
        if not allow_additional_invoice:
            prior = await Invoice.find_one({"tenant_id": tenant_id, "lead_id": str(lead.id),
                                            "document_type": "TAX_INVOICE", "payment_status": {"$ne": "CANCELLED"}})
            if prior:
                raise BillingError(
                    f"Tax invoice {prior.invoice_number} already exists for this lead. Confirm to create an additional invoice.",
                    status_code=409, code="INVOICE_EXISTS",
                )
        for raw in items_raw:
            hsn = str(raw.get("hsn_sac_code") or "").strip()
            if not HSN_RE.match(hsn):
                raise BillingError(f"HSN/SAC code (4-8 digits) is required for '{raw.get('name') or 'item'}' on a tax invoice.")

    apply_customer_override(lead, customer_override)

    pos = (resolve_state_code(place_of_supply_code)
           or resolve_state_code(normalize_gstin(lead.gstin))
           or resolve_state_code(lead.state_code)
           or resolve_state_code(lead.state))
    if not pos:
        if document_type == "TAX_INVOICE":
            raise BillingError("Place of supply (customer state) is required for a tax invoice. Select the customer's state or enter their GSTIN.")
        pos = seller_code
    if not seller_code:
        raise BillingError("Company state is not configured. Set the company GSTIN or state in Settings.")
    is_interstate = pos != seller_code

    items = [calculate_line_item_gst(raw, is_interstate) for raw in items_raw]
    financials = compute_financials(items)
    today = local_today()
    if due_date and due_date < today:
        raise BillingError("Due date cannot be before the document date.")
    # numbers are allocated only after every validation passed (keeps the GST serial sequence gap-free)
    doc_number = await get_next_document_number(tenant_id, document_type)

    invoice = Invoice(
        tenant_id=tenant_id,
        invoice_number=doc_number,
        document_type=document_type,
        lead_id=str(lead.id),
        seller=InvoiceParty(
            name=tenant.company_name, phone=tenant.phone, email=tenant.email, company_name=tenant.company_name,
            gstin=normalize_gstin(tenant.gstin), pan=tenant.pan_number, address=tenant.address, city=tenant.city,
            state=state_name(seller_code) or tenant.state_name, state_code=seller_code,
        ),
        customer=InvoiceParty(
            name=lead.full_name, phone=lead.phone, email=lead.email, company_name=lead.company_name or lead.full_name,
            gstin=normalize_gstin(lead.gstin), address=lead.address, city=lead.city,
            state=state_name(pos) or lead.state, state_code=pos,
        ),
        invoice_date=today,
        due_date=due_date or today,
        place_of_supply_code=pos,
        place_of_supply_name=state_name(pos),
        is_interstate=is_interstate,
        items=items,
        financials=financials,
        amount_in_words=amount_in_words(financials.grand_total),
        payment_status="UNPAID" if document_type == "TAX_INVOICE" else "NOT_APPLICABLE",
        terms_and_conditions=tenant.default_invoice_terms,
        notes=clean_text(notes, 2000),
        idempotency_key=idempotency_key,
        source_quotation_id=source_quotation_id,
        created_by_id=actor_id,
        created_by_name=actor_name,
    )
    await invoice.insert()

    label = DOC_LABEL[document_type]
    override_snapshot = {k: getattr(lead, k) for k in ("gstin", "address", "city", "pincode", "state", "state_code", "company_name", "email")}

    def _update(l: Lead) -> None:
        for k, v in override_snapshot.items():
            if v:
                setattr(l, k, v)
        l.conversion_info.invoice_number = doc_number
        l.conversion_info.converted_at = datetime.utcnow()
        if document_type == "TAX_INVOICE":
            l.conversion_info.is_converted = True
            l.conversion_info.invoice_id = str(invoice.id)
            l.deal_value = financials.grand_total
            stage = _won_stage(tenant, "WON")
        else:
            l.conversion_info.quotation_id = str(invoice.id)
            if not l.deal_value:
                l.deal_value = financials.grand_total
            stage = _won_stage(tenant, "PROPOSAL_SENT")
        if stage:
            l.stage = stage
        append_timeline(l, TimelineItem(
            activity_type="BILL_GENERATED",
            note=f"{label} #{doc_number} generated for Rs {financials.grand_total:,.2f}",
            performed_by_id=actor_id or "SYSTEM",
            performed_by_name=actor_name or "Billing Engine",
            metadata={"document_type": document_type, "invoice_id": str(invoice.id), "amount": financials.grand_total},
        ))
        refresh_follow_ups(l, datetime.utcnow(), f"Auto-resolved: {label} #{doc_number} generated")

    try:
        await mutate_lead(str(lead.id), tenant_id, _update)
    except Exception:  # the document is already issued; never fail the request because of the CRM back-link
        logger.exception("Invoice %s issued but lead %s could not be updated", doc_number, lead.id)
    return invoice


def active_payments(invoice: Invoice) -> List[PaymentRecord]:
    return [p for p in invoice.payments if not p.is_reversed]


def recompute_payment_state(invoice: Invoice) -> None:
    paid = sum((to_decimal(p.amount) for p in active_payments(invoice)), Decimal("0"))
    grand = to_decimal(invoice.financials.grand_total)
    balance = max(Decimal("0"), grand - paid)
    invoice.financials.paid_amount = float(q2(paid))
    invoice.financials.balance_due = float(q2(balance))
    if invoice.payment_status == "CANCELLED" or invoice.document_type != "TAX_INVOICE":
        return
    if balance <= 0:
        invoice.payment_status = "PAID"
    elif invoice.due_date and invoice.due_date < local_today():
        invoice.payment_status = "OVERDUE"
    elif paid > 0:
        invoice.payment_status = "PARTIALLY_PAID"
    else:
        invoice.payment_status = "UNPAID"


async def _save_invoice(invoice: Invoice) -> None:
    invoice.updated_at = datetime.utcnow()
    try:
        await invoice.save()
    except RevisionIdWasChanged:
        raise BillingError("This invoice was modified by someone else. Refresh and try again.", status_code=409)


async def record_payment(invoice: Invoice, *, amount: float, payment_mode: str, reference_number: Optional[str],
                         note: Optional[str], actor_id: str, actor_name: str, paid_on: Optional[date] = None,
                         require_reference: bool = True) -> PaymentRecord:
    if invoice.document_type != "TAX_INVOICE":
        raise BillingError("Payments can only be recorded against tax invoices.")
    if invoice.payment_status == "CANCELLED":
        raise BillingError("Cannot record a payment on a cancelled invoice.")
    mode = (payment_mode or "").upper().strip()
    if mode not in PAYMENT_MODES:
        raise BillingError(f"Payment mode must be one of: {', '.join(sorted(PAYMENT_MODES))}.")
    pay = q2(amount)
    if pay <= 0:
        raise BillingError("Payment amount must be greater than 0.")
    balance = to_decimal(invoice.financials.balance_due)
    if pay > balance:
        raise BillingError(f"Payment of Rs {pay:,.2f} exceeds the balance due of Rs {balance:,.2f}.")
    if mode == "CASH" and pay >= CASH_LIMIT_PER_TRANSACTION:
        raise BillingError("Cash receipts of Rs 2,00,000 or more in a single transaction are not permitted (Income-tax Act s.269ST).")
    if (require_reference and mode in {"NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "BANK_TRANSFER"}
            and not (reference_number or "").strip()):
        raise BillingError("A reference number (UTR / cheque no.) is required for this payment mode.")

    paid_at = datetime.combine(paid_on, datetime.min.time()) if paid_on else datetime.utcnow()
    record = PaymentRecord(
        payment_id=f"PAY_{uuid.uuid4().hex[:12].upper()}",
        amount=float(pay),
        payment_mode=mode,
        reference_number=clean_text(reference_number, 60),
        note=clean_text(note, 500),
        paid_at=paid_at,
        recorded_by_id=actor_id,
        recorded_by_name=actor_name,
    )
    invoice.payments.append(record)
    recompute_payment_state(invoice)
    await _save_invoice(invoice)
    return record


async def reverse_payment(invoice: Invoice, payment_id: str, *, reason: str, actor_id: str) -> PaymentRecord:
    matches = [p for p in invoice.payments if p.payment_id == payment_id]
    if not matches:
        raise BillingError("Payment not found.", status_code=404)
    # Ids are unique for payments recorded by this version. Earlier versions derived the id from the clock, so two
    # payments entered in the same second share one: the first that is still standing is the one reversed.
    p = next((m for m in matches if not m.is_reversed), None)
    if p is None:
        raise BillingError("Payment is already reversed.")
    p.is_reversed = True
    p.reversed_at = datetime.utcnow()
    p.reversed_by_id = actor_id
    p.reversal_reason = clean_text(reason, 500)
    recompute_payment_state(invoice)
    await _save_invoice(invoice)
    return p


async def cancel_invoice(invoice: Invoice, *, reason: str, actor_id: str, actor_name: str) -> Invoice:
    if invoice.payment_status == "CANCELLED":
        raise BillingError("Document is already cancelled.")
    if active_payments(invoice):
        raise BillingError("Reverse all recorded payments before cancelling this invoice.")
    if not (reason or "").strip():
        raise BillingError("A cancellation reason is required.")
    invoice.payment_status = "CANCELLED"
    invoice.cancelled_at = datetime.utcnow()
    invoice.cancelled_by_id = actor_id
    invoice.cancellation_reason = clean_text(reason, 500)
    await _save_invoice(invoice)

    if invoice.lead_id:
        def _update(l: Lead) -> None:
            if l.conversion_info.invoice_id == str(invoice.id):
                l.conversion_info.invoice_id = None
                l.conversion_info.is_converted = False
            if l.conversion_info.quotation_id == str(invoice.id):
                l.conversion_info.quotation_id = None
            append_timeline(l, TimelineItem(
                activity_type="BILL_CANCELLED",
                note=f"{DOC_LABEL.get(invoice.document_type, 'Document')} #{invoice.invoice_number} cancelled. Reason: {invoice.cancellation_reason}",
                performed_by_id=actor_id, performed_by_name=actor_name,
            ))
        try:
            await mutate_lead(invoice.lead_id, invoice.tenant_id, _update)
        except Exception:  # the cancellation itself is already saved
            logger.warning("Invoice %s cancelled but its lead could not be updated", invoice.invoice_number)
    return invoice


def invoice_items_as_raw(invoice: Invoice) -> List[Dict[str, Any]]:
    return [{
        "product_id": i.product_id, "name": i.name, "description": i.description, "hsn_sac_code": i.hsn_sac_code,
        "quantity": i.quantity, "unit": i.unit, "unit_price": i.unit_price,
        "discount_percentage": i.discount_percentage, "gst_rate": i.gst_rate,
    } for i in invoice.items]

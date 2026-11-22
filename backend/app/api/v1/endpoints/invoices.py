from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response

from app.core import rate_limiter
from app.core.audit import audit
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, require_permission, resolve_tenant_id
from app.core.timeutil import local_today
from app.core.validators import safe_regex
from app.models.invoice import Invoice
from app.models.lead import Lead, TimelineItem
from app.models.tenant import Tenant
from app.schemas.invoice import ConvertLeadToInvoiceRequest, ConvertQuotationRequest, ReasonRequest, RecordPaymentRequest
from app.services import billing_service
from app.services.billing_service import BillingError
from app.services.lead_service import append_timeline, mutate_lead
from app.services.pdf_service import generate_invoice_pdf_bytes

router = APIRouter(prefix="/invoices", tags=["Invoices & Billing"])

DOC_TYPES = {"TAX_INVOICE", "QUOTATION", "PROFORMA"}


def serialize_invoice(invoice: Invoice) -> Dict[str, Any]:
    data = invoice.model_dump(mode="json", exclude={"revision_id", "id", "pdf_file_path", "idempotency_key"})
    data["_id"] = data["id"] = str(invoice.id)
    # reflect overdue state even before the nightly job has run
    if (invoice.document_type == "TAX_INVOICE" and invoice.payment_status in ("UNPAID", "PARTIALLY_PAID")
            and invoice.due_date and invoice.due_date < local_today() and invoice.financials.balance_due > 0):
        data["payment_status"] = "OVERDUE"
    return data


def _billing_http_error(exc: BillingError) -> HTTPException:
    detail: Any = exc.message
    if exc.code:
        detail = {"code": exc.code, "message": exc.message}
    return HTTPException(status_code=exc.status_code, detail=detail)


def _scope(ctx: AuthContext, query: Dict[str, Any]) -> Dict[str, Any]:
    """Users who only see their own leads also only see the documents they raised."""
    if not ctx.has("leads_view_all"):
        query["created_by_id"] = ctx.user_id
    return query


async def _load_invoice(ctx: AuthContext, invoice_id: str, tenant_id: Optional[str] = None) -> Invoice:
    tid = await resolve_tenant_id(ctx, tenant_id)
    invoice = await get_document_by_id(Invoice, invoice_id)
    if not invoice or invoice.tenant_id != tid:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not ctx.has("leads_view_all") and invoice.created_by_id != ctx.user_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


async def _load_tenant(tid: str) -> Tenant:
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant


async def _log_payment_on_lead(ctx: AuthContext, invoice: Invoice, record) -> None:
    if not invoice.lead_id:
        return

    def _mutate(l: Lead) -> None:
        append_timeline(l, TimelineItem(
            activity_type="PAYMENT_RECEIVED",
            note=f"Payment of Rs {record.amount:,.2f} received via {record.payment_mode} against {invoice.invoice_number}. "
                 f"Ref: {record.reference_number or 'N/A'}",
            performed_by_id=ctx.user_id, performed_by_name=ctx.display_name,
            metadata={"invoice_id": str(invoice.id), "payment_id": record.payment_id},
        ))

    try:
        await mutate_lead(invoice.lead_id, invoice.tenant_id, _mutate)
    except HTTPException:
        pass  # the lead may have been deleted; the payment itself is already recorded


@router.post("/from-lead/{lead_id}", status_code=201)
async def convert_lead_to_bill(
    lead_id: str, payload: ConvertLeadToInvoiceRequest, tenant_id: Optional[str] = None,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key", max_length=80),
    ctx: AuthContext = Depends(require_permission("billing_convert")),
):
    """
    Converts a lead into a Quotation, Proforma or GST Tax Invoice.
    CGST+SGST vs IGST is decided from the place of supply (customer GSTIN / state) vs the company's state.
    """
    tid = await resolve_tenant_id(ctx, tenant_id)
    lead = await get_document_by_id(Lead, lead_id)
    if not lead or lead.tenant_id != tid or lead.is_deleted:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not ctx.has("leads_view_all") and lead.assigned_to_user_id != ctx.user_id:
        raise HTTPException(status_code=404, detail="Lead not found")
    tenant = await _load_tenant(tid)
    try:
        invoice = await billing_service.create_invoice_from_lead(
            lead=lead, tenant=tenant, document_type=payload.document_type,
            items_raw=[item.model_dump() for item in payload.items], actor_id=ctx.user_id, actor_name=ctx.display_name,
            due_date=payload.due_date, notes=payload.notes, place_of_supply_code=payload.place_of_supply_code,
            customer_override=payload.customer.model_dump(exclude_none=True) if payload.customer else None,
            idempotency_key=idempotency_key, allow_additional_invoice=payload.allow_additional_invoice,
        )
    except BillingError as exc:
        raise _billing_http_error(exc)
    await audit("invoice.created", ctx=ctx, tenant_id=tid, entity_type="invoice", entity_id=str(invoice.id),
                details={"number": invoice.invoice_number, "type": invoice.document_type, "amount": invoice.financials.grand_total})
    return {
        "status": "success",
        "message": f"{billing_service.DOC_LABEL[invoice.document_type]} {invoice.invoice_number} created successfully",
        "invoice_number": invoice.invoice_number,
        "invoice_id": str(invoice.id),
        "invoice": serialize_invoice(invoice),
    }


@router.get("/")
async def list_invoices(
    tenant_id: Optional[str] = None, document_type: Optional[str] = None, payment_status: Optional[str] = None,
    search: Optional[str] = Query(default=None, max_length=100),
    lead_id: Optional[str] = Query(default=None, max_length=40, pattern=r"^[0-9a-fA-F]{24}$"),
    skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
    ctx: AuthContext = Depends(require_permission("billing_view")),
):
    tid = await resolve_tenant_id(ctx, tenant_id)
    query: Dict[str, Any] = _scope(ctx, {"tenant_id": tid})
    if lead_id:
        # documents raised for one lead (the lead screen); still limited to the caller's company and scope
        query["lead_id"] = lead_id
    if document_type:
        if document_type not in DOC_TYPES:
            raise HTTPException(status_code=400, detail="Unknown document_type.")
        query["document_type"] = document_type
    if payment_status == "OVERDUE":
        query["payment_status"] = {"$in": ["OVERDUE", "UNPAID", "PARTIALLY_PAID"]}
        query["due_date"] = {"$lt": datetime.combine(local_today(), datetime.min.time())}
        query["document_type"] = "TAX_INVOICE"
    elif payment_status:
        query["payment_status"] = payment_status.upper()[:20]
    if search and search.strip():
        pattern = {"$regex": safe_regex(search), "$options": "i"}
        query["$or"] = [{"invoice_number": pattern}, {"customer.name": pattern}, {"customer.company_name": pattern}]
    invoices = await Invoice.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    total = await Invoice.find(query).count()
    return {"total": total, "skip": skip, "limit": limit, "items": [serialize_invoice(i) for i in invoices]}


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str, tenant_id: Optional[str] = None,
                      ctx: AuthContext = Depends(require_permission("billing_view"))):
    return serialize_invoice(await _load_invoice(ctx, invoice_id, tenant_id))


@router.get("/{invoice_id}/pdf")
async def download_invoice_pdf(invoice_id: str, tenant_id: Optional[str] = None,
                               ctx: AuthContext = Depends(require_permission("billing_view"))):
    """PDF is rendered in memory for the authenticated user (nothing is written to shared disk)."""
    invoice = await _load_invoice(ctx, invoice_id, tenant_id)
    await rate_limiter.enforce(f"pdf:{ctx.user_id}", 60, 60)
    tenant = await _load_tenant(invoice.tenant_id)
    pdf = generate_invoice_pdf_bytes(invoice, tenant)
    filename = invoice.invoice_number.replace("/", "_") + ".pdf"
    await audit("invoice.pdf_downloaded", ctx=ctx, tenant_id=invoice.tenant_id, entity_type="invoice", entity_id=str(invoice.id))
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    })


@router.post("/{invoice_id}/payments")
async def record_payment(invoice_id: str, payload: RecordPaymentRequest, tenant_id: Optional[str] = None,
                         ctx: AuthContext = Depends(require_permission("billing_payments"))):
    invoice = await _load_invoice(ctx, invoice_id, tenant_id)
    if payload.paid_on and payload.paid_on > local_today():
        raise HTTPException(status_code=400, detail="Payment date cannot be in the future.")
    try:
        record = await billing_service.record_payment(
            invoice, amount=payload.amount, payment_mode=payload.payment_mode, reference_number=payload.reference_number,
            note=payload.note, actor_id=ctx.user_id, actor_name=ctx.display_name, paid_on=payload.paid_on,
        )
    except BillingError as exc:
        raise _billing_http_error(exc)

    await _log_payment_on_lead(ctx, invoice, record)
    await audit("invoice.payment_recorded", ctx=ctx, tenant_id=invoice.tenant_id, entity_type="invoice", entity_id=str(invoice.id),
                details={"number": invoice.invoice_number, "amount": record.amount, "mode": record.payment_mode,
                         "payment_id": record.payment_id})
    return {
        "status": "success", "message": "Payment recorded successfully", "payment_status": invoice.payment_status,
        "paid_amount": invoice.financials.paid_amount, "balance_due": invoice.financials.balance_due,
        "invoice": serialize_invoice(invoice),
    }


@router.post("/{invoice_id}/mark-as-paid")
async def mark_invoice_as_paid(invoice_id: str, tenant_id: Optional[str] = None,
                               payment_mode: str = Query("UPI", max_length=20),
                               reference_number: Optional[str] = Query(None, max_length=60),
                               ctx: AuthContext = Depends(require_permission("billing_payments"))):
    """1-click settlement: records one payment for the full outstanding balance of a tax invoice."""
    invoice = await _load_invoice(ctx, invoice_id, tenant_id)
    if invoice.document_type == "TAX_INVOICE" and invoice.payment_status != "CANCELLED" and invoice.financials.balance_due <= 0:
        return {"status": "success", "message": "Invoice is already fully paid", "payment_status": invoice.payment_status,
                "balance_due": 0.0, "invoice": serialize_invoice(invoice)}
    try:
        record = await billing_service.record_payment(
            invoice, amount=invoice.financials.balance_due, payment_mode=payment_mode,
            reference_number=reference_number, note="Marked as paid (1-click settlement)",
            actor_id=ctx.user_id, actor_name=ctx.display_name, require_reference=False,
        )
    except BillingError as exc:
        raise _billing_http_error(exc)
    await _log_payment_on_lead(ctx, invoice, record)
    await audit("invoice.marked_paid", ctx=ctx, tenant_id=invoice.tenant_id, entity_type="invoice", entity_id=str(invoice.id),
                details={"number": invoice.invoice_number, "amount": record.amount, "mode": record.payment_mode,
                         "payment_id": record.payment_id})
    return {"status": "success", "message": "Invoice marked as PAID successfully", "payment_status": invoice.payment_status,
            "balance_due": invoice.financials.balance_due, "invoice": serialize_invoice(invoice)}


@router.post("/{invoice_id}/payments/{payment_id}/reverse")
async def reverse_payment(invoice_id: str, payment_id: str, payload: ReasonRequest, tenant_id: Optional[str] = None,
                          ctx: AuthContext = Depends(require_permission("billing_payments"))):
    invoice = await _load_invoice(ctx, invoice_id, tenant_id)
    try:
        record = await billing_service.reverse_payment(invoice, payment_id, reason=payload.reason, actor_id=ctx.user_id)
    except BillingError as exc:
        raise _billing_http_error(exc)
    await audit("invoice.payment_reversed", ctx=ctx, tenant_id=invoice.tenant_id, entity_type="invoice", entity_id=str(invoice.id),
                details={"number": invoice.invoice_number, "amount": record.amount, "payment_id": payment_id, "reason": payload.reason})
    return {"status": "success", "message": "Payment reversed", "invoice": serialize_invoice(invoice)}


@router.post("/{invoice_id}/cancel")
async def cancel_invoice(invoice_id: str, payload: ReasonRequest, tenant_id: Optional[str] = None,
                         ctx: AuthContext = Depends(require_permission("billing_cancel"))):
    """Issued documents are never edited or deleted - they are cancelled with a reason and stay on record."""
    invoice = await _load_invoice(ctx, invoice_id, tenant_id)
    try:
        await billing_service.cancel_invoice(invoice, reason=payload.reason, actor_id=ctx.user_id, actor_name=ctx.display_name)
    except BillingError as exc:
        raise _billing_http_error(exc)
    await audit("invoice.cancelled", ctx=ctx, tenant_id=invoice.tenant_id, entity_type="invoice", entity_id=str(invoice.id),
                details={"number": invoice.invoice_number, "reason": payload.reason})
    return {"status": "success", "message": f"{invoice.invoice_number} cancelled", "invoice": serialize_invoice(invoice)}


@router.post("/{invoice_id}/convert-to-invoice", status_code=201)
async def convert_quotation_to_invoice(invoice_id: str, payload: ConvertQuotationRequest, tenant_id: Optional[str] = None,
                                       ctx: AuthContext = Depends(require_permission("billing_convert"))):
    quotation = await _load_invoice(ctx, invoice_id, tenant_id)
    if quotation.document_type not in ("QUOTATION", "PROFORMA"):
        raise HTTPException(status_code=400, detail="Only quotations and proforma invoices can be converted.")
    if quotation.payment_status == "CANCELLED":
        raise HTTPException(status_code=400, detail="A cancelled document cannot be converted.")
    if quotation.converted_invoice_id:
        existing = await get_document_by_id(Invoice, quotation.converted_invoice_id)
        if existing and existing.payment_status != "CANCELLED":
            raise HTTPException(status_code=409, detail=f"Already converted to {existing.invoice_number}.")
    lead = await get_document_by_id(Lead, quotation.lead_id) if quotation.lead_id else None
    if not lead or lead.tenant_id != quotation.tenant_id or lead.is_deleted:
        raise HTTPException(status_code=400, detail="The lead for this quotation no longer exists.")
    tenant = await _load_tenant(quotation.tenant_id)
    try:
        invoice = await billing_service.create_invoice_from_lead(
            lead=lead, tenant=tenant, document_type="TAX_INVOICE",
            items_raw=billing_service.invoice_items_as_raw(quotation), actor_id=ctx.user_id, actor_name=ctx.display_name,
            due_date=payload.due_date, notes=quotation.notes,
            place_of_supply_code=quotation.place_of_supply_code or quotation.customer.state_code,
            allow_additional_invoice=payload.allow_additional_invoice, source_quotation_id=str(quotation.id),
        )
    except BillingError as exc:
        raise _billing_http_error(exc)
    quotation.converted_invoice_id = str(invoice.id)
    quotation.updated_at = datetime.utcnow()
    await quotation.save()
    await audit("invoice.quotation_converted", ctx=ctx, tenant_id=invoice.tenant_id, entity_type="invoice", entity_id=str(invoice.id),
                details={"quotation": quotation.invoice_number, "invoice": invoice.invoice_number})
    return {"status": "success", "message": f"{quotation.invoice_number} converted to {invoice.invoice_number}",
            "invoice_id": str(invoice.id), "invoice": serialize_invoice(invoice)}

from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.database import get_document_by_id
from app.models.invoice import Invoice, PaymentRecord
from app.models.lead import Lead, TimelineItem
from app.schemas.invoice import ConvertLeadToInvoiceRequest, RecordPaymentRequest
from app.services.billing_service import create_invoice_from_lead, round_curr
from app.services.pdf_service import generate_invoice_pdf

router = APIRouter(prefix="/invoices", tags=["Invoices & Billing"])


@router.post("/from-lead/{lead_id}")
async def convert_lead_to_bill(
    lead_id: str,
    tenant_id: str,
    payload: ConvertLeadToInvoiceRequest
):
    """
    Main Lead-to-Bill Conversion Engine:
    Converts a Lead into a Quotation or final GST Tax Invoice.
    Automatically:
    - Calculates CGST/SGST (intra-state) or IGST (inter-state)
    - Allocates sequential invoice number (e.g. INV/2026-27/00042)
    - Sets Lead stage to WON (if Tax Invoice) or PROPOSAL_SENT (if Quotation)
    - Logs bill generation in the Lead's activity timeline
    """
    try:
        items_dict = [itm.model_dump() for itm in payload.items]
        invoice = await create_invoice_from_lead(
            lead_id=lead_id,
            tenant_id=tenant_id,
            document_type=payload.document_type,
            items_raw=items_dict,
            due_date=payload.due_date,
            notes=payload.notes
        )
        return {
            "status": "success",
            "message": f"{payload.document_type} created successfully",
            "invoice_number": invoice.invoice_number,
            "invoice_id": str(invoice.id),
            "invoice": invoice
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Billing conversion error: {str(e)}")


@router.get("/")
async def list_invoices(
    tenant_id: str,
    document_type: Optional[str] = None,
    payment_status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50
):
    from app.models.tenant import Tenant
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})

    tenant_ids = [tenant_id]
    if tenant:
        tenant_ids.append(str(tenant.id))
        if tenant.slug in ["apex-machineries", "demo_tenant_01"] or str(tenant.id) == "6af82cb4684ef5d29122f856":
            tenant_ids.append("demo_tenant_01")
    elif tenant_id == "demo_tenant_01":
        first_t = await Tenant.find_one()
        if first_t:
            tenant_ids.append(str(first_t.id))

    query = {"tenant_id": {"$in": list(set(tenant_ids))}}
    if document_type:
        query["document_type"] = document_type
    if payment_status:
        query["payment_status"] = payment_status

    invoices = await Invoice.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    total = await Invoice.find(query).count()
    return {"total": total, "items": invoices}


async def _verify_invoice_access(invoice: Optional[Invoice], tenant_id: Optional[str]) -> Invoice:
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not tenant_id or tenant_id in ("demo_tenant_01", "default", invoice.tenant_id):
        return invoice
    from app.models.tenant import Tenant
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
    if tenant and str(tenant.id) == invoice.tenant_id:
        return invoice
    raise HTTPException(status_code=404, detail="Invoice not found")


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str, tenant_id: Optional[str] = Query(None)):
    invoice = await get_document_by_id(Invoice, invoice_id)
    return await _verify_invoice_access(invoice, tenant_id)


@router.get("/{invoice_id}/pdf")
async def download_invoice_pdf(invoice_id: str, tenant_id: Optional[str] = Query(None)):
    """
    Generates and returns the branded GST Tax Invoice / Quotation PDF.
    """
    invoice = await get_document_by_id(Invoice, invoice_id)
    invoice = await _verify_invoice_access(invoice, tenant_id)

    pdf_path = generate_invoice_pdf(invoice)
    clean_number = invoice.invoice_number.replace("/", "_")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{clean_number}.pdf"
    )


@router.post("/{invoice_id}/payments")
async def record_payment(
    invoice_id: str,
    payload: RecordPaymentRequest,
    tenant_id: Optional[str] = Query(None)
):
    """
    Records full or partial payment against an invoice.
    Updates paid amount, balance due, payment status, and logs receipt.
    """
    invoice = await get_document_by_id(Invoice, invoice_id)
    invoice = await _verify_invoice_access(invoice, tenant_id)

    pay_amount = round_curr(payload.amount)
    if pay_amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than 0")

    payment_record = PaymentRecord(
        payment_id=f"PAY_{int(datetime.utcnow().timestamp())}",
        amount=pay_amount,
        payment_mode=payload.payment_mode,
        reference_number=payload.reference_number,
        note=payload.note,
        paid_at=datetime.utcnow()
    )

    invoice.payments.append(payment_record)
    invoice.financials.paid_amount = round_curr(invoice.financials.paid_amount + pay_amount)
    invoice.financials.balance_due = round_curr(invoice.financials.grand_total - invoice.financials.paid_amount)

    if invoice.financials.balance_due <= 0:
        invoice.financials.balance_due = 0.0
        invoice.payment_status = "PAID"
    else:
        invoice.payment_status = "PARTIALLY_PAID"

    invoice.updated_at = datetime.utcnow()
    await invoice.save()

    # If lead exists, update lead timeline as well
    if invoice.lead_id:
        lead = await get_document_by_id(Lead, invoice.lead_id)
        if lead:
            lead.timeline.append(
                TimelineItem(
                    activity_type="PAYMENT_RECEIVED",
                    note=f"Payment of Rs {pay_amount:,.2f} received via {payload.payment_mode}. Ref: {payload.reference_number or 'N/A'}",
                    performed_by_id="SYSTEM",
                    performed_by_name="Payment Gateway"
                )
            )
            await lead.save()

    return {
        "status": "success",
        "message": "Payment recorded successfully",
        "payment_status": invoice.payment_status,
        "paid_amount": invoice.financials.paid_amount,
        "balance_due": invoice.financials.balance_due,
        "invoice": invoice
    }


@router.post("/{invoice_id}/mark-as-paid")
async def mark_invoice_as_paid(
    invoice_id: str,
    tenant_id: Optional[str] = Query(None),
    payment_mode: str = Query("UPI")
):
    """
    1-Click Settlement: Marks the remaining balance due of an invoice or quotation as PAID.
    """
    invoice = await get_document_by_id(Invoice, invoice_id)
    invoice = await _verify_invoice_access(invoice, tenant_id)

    remaining = invoice.financials.balance_due
    if remaining <= 0:
        return {"status": "success", "message": "Invoice is already fully paid", "invoice": invoice}

    payment_record = PaymentRecord(
        payment_id=f"PAY_{int(datetime.utcnow().timestamp())}",
        amount=remaining,
        payment_mode=payment_mode,
        reference_number="FULL_SETTLEMENT",
        note="Marked as Paid via 1-Click Settlement",
        paid_at=datetime.utcnow()
    )
    invoice.payments.append(payment_record)
    invoice.financials.paid_amount = round_curr(invoice.financials.grand_total)
    invoice.financials.balance_due = 0.0
    invoice.payment_status = "PAID"
    invoice.updated_at = datetime.utcnow()
    await invoice.save()

    if invoice.lead_id:
        lead = await get_document_by_id(Lead, invoice.lead_id)
        if lead:
            lead.timeline.append(
                TimelineItem(
                    activity_type="PAYMENT_RECEIVED",
                    note=f"Full balance of Rs {remaining:,.2f} marked as PAID via {payment_mode}.",
                    performed_by_id="SYSTEM",
                    performed_by_name="LeadCRM Ledger"
                )
            )
            await lead.save()

    return {
        "status": "success",
        "message": "Invoice marked as PAID successfully",
        "payment_status": "PAID",
        "balance_due": 0.0,
        "invoice": invoice
    }

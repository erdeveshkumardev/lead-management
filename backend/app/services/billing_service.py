from datetime import datetime, date
from typing import List, Dict, Any, Optional
from bson import ObjectId

from app.core.database import get_db, get_document_by_id
from app.models.tenant import Tenant
from app.models.lead import Lead, TimelineItem
from app.models.invoice import Invoice, InvoiceItem, InvoiceParty, InvoiceFinancials, PaymentRecord


def round_curr(val: float) -> float:
    """Rounds currency to 2 decimal places"""
    return round(float(val), 2)


async def get_next_document_number(tenant_id: str, doc_type: str = "invoice") -> str:
    """
    Generates an atomic, sequential invoice or quotation number.
    Format: INV/2026-27/00001 or QUOT/2026-27/00001
    No race conditions in MongoDB.
    """
    db = get_db()
    today = date.today()
    
    # Financial Year logic for India (April to March)
    if today.month >= 4:
        fy = f"{str(today.year)[-2:]}-{str(today.year + 1)[-2:]}"
    else:
        fy = f"{str(today.year - 1)[-2:]}-{str(today.year)[-2:]}"

    prefix = "INV" if doc_type.upper() == "TAX_INVOICE" else "QUOT"
    counter_id = f"{prefix.lower()}_{tenant_id}_{fy}"

    result = await db["sequence_counters"].find_one_and_update(
        {"_id": counter_id},
        {
            "$inc": {"seq": 1},
            "$setOnInsert": {
                "tenant_id": tenant_id,
                "counter_type": doc_type,
                "financial_year": fy,
            }
        },
        upsert=True,
        return_document=True
    )

    seq_val = str(result["seq"]).zfill(5)
    return f"{prefix}/{fy}/{seq_val}"


def calculate_line_item_gst(
    item_data: Dict[str, Any], 
    is_interstate: bool
) -> InvoiceItem:
    """
    Calculates line item taxable value, discount, and CGST/SGST vs IGST
    """
    qty = float(item_data.get("quantity", 1))
    rate = float(item_data.get("unit_price", 0))
    disc_pct = float(item_data.get("discount_percentage", 0))
    gst_rate = float(item_data.get("gst_rate", 18))

    base_amount = round_curr(qty * rate)
    disc_amt = round_curr((base_amount * disc_pct) / 100.0)
    taxable_val = round_curr(base_amount - disc_amt)

    if is_interstate:
        # Inter-state: Full IGST
        cgst_rate = 0.0
        cgst_amt = 0.0
        sgst_rate = 0.0
        sgst_amt = 0.0
        igst_rate = gst_rate
        igst_amt = round_curr((taxable_val * igst_rate) / 100.0)
    else:
        # Intra-state: 50% CGST + 50% SGST
        half_rate = gst_rate / 2.0
        cgst_rate = half_rate
        cgst_amt = round_curr((taxable_val * half_rate) / 100.0)
        sgst_rate = half_rate
        sgst_amt = round_curr((taxable_val * half_rate) / 100.0)
        igst_rate = 0.0
        igst_amt = 0.0

    total_item = round_curr(taxable_val + cgst_amt + sgst_amt + igst_amt)

    return InvoiceItem(
        product_id=str(item_data.get("product_id")) if item_data.get("product_id") else None,
        name=item_data.get("name", "Product / Service"),
        description=item_data.get("description"),
        hsn_sac_code=item_data.get("hsn_sac_code"),
        unit=item_data.get("unit", "Nos"),
        quantity=qty,
        unit_price=rate,
        discount_percentage=disc_pct,
        discount_amount=disc_amt,
        taxable_amount=taxable_val,
        gst_rate=gst_rate,
        cgst_rate=cgst_rate,
        cgst_amount=cgst_amt,
        sgst_rate=sgst_rate,
        sgst_amount=sgst_amt,
        igst_rate=igst_rate,
        igst_amount=igst_amt,
        total_amount=total_item
    )


async def create_invoice_from_lead(
    lead_id: str,
    tenant_id: str,
    document_type: str,  # "QUOTATION" or "TAX_INVOICE"
    items_raw: List[Dict[str, Any]],
    due_date: Optional[date] = None,
    notes: Optional[str] = None
) -> Invoice:
    """
    Core Lead-to-Bill Conversion:
    1. Loads Lead and Tenant details
    2. Compares State Codes for GST calculation (Intra vs Inter state)
    3. Computes items, taxes, totals
    4. Generates unique atomic invoice number
    5. Saves Invoice and links to Lead
    6. Updates Lead stage to 'WON' and logs conversion activity
    """
    lead = await get_document_by_id(Lead, lead_id)
    if not lead:
        raise ValueError("Lead not found")
    if lead.tenant_id:
        tenant_id = lead.tenant_id

    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"company_name": tenant_id}, {"_id": tenant_id}]})
    if not tenant:
        tenant = await Tenant.find_one()
    if not tenant:
        tenant = Tenant(
            company_name="Apex Machineries Pvt Ltd",
            company_type="manufacturing",
            gstin="24ABCDE1234F1Z5",
            state_code="24",
            state_name="Gujarat",
            address="Plot 42, GIDC Industrial Estate",
            city="Ahmedabad",
            phone="+919876543210",
            email="sales@apexmachineries.com"
        )
        await tenant.insert()

    # Determine Intra-state vs Inter-state
    seller_state = (tenant.state_code or "").strip()
    cust_state = (lead.state or "").strip()

    # Inter-state if state codes are provided and different
    is_interstate = False
    if seller_state and cust_state:
        is_interstate = (seller_state.lower() != cust_state.lower())

    # Calculate all line items
    calculated_items: List[InvoiceItem] = []
    subtotal = 0.0
    total_disc = 0.0
    total_cgst = 0.0
    total_sgst = 0.0
    total_igst = 0.0

    for raw_item in items_raw:
        item = calculate_line_item_gst(raw_item, is_interstate)
        calculated_items.append(item)
        subtotal += item.taxable_amount
        total_disc += item.discount_amount
        total_cgst += item.cgst_amount
        total_sgst += item.sgst_amount
        total_igst += item.igst_amount

    total_tax = round_curr(total_cgst + total_sgst + total_igst)
    raw_grand = subtotal + total_tax
    rounded_grand = round_curr(raw_grand)
    round_off = round_curr(rounded_grand - raw_grand)

    financials = InvoiceFinancials(
        taxable_subtotal=round_curr(subtotal),
        total_discount=round_curr(total_disc),
        total_cgst=round_curr(total_cgst),
        total_sgst=round_curr(total_sgst),
        total_igst=round_curr(total_igst),
        total_tax=round_curr(total_tax),
        round_off=round_off,
        grand_total=rounded_grand,
        paid_amount=0.0,
        balance_due=rounded_grand
    )

    doc_number = await get_next_document_number(tenant_id, document_type)

    seller_party = InvoiceParty(
        name=tenant.company_name,
        phone=tenant.phone,
        email=tenant.email,
        company_name=tenant.company_name,
        gstin=tenant.gstin,
        pan=tenant.pan_number,
        address=tenant.address,
        city=tenant.city,
        state=tenant.state_name,
        state_code=tenant.state_code
    )

    customer_party = InvoiceParty(
        name=lead.full_name,
        phone=lead.phone,
        email=lead.email,
        company_name=lead.company_name or lead.full_name,
        gstin=lead.gstin,
        address=lead.address,
        city=lead.city,
        state=lead.state,
        state_code=lead.state
    )

    invoice = Invoice(
        tenant_id=tenant_id,
        invoice_number=doc_number,
        document_type=document_type,
        lead_id=str(lead.id),
        seller=seller_party,
        customer=customer_party,
        invoice_date=date.today(),
        due_date=due_date or date.today(),
        items=calculated_items,
        financials=financials,
        payment_status="UNPAID",
        terms_and_conditions=tenant.default_invoice_terms,
        notes=notes
    )

    await invoice.insert()

    # Update Lead record with conversion info
    lead.conversion_info.is_converted = True
    lead.conversion_info.invoice_number = doc_number
    if document_type == "TAX_INVOICE":
        lead.conversion_info.invoice_id = str(invoice.id)
        lead.stage = "WON"
    else:
        lead.conversion_info.quotation_id = str(invoice.id)
        lead.stage = "PROPOSAL_SENT"

    lead.conversion_info.converted_at = datetime.utcnow()
    lead.deal_value = financials.grand_total

    # Add timeline record
    lead.timeline.append(
        TimelineItem(
            activity_type="BILL_GENERATED",
            note=f"{document_type.replace('_', ' ')} #{doc_number} generated for amount Rs {financials.grand_total:,.2f}",
            performed_by_id="SYSTEM",
            performed_by_name="Billing Engine",
            metadata={"document_type": document_type, "invoice_id": str(invoice.id), "amount": float(financials.grand_total)}
        )
    )
    await lead.save()

    return invoice

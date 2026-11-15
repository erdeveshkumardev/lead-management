import os
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from app.models.invoice import Invoice


def generate_invoice_pdf(invoice: Invoice, output_dir: str = "invoices_pdf") -> str:
    """
    Generates a clean, professional GST compliant PDF document for Quotation or Tax Invoice.
    Returns the absolute path to the generated PDF.
    """
    os.makedirs(output_dir, exist_ok=True)
    clean_number = invoice.invoice_number.replace("/", "_")
    filename = f"{clean_number}.pdf"
    filepath = os.path.join(output_dir, filename)

    doc = SimpleDocTemplate(
        filepath,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    story = []
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#1e3a8a"),
        alignment=1 # Center
    )

    header_style = ParagraphStyle(
        'PartyHeader',
        parent=styles['Normal'],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#334155")
    )

    doc_label = "TAX INVOICE" if invoice.document_type == "TAX_INVOICE" else "COMMERCIAL QUOTATION"
    story.append(Paragraph(f"<b>{doc_label}</b>", title_style))
    story.append(Spacer(1, 10))

    # Seller & Customer Info Table
    seller = invoice.seller
    cust = invoice.customer

    seller_info = f"""
    <b>{seller.company_name}</b><br/>
    {seller.address or ''}<br/>
    {seller.city or ''}, {seller.state or ''} - Code: {seller.state_code or ''}<br/>
    <b>GSTIN:</b> {seller.gstin or 'N/A'}<br/>
    <b>Phone:</b> {seller.phone or 'N/A'}<br/>
    <b>Email:</b> {seller.email or 'N/A'}
    """

    inv_meta = f"""
    <b>Invoice No:</b> {invoice.invoice_number}<br/>
    <b>Invoice Date:</b> {invoice.invoice_date.strftime('%d-%b-%Y')}<br/>
    <b>Due Date:</b> {invoice.due_date.strftime('%d-%b-%Y') if invoice.due_date else 'Immediate'}<br/>
    <b>Payment Status:</b> {invoice.payment_status}<br/>
    <hr/>
    <b>Billed To:</b> {cust.company_name or cust.name}<br/>
    <b>GSTIN:</b> {cust.gstin or 'Unregistered'}<br/>
    <b>Phone:</b> {cust.phone or 'N/A'}<br/>
    <b>State:</b> {cust.state or 'N/A'}
    """

    parties_table = Table(
        [[Paragraph(seller_info, header_style), Paragraph(inv_meta, header_style)]],
        colWidths=[270, 270]
    )
    parties_table.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#cbd5e1")),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f8fafc")),
        ('PADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(parties_table)
    story.append(Spacer(1, 15))

    # Line Items Table
    table_data = [
        ["#", "Item Description", "HSN/SAC", "Qty", "Rate", "Taxable", "GST", "Total"]
    ]

    for idx, itm in enumerate(invoice.items, start=1):
        tax_desc = f"{itm.gst_rate}%"
        table_data.append([
            str(idx),
            itm.name,
            itm.hsn_sac_code or "-",
            f"{itm.quantity} {itm.unit}",
            f"{itm.unit_price:,.2f}",
            f"{itm.taxable_amount:,.2f}",
            tax_desc,
            f"{itm.total_amount:,.2f}"
        ])

    items_table = Table(table_data, colWidths=[25, 175, 55, 55, 60, 60, 45, 65])
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#1e3a8a")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 8),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('ALIGN', (1,1), (1,-1), 'LEFT'),
        ('ALIGN', (3,1), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('FONTSIZE', (0,1), (-1,-1), 8),
        ('PADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 15))

    # Totals Summary Table
    fin = invoice.financials
    totals_data = [
        ["Taxable Subtotal:", f"Rs {fin.taxable_subtotal:,.2f}"],
        ["Total CGST:", f"Rs {fin.total_cgst:,.2f}"],
        ["Total SGST:", f"Rs {fin.total_sgst:,.2f}"],
        ["Total IGST:", f"Rs {fin.total_igst:,.2f}"],
        ["Round Off:", f"Rs {fin.round_off:,.2f}"],
        ["Grand Total:", f"Rs {fin.grand_total:,.2f}"],
        ["Paid Amount:", f"Rs {fin.paid_amount:,.2f}"],
        ["Balance Due:", f"Rs {fin.balance_due:,.2f}"],
    ]

    totals_table = Table(totals_data, colWidths=[120, 100])
    totals_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
        ('FONTNAME', (0,-3), (-1,-1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0,-3), (-1,-1), colors.HexColor("#1e3a8a")),
        ('LINEBELOW', (0,-3), (-1,-3), 1, colors.HexColor("#1e3a8a")),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('PADDING', (0,0), (-1,-1), 3),
    ]))

    # Align totals to the right
    wrapper_table = Table([["", totals_table]], colWidths=[320, 220])
    wrapper_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP')]))
    story.append(wrapper_table)

    story.append(Spacer(1, 15))

    # Terms & Conditions
    if invoice.terms_and_conditions:
        terms_style = ParagraphStyle('Terms', parent=styles['Normal'], fontSize=7, leading=10, textColor=colors.HexColor("#64748b"))
        story.append(Paragraph(f"<b>Terms & Conditions:</b><br/>{invoice.terms_and_conditions.replace(chr(10), '<br/>')}", terms_style))

    doc.build(story)
    return filepath

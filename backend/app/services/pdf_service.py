import os
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from app.models.invoice import Invoice


def generate_invoice_pdf(invoice: Invoice, output_dir: str = "invoices_pdf") -> str:
    """
    Generates a world-class, modern, executive GST Tax Invoice / Commercial Quotation PDF.
    Features:
    - Sleek modern header with document type & payment status badges
    - Symmetrical dual-party cards (Seller / Customer) with GSTIN & State codes
    - Clean zebra-striped line items table with HSN/SAC, rates & GST breakdown
    - Financial summary cards with standout Grand Total & Payment Ledger
    - Authorized Signatory stamp box, Terms & Conditions, and verified computer-generated footer.
    """
    os.makedirs(output_dir, exist_ok=True)
    clean_number = invoice.invoice_number.replace("/", "_")
    filename = f"{clean_number}.pdf"
    filepath = os.path.join(output_dir, filename)

    # A4: 595.27 x 841.89 points. Margins: 28pt each side -> usable width = 539pt
    doc = SimpleDocTemplate(
        filepath,
        pagesize=A4,
        rightMargin=28,
        leftMargin=28,
        topMargin=26,
        bottomMargin=26
    )

    story = []
    styles = getSampleStyleSheet()

    # Custom Paragraph Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=18,
        leading=22,
        fontName='Helvetica-Bold',
        textColor=colors.HexColor("#0f172a"),
        alignment=0
    )

    company_title = ParagraphStyle(
        'CompanyTitle',
        parent=styles['Heading2'],
        fontSize=13,
        leading=16,
        fontName='Helvetica-Bold',
        textColor=colors.HexColor("#1e3a8a"),
    )

    card_header_style = ParagraphStyle(
        'CardHeader',
        parent=styles['Normal'],
        fontSize=8,
        leading=10,
        fontName='Helvetica-Bold',
        textColor=colors.HexColor("#64748b")
    )

    body_style = ParagraphStyle(
        'CardBody',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#334155")
    )

    meta_val_style = ParagraphStyle(
        'MetaVal',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0f172a"),
        alignment=2 # Right
    )

    # Document labels & Status styling
    is_invoice = invoice.document_type == "TAX_INVOICE"
    doc_label = "GST TAX INVOICE" if is_invoice else "COMMERCIAL QUOTATION"
    sub_label = "ORIGINAL FOR RECIPIENT" if is_invoice else "CONFIDENTIAL PRICE QUOTATION"

    status_color = "#059669" if invoice.payment_status == "PAID" else ("#d97706" if invoice.payment_status == "PARTIALLY_PAID" else "#dc2626")
    status_bg = "#ecfdf5" if invoice.payment_status == "PAID" else ("#fffbeb" if invoice.payment_status == "PARTIALLY_PAID" else "#fef2f2")

    seller = invoice.seller
    cust = invoice.customer

    # -------------------------------------------------------------------------
    # 1. TOP BRANDING & DOCUMENT INFO HEADER
    # -------------------------------------------------------------------------
    header_left = f"""
    <font size="16" color="#0f172a"><b>{seller.company_name or 'LeadCRM Enterprise'}</b></font><br/>
    <font size="8" color="#64748b">{seller.address or 'Commercial Business Park'}</font><br/>
    <font size="8" color="#64748b">{seller.city or ''}, {seller.state or ''} {f'- Code: {seller.state_code}' if seller.state_code else ''}</font><br/>
    <font size="8" color="#334155"><b>GSTIN:</b> {seller.gstin or 'N/A'}&nbsp;&nbsp;|&nbsp;&nbsp;<b>Phone:</b> {seller.phone or 'N/A'}&nbsp;&nbsp;|&nbsp;&nbsp;<b>Email:</b> {seller.email or 'N/A'}</font>
    """

    header_right = f"""
    <font size="15" color="#1e3a8a"><b>{doc_label}</b></font><br/>
    <font size="7" color="#64748b"><b>{sub_label}</b></font><br/>
    <font size="9" color="#0f172a"><b>Doc #: {invoice.invoice_number}</b></font><br/>
    <font size="8" color="#334155">Date: <b>{invoice.invoice_date.strftime('%d-%b-%Y')}</b>&nbsp;&nbsp;|&nbsp;&nbsp;Due: <b>{invoice.due_date.strftime('%d-%b-%Y') if invoice.due_date else 'Immediate'}</b></font><br/>
    <font size="8" color="{status_color}"><b>STATUS: {invoice.payment_status.replace('_', ' ')}</b></font>
    """

    header_table = Table(
        [[Paragraph(header_left, body_style), Paragraph(header_right, meta_val_style)]],
        colWidths=[320, 219]
    )
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LINEBELOW', (0,0), (-1,-1), 1.5, colors.HexColor("#1e3a8a")),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 10))

    # -------------------------------------------------------------------------
    # 2. PARTY INFORMATION CARDS (ISSUED BY / BILLED TO)
    # -------------------------------------------------------------------------
    issued_card = f"""
    <font size="8" color="#1e3a8a"><b>ISSUED BY (SUPPLIER)</b></font><br/>
    <b>{seller.company_name}</b><br/>
    {seller.address or 'Business Address'}<br/>
    {seller.city or ''}, {seller.state or ''} {f'- {seller.state_code}' if seller.state_code else ''}<br/>
    <b>GSTIN / UIN:</b> {seller.gstin or 'N/A'}<br/>
    <b>State / State Code:</b> {seller.state or 'N/A'} {f'({seller.state_code})' if seller.state_code else ''}
    """

    billed_card = f"""
    <font size="8" color="#1e3a8a"><b>BILLED TO (CUSTOMER)</b></font><br/>
    <b>{cust.company_name or cust.name}</b><br/>
    Contact Person: {cust.name}<br/>
    Phone: {cust.phone or 'N/A'}&nbsp;&nbsp;|&nbsp;&nbsp;Email: {cust.email or 'N/A'}<br/>
    <b>GSTIN:</b> {cust.gstin or 'Unregistered Consumer'}<br/>
    <b>Place of Supply:</b> {cust.state or seller.state or 'Local Supply'} {f'({cust.state_code})' if getattr(cust, 'state_code', None) else ''}
    """

    parties_table = Table(
        [[Paragraph(issued_card, body_style), Paragraph(billed_card, body_style)]],
        colWidths=[265, 265]
    )
    parties_table.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.75, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f8fafc")),
        ('PADDING', (0,0), (-1,-1), 7),
    ]))
    story.append(parties_table)
    story.append(Spacer(1, 12))

    # -------------------------------------------------------------------------
    # 3. LINE ITEMS TABLE (ZEBRA STRIPED & MODERN)
    # -------------------------------------------------------------------------
    table_data = [
        ["#", "Item Description", "HSN/SAC", "Qty", "Unit Price (Rs)", "Taxable (Rs)", "GST", "Total (Rs)"]
    ]

    for idx, itm in enumerate(invoice.items, start=1):
        tax_desc = f"{itm.gst_rate}%"
        table_data.append([
            str(idx),
            Paragraph(f"<b>{itm.name}</b>{f'<br/><font size=6 color=#64748b>{itm.description}</font>' if itm.description else ''}", body_style),
            itm.hsn_sac_code or "-",
            f"{itm.quantity} {itm.unit}",
            f"{itm.unit_price:,.2f}",
            f"{itm.taxable_amount:,.2f}",
            tax_desc,
            f"{itm.total_amount:,.2f}"
        ])

    items_table = Table(table_data, colWidths=[22, 185, 52, 48, 62, 60, 42, 68])
    item_styles = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#0f172a")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 7.5),
        ('ALIGN', (0,0), (-1,0), 'CENTER'),
        ('ALIGN', (1,0), (1,-1), 'LEFT'),
        ('ALIGN', (3,0), (-1,-1), 'RIGHT'),
        ('ALIGN', (6,0), (6,-1), 'CENTER'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('FONTSIZE', (0,1), (-1,-1), 7.5),
        ('PADDING', (0,0), (-1,-1), 4.5),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]

    # Zebra striping for item rows
    for r in range(1, len(table_data)):
        if r % 2 == 0:
            item_styles.append(('BACKGROUND', (0, r), (-1, r), colors.HexColor("#f8fafc")))

    items_table.setStyle(TableStyle(item_styles))
    story.append(items_table)
    story.append(Spacer(1, 10))

    # -------------------------------------------------------------------------
    # 4. FINANCIAL SUMMARY & TOTALS (ELEGANT RIGHT CARD)
    # -------------------------------------------------------------------------
    fin = invoice.financials
    totals_data = [
        ["Taxable Subtotal:", f"Rs {fin.taxable_subtotal:,.2f}"],
    ]
    if fin.total_cgst > 0:
        totals_data.append(["Central GST (CGST):", f"Rs {fin.total_cgst:,.2f}"])
    if fin.total_sgst > 0:
        totals_data.append(["State GST (SGST):", f"Rs {fin.total_sgst:,.2f}"])
    if fin.total_igst > 0:
        totals_data.append(["Integrated GST (IGST):", f"Rs {fin.total_igst:,.2f}"])
    if fin.round_off != 0:
        totals_data.append(["Round Off (+/-):", f"Rs {fin.round_off:,.2f}"])

    totals_data.append(["Grand Total (INR):", f"Rs {fin.grand_total:,.2f}"])
    totals_data.append(["Amount Paid:", f"Rs {fin.paid_amount:,.2f}"])
    totals_data.append(["Balance Due:", f"Rs {fin.balance_due:,.2f}"])

    totals_table = Table(totals_data, colWidths=[120, 105])
    totals_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
        ('FONTSIZE', (0,0), (-1,-1), 7.5),
        ('PADDING', (0,0), (-1,-1), 2.5),
        ('FONTNAME', (0,-3), (-1,-3), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0,-3), (-1,-3), colors.HexColor("#0f172a")),
        ('FONTSIZE', (0,-3), (-1,-3), 8.5),
        ('LINEABOVE', (0,-3), (-1,-3), 1, colors.HexColor("#0f172a")),
        ('LINEBELOW', (0,-3), (-1,-3), 1, colors.HexColor("#0f172a")),
        ('TEXTCOLOR', (0,-1), (-1,-1), colors.HexColor("#dc2626" if fin.balance_due > 0 else "#059669")),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
    ]))

    # Left box: Terms & Conditions + Notes
    terms_text = f"""
    <font size="8" color="#0f172a"><b>Terms & Conditions:</b></font><br/>
    <font size="7" color="#475569">
    {invoice.terms_and_conditions.replace(chr(10), '<br/>') if invoice.terms_and_conditions else '1. Payment is due as per agreed credit terms.<br/>2. Goods once sold will not be returned without prior authorization.<br/>3. Subject to local jurisdiction only.'}
    </font>
    {f'<br/><br/><font size="8" color="#0f172a"><b>Special Notes:</b></font><br/><font size="7" color="#475569">{invoice.notes}</font>' if invoice.notes else ''}
    """

    bottom_summary_table = Table(
        [[Paragraph(terms_text, body_style), totals_table]],
        colWidths=[305, 230]
    )
    bottom_summary_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f8fafc")),
        ('PADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(bottom_summary_table)
    story.append(Spacer(1, 14))

    # -------------------------------------------------------------------------
    # 5. SIGNATORY & FOOTER SECTION
    # -------------------------------------------------------------------------
    sign_text = f"""
    <font size="8" color="#64748b">For </font><font size="8" color="#0f172a"><b>{seller.company_name}</b></font><br/><br/><br/>
    <font size="7.5" color="#334155"><b>Authorized Signatory</b></font><br/>
    <font size="6.5" color="#94a3b8">Digitally signed & verified</font>
    """

    left_note = """
    <font size="7" color="#64748b">
    <b>Payment Modes Accepted:</b> UPI (GPay/PhonePe), NEFT/RTGS, Bank Transfer & Cheque.<br/>
    <i>* This is a computer-generated document issued securely via LeadCRM. No physical signature required.</i>
    </font>
    """

    sign_table = Table(
        [[Paragraph(left_note, body_style), Paragraph(sign_text, meta_val_style)]],
        colWidths=[330, 205]
    )
    sign_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'BOTTOM'),
        ('LINEBELOW', (1,0), (1,0), 0.5, colors.HexColor("#cbd5e1")),
        ('PADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(sign_table)

    doc.build(story)
    return filepath

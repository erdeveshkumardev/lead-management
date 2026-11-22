"""
Executive GST Tax Invoice / Quotation PDF (A4), rendered in memory for the authenticated user.

Carries the particulars a GST tax invoice needs: supplier and recipient name, address and GSTIN, a unique
serial number and date, place of supply with state code, HSN/SAC, quantity and unit, taxable value, rate and
amount of tax per head (CGST + SGST, or IGST), totals, amount in words, reverse-charge indicator and signatory.

Every user supplied value is escaped before it reaches the PDF markup, and nothing is written to disk
(a shared output folder would let two companies with the same document number overwrite each other's file).
"""
import io
from html import escape
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.gst import format_inr
from app.models.invoice import Invoice
from app.models.tenant import Tenant

INK = colors.HexColor("#0f172a")
NAVY = colors.HexColor("#1e3a8a")
LINE = colors.HexColor("#cbd5e1")
SOFT = colors.HexColor("#f8fafc")

DOC_LABELS = {
    "TAX_INVOICE": ("GST TAX INVOICE", "ORIGINAL FOR RECIPIENT"),
    "QUOTATION": ("COMMERCIAL QUOTATION", "CONFIDENTIAL PRICE QUOTATION"),
    "PROFORMA": ("PROFORMA INVOICE", "NOT A TAX INVOICE"),
}
STATUS_COLORS = {"PAID": "#059669", "PARTIALLY_PAID": "#d97706", "CANCELLED": "#64748b"}


def _e(value) -> str:
    """Escapes a value for ReportLab paragraph markup."""
    return escape(str(value), quote=False) if value not in (None, "") else ""


def _money(value) -> str:
    return format_inr(value or 0)


def _qty(value) -> str:
    return f"{float(value or 0):g}"


def _join(*parts: Optional[str], sep: str = ", ") -> str:
    return sep.join(p for p in (_e(x) for x in parts) if p)


def generate_invoice_pdf_bytes(invoice: Invoice, tenant: Optional[Tenant] = None) -> bytes:
    buffer = io.BytesIO()
    is_invoice = invoice.document_type == "TAX_INVOICE"
    doc_label, sub_label = DOC_LABELS.get(invoice.document_type, ("DOCUMENT", ""))
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=28, leftMargin=28, topMargin=26, bottomMargin=26,
        title=f"{doc_label} {invoice.invoice_number}", author=invoice.seller.company_name or "",
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=8, leading=11, textColor=colors.HexColor("#334155"))
    right = ParagraphStyle("Right", parent=body, alignment=2, textColor=INK)
    cell = ParagraphStyle("Cell", parent=body, fontSize=7.5, leading=9.5)
    head = ParagraphStyle("Head", parent=cell, textColor=colors.white, fontName="Helvetica-Bold", alignment=1)
    story: List = []

    seller, cust, fin = invoice.seller, invoice.customer, invoice.financials
    cancelled = invoice.payment_status == "CANCELLED"

    # ---------------------------------------------------------------- 1. branding + document header
    header_left = (
        f'<font size="16" color="#0f172a"><b>{_e(seller.company_name or seller.name)}</b></font><br/>'
        f'<font size="8" color="#64748b">{_e(seller.address)}</font><br/>'
        f'<font size="8" color="#64748b">{_join(seller.city, seller.state)}'
        f'{" - Code: " + _e(seller.state_code) if seller.state_code else ""}</font><br/>'
        f'<font size="8" color="#334155"><b>GSTIN:</b> {_e(seller.gstin) or "N/A"}'
        f'&nbsp;&nbsp;|&nbsp;&nbsp;<b>Phone:</b> {_e(seller.phone) or "-"}'
        f'&nbsp;&nbsp;|&nbsp;&nbsp;<b>Email:</b> {_e(seller.email) or "-"}</font>'
    )
    due = invoice.due_date.strftime("%d-%b-%Y") if invoice.due_date else "-"
    if cancelled:
        status_line = '<font size="8" color="#64748b"><b>STATUS: CANCELLED</b></font>'
    elif is_invoice:
        status = invoice.payment_status or "UNPAID"
        status_line = (f'<font size="8" color="{STATUS_COLORS.get(status, "#dc2626")}">'
                       f'<b>STATUS: {_e(status.replace("_", " "))}</b></font>')
    else:
        status_line = f'<font size="8" color="#334155">Valid till: <b>{due}</b></font>'
    header_right = (
        f'<font size="15" color="#1e3a8a"><b>{doc_label}</b></font><br/>'
        f'<font size="7" color="#64748b"><b>{sub_label}</b></font><br/>'
        f'<font size="9" color="#0f172a"><b>Doc #: {_e(invoice.invoice_number)}</b></font><br/>'
        f'<font size="8" color="#334155">Date: <b>{invoice.invoice_date.strftime("%d-%b-%Y")}</b>'
        + (f'&nbsp;&nbsp;|&nbsp;&nbsp;Due: <b>{due}</b>' if is_invoice else "")
        + f'</font><br/>{status_line}'
    )
    header = Table([[Paragraph(header_left, body), Paragraph(header_right, right)]], colWidths=[320, 219])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -1), 1.5, NAVY),
    ]))
    story += [header, Spacer(1, 10)]
    if cancelled and invoice.cancellation_reason:
        story += [Paragraph(f'<font color="#dc2626"><b>CANCELLED:</b></font> {_e(invoice.cancellation_reason)}', body),
                  Spacer(1, 6)]

    # ---------------------------------------------------------------- 2. party cards
    pos_name = invoice.place_of_supply_name or cust.state or seller.state
    pos_code = invoice.place_of_supply_code or cust.state_code
    issued = (
        '<font size="8" color="#1e3a8a"><b>ISSUED BY (SUPPLIER)</b></font><br/>'
        f'<b>{_e(seller.company_name or seller.name)}</b><br/>{_e(seller.address)}<br/>'
        f'{_join(seller.city, seller.state)}<br/>'
        f'<b>GSTIN / UIN:</b> {_e(seller.gstin) or "N/A"}'
        f'&nbsp;&nbsp;<b>PAN:</b> {_e(seller.pan) or (_e(seller.gstin)[2:12] if seller.gstin else "-")}<br/>'
        f'<b>State / State Code:</b> {_e(seller.state) or "-"}{" (" + _e(seller.state_code) + ")" if seller.state_code else ""}'
    )
    billed = (
        '<font size="8" color="#1e3a8a"><b>BILLED TO (CUSTOMER)</b></font><br/>'
        f'<b>{_e(cust.company_name or cust.name)}</b><br/>'
        f'Contact Person: {_e(cust.name)}<br/>'
        + (f'{_join(cust.address, cust.city)}<br/>' if (cust.address or cust.city) else "")
        + f'Phone: {_e(cust.phone) or "-"}&nbsp;&nbsp;|&nbsp;&nbsp;Email: {_e(cust.email) or "-"}<br/>'
        f'<b>GSTIN:</b> {_e(cust.gstin) or "Unregistered"}<br/>'
        f'<b>Place of Supply:</b> {_e(pos_name) or "-"}{" (" + _e(pos_code) + ")" if pos_code else ""}'
        f'&nbsp;&nbsp;<b>Reverse Charge:</b> {"Yes" if invoice.reverse_charge else "No"}'
    )
    parties = Table([[Paragraph(issued, body), Paragraph(billed, body)]], colWidths=[269.5, 269.5])
    parties.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), SOFT), ("PADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [parties, Spacer(1, 12)]

    # ---------------------------------------------------------------- 3. line items (tax shown per head)
    interstate = invoice.is_interstate or (fin.total_igst > 0 and fin.total_cgst == 0)
    if interstate:
        columns = ["#", "Item Description", "HSN/SAC", "Qty", "Rate (Rs)", "Disc.", "Taxable (Rs)", "IGST %", "IGST (Rs)", "Total (Rs)"]
        widths = [20, 150, 46, 46, 54, 36, 60, 30, 46, 51]
    else:
        columns = ["#", "Item Description", "HSN/SAC", "Qty", "Rate (Rs)", "Disc.", "Taxable (Rs)", "CGST %", "CGST (Rs)", "SGST %", "SGST (Rs)", "Total (Rs)"]
        widths = [20, 116, 42, 42, 50, 32, 54, 24, 40, 24, 40, 55]
    rows = [[Paragraph(_e(c), head) for c in columns]]
    for idx, item in enumerate(invoice.items, start=1):
        description = f"<b>{_e(item.name)}</b>"
        if item.description:
            description += f'<br/><font size="6.5" color="#64748b">{_e(item.description)}</font>'
        row = [str(idx), Paragraph(description, cell), _e(item.hsn_sac_code) or "-", f"{_qty(item.quantity)} {_e(item.unit)}",
               _money(item.unit_price), _money(item.discount_amount), _money(item.taxable_amount)]
        if interstate:
            row += [_qty(item.igst_rate or item.gst_rate), _money(item.igst_amount)]
        else:
            row += [_qty(item.cgst_rate), _money(item.cgst_amount), _qty(item.sgst_rate), _money(item.sgst_amount)]
        row.append(_money(item.total_amount))
        rows.append(row)
    items = Table(rows, colWidths=widths, repeatRows=1)
    item_style = [
        ("BACKGROUND", (0, 0), (-1, 0), INK), ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("FONTSIZE", (0, 1), (-1, -1), 7.5), ("PADDING", (0, 0), (-1, -1), 4), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"), ("ALIGN", (2, 1), (2, -1), "CENTER"), ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
    ]
    item_style += [("BACKGROUND", (0, r), (-1, r), SOFT) for r in range(2, len(rows), 2)]
    items.setStyle(TableStyle(item_style))
    story += [items, Spacer(1, 10)]

    # ---------------------------------------------------------------- 4. terms + totals
    totals = [["Taxable Subtotal:", f"Rs {_money(fin.taxable_subtotal)}"]]
    if fin.total_discount:
        totals.insert(0, ["Discount Given:", f"Rs {_money(fin.total_discount)}"])
    if interstate:
        totals.append(["Integrated GST (IGST):", f"Rs {_money(fin.total_igst)}"])
    else:
        totals += [["Central GST (CGST):", f"Rs {_money(fin.total_cgst)}"], ["State GST (SGST):", f"Rs {_money(fin.total_sgst)}"]]
    if fin.round_off:
        totals.append(["Round Off (+/-):", f"Rs {_money(fin.round_off)}"])
    grand_row = len(totals)
    totals.append(["Grand Total (INR):", f"Rs {_money(fin.grand_total)}"])
    totals_style = [
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 7.5), ("PADDING", (0, 0), (-1, -1), 2.5),
        ("FONTNAME", (0, grand_row), (-1, grand_row), "Helvetica-Bold"), ("FONTSIZE", (0, grand_row), (-1, grand_row), 8.5),
        ("TEXTCOLOR", (0, grand_row), (-1, grand_row), INK),
        ("LINEABOVE", (0, grand_row), (-1, grand_row), 1, INK), ("LINEBELOW", (0, grand_row), (-1, grand_row), 1, INK),
    ]
    if is_invoice:
        totals += [["Amount Paid:", f"Rs {_money(fin.paid_amount)}"], ["Balance Due:", f"Rs {_money(fin.balance_due)}"]]
        totals_style += [
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor("#dc2626" if fin.balance_due > 0 else "#059669")),
        ]
    totals_table = Table(totals, colWidths=[120, 100])
    totals_table.setStyle(TableStyle(totals_style))

    left = f'<font size="8" color="#0f172a"><b>Amount in words:</b></font><br/><font size="7.5">{_e(invoice.amount_in_words)}</font>'
    if invoice.terms_and_conditions:
        left += ('<br/><br/><font size="8" color="#0f172a"><b>Terms &amp; Conditions:</b></font><br/>'
                 f'<font size="7" color="#475569">{_e(invoice.terms_and_conditions).replace(chr(10), "<br/>")}</font>')
    if invoice.notes:
        left += ('<br/><br/><font size="8" color="#0f172a"><b>Special Notes:</b></font><br/>'
                 f'<font size="7" color="#475569">{_e(invoice.notes).replace(chr(10), "<br/>")}</font>')
    summary = Table([[Paragraph(left, body), totals_table]], colWidths=[309, 230])
    summary.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), SOFT), ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [summary, Spacer(1, 12)]

    # ---------------------------------------------------------------- 5. bank details + signatory
    bank = getattr(tenant, "bank_details", None) if tenant else None
    bank_html = ""
    if bank and (bank.account_number or bank.upi_id):
        bank_html = ('<font size="8" color="#0f172a"><b>Bank Details for Payment</b></font><br/>'
                     f'<font size="7.5">Bank: <b>{_e(bank.bank_name) or "-"}</b>'
                     f'{"&nbsp;&nbsp;Branch: " + _e(bank.branch_name) if bank.branch_name else ""}<br/>'
                     f'A/c No: <b>{_e(bank.account_number) or "-"}</b>&nbsp;&nbsp;IFSC: <b>{_e(bank.ifsc_code) or "-"}</b>'
                     f'{"<br/>UPI: <b>" + _e(bank.upi_id) + "</b>" if bank.upi_id else ""}</font><br/><br/>')
    note = (f'{bank_html}<font size="7" color="#64748b"><i>This is a computer generated document.</i></font>')
    signature = (f'<font size="8" color="#64748b">For </font><font size="8" color="#0f172a">'
                 f'<b>{_e(seller.company_name or seller.name)}</b></font><br/><br/><br/><br/>'
                 '<font size="7.5" color="#334155"><b>Authorised Signatory</b></font>')
    footer = Table([[Paragraph(note, body), Paragraph(signature, right)]], colWidths=[334, 205])
    footer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LINEBELOW", (1, 0), (1, 0), 0.5, LINE), ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(footer)

    doc.build(story)
    return buffer.getvalue()

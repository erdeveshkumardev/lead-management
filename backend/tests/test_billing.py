"""GST billing: place of supply, tax split, numbering, payments ledger, cancellation and PDF rendering."""
import asyncio
from datetime import date, timedelta

import pytest

from app.core.gst import amount_in_words, format_inr, gstin_error, resolve_state_code
from app.models.invoice import Invoice
from app.models.lead import Lead
from app.models.tenant import Tenant
from tests.conftest import ITEM, create_lead, reset_rate_limits, valid_gstin

MH_GSTIN = valid_gstin("27", "AAPFU0939F")


async def bill(session, lead_id, document_type="TAX_INVOICE", items=None, expect=201, **extra):
    resp = await session.post(f"/api/v1/invoices/from-lead/{lead_id}",
                              json={"document_type": document_type, "items": [ITEM] if items is None else items, **extra})
    assert resp.status_code == expect, resp.text
    return resp.json()


def test_gstin_checksum_state_resolution_and_amount_in_words():
    assert gstin_error("27AAPFU0939F1ZV") is None  # well-known valid sample
    assert gstin_error("27AAPFU0939F1ZX") is not None  # wrong check digit
    assert gstin_error("24ABCDE1234F1Z5") is not None  # the old demo value was never valid
    assert gstin_error("99") is not None and gstin_error("") is not None
    assert resolve_state_code("Gujarat") == "24" and resolve_state_code("  maharashtra ") == "27"
    assert resolve_state_code("New Delhi") == "07" and resolve_state_code("7") == "07"
    assert resolve_state_code("27AAPFU0939F1ZV") == "27" and resolve_state_code("Atlantis") is None
    assert amount_in_words(118000) == "Rupees One Lakh Eighteen Thousand Only"
    assert amount_in_words("1050.50") == "Rupees One Thousand Fifty and Fifty Paise Only"
    assert amount_in_words(25000000) == "Rupees Two Crore Fifty Lakh Only"
    # Indian digit grouping on printed documents
    assert [format_inr(v) for v in (0, 999, 1000, 100000, "12345678.9", -2500000, 99999.995)] == [
        "0.00", "999.00", "1,000.00", "1,00,000.00", "1,23,45,678.90", "-25,00,000.00", "1,00,000.00"]


async def test_documents_can_be_listed_for_one_lead(world):
    first = await create_lead(world.admin_a, state="Gujarat")
    second = await create_lead(world.admin_a, state="Gujarat", phone="9811100022", full_name="Second Buyer")
    await bill(world.admin_a, first["_id"], document_type="QUOTATION")
    await bill(world.admin_a, first["_id"])
    await bill(world.admin_a, second["_id"])
    listed = (await world.admin_a.get("/api/v1/invoices/", params={"lead_id": first["_id"]})).json()
    assert listed["total"] == 2 and {i["lead_id"] for i in listed["items"]} == {first["_id"]}
    # the filter is an exact id: it cannot be used to smuggle a query operator in
    assert (await world.admin_a.get("/api/v1/invoices/", params={"lead_id": '{"$ne": null}'})).status_code == 422
    # another company asking for this lead's documents gets nothing
    assert (await world.admin_b.get("/api/v1/invoices/", params={"lead_id": first["_id"]})).json()["total"] == 0


async def test_intra_state_supply_uses_cgst_and_sgst(world):
    lead = await create_lead(world.admin_a, state="Gujarat")  # seller is in Gujarat (24)
    inv = (await bill(world.admin_a, lead["_id"]))["invoice"]
    f = inv["financials"]
    assert inv["is_interstate"] is False and inv["place_of_supply_code"] == "24" and inv["place_of_supply_name"] == "Gujarat"
    assert (f["taxable_subtotal"], f["total_cgst"], f["total_sgst"], f["total_igst"], f["grand_total"]) == (100000.0, 9000.0, 9000.0, 0.0, 118000.0)
    assert inv["items"][0]["cgst_rate"] == 9.0 and inv["items"][0]["sgst_amount"] == 9000.0
    assert inv["amount_in_words"] == "Rupees One Lakh Eighteen Thousand Only"
    assert inv["invoice_number"].startswith("INV/") and inv["payment_status"] == "UNPAID"
    assert inv["created_by_name"] == "Asha Admin"


async def test_inter_state_supply_uses_igst_whether_state_comes_from_name_gstin_or_selection(world):
    admin = world.admin_a
    by_name = await create_lead(admin, phone="9825000011", state="Maharashtra")
    by_gstin = await create_lead(admin, phone="9825000012", state=None, gstin=MH_GSTIN)
    by_choice = await create_lead(admin, phone="9825000013", state=None)
    for lead, extra in ((by_name, {}), (by_gstin, {}), (by_choice, {"place_of_supply_code": "27"})):
        inv = (await bill(admin, lead["_id"], **extra))["invoice"]
        f = inv["financials"]
        assert inv["is_interstate"] is True and inv["place_of_supply_code"] == "27", lead["phone"]
        assert (f["total_igst"], f["total_cgst"], f["total_sgst"], f["grand_total"]) == (18000.0, 0.0, 0.0, 118000.0)
    # the customer's GSTIN wins over a conflicting free-text state
    conflict = await create_lead(admin, phone="9825000014", state="Gujarat", gstin=MH_GSTIN)
    assert (await bill(admin, conflict["_id"]))["invoice"]["place_of_supply_code"] == "27"


async def test_tax_invoice_needs_place_of_supply_valid_seller_gstin_and_hsn(world):
    admin = world.admin_a
    lead = await create_lead(admin, state=None)
    no_state = await bill(admin, lead["_id"], expect=400)
    assert "Place of supply" in no_state["detail"]
    # captured in the billing dialog and saved back to the lead
    ok = await bill(admin, lead["_id"], customer={"gstin": MH_GSTIN, "address": "12 MG Road", "city": "Pune"})
    assert ok["invoice"]["customer"]["gstin"] == MH_GSTIN and ok["invoice"]["customer"]["address"] == "12 MG Road"
    saved = await Lead.get(lead["_id"])
    assert saved.gstin == MH_GSTIN and saved.state_code == "27" and saved.city == "Pune"
    bad_gstin = await bill(admin, (await create_lead(admin, phone="9825000021"))["_id"], customer={"gstin": "27AAPFU0939F1ZX"}, expect=400)
    assert "checksum" in bad_gstin["detail"].lower()

    lead2 = await create_lead(admin, phone="9825000022")
    no_hsn = await bill(admin, lead2["_id"], items=[{**ITEM, "hsn_sac_code": None}], expect=400)
    assert "HSN" in no_hsn["detail"]
    assert (await bill(admin, lead2["_id"], items=[{**ITEM, "gst_rate": 17}], expect=400))["detail"].startswith("GST rate")
    await bill(admin, lead2["_id"], items=[{**ITEM, "quantity": 0}], expect=422)
    await bill(admin, lead2["_id"], items=[{**ITEM, "discount_percentage": 150}], expect=422)
    await bill(admin, lead2["_id"], items=[], expect=422)
    await bill(admin, lead2["_id"], due_date=str(date.today() - timedelta(days=3)), expect=400)

    # a company without a valid GSTIN can quote, but cannot issue tax invoices
    tenant = await Tenant.get(world.tenant_a.id)
    tenant.gstin = "24ABCDE1234F1Z5"
    await tenant.save()
    refused = await bill(admin, lead2["_id"], expect=400)
    assert "GSTIN" in refused["detail"]
    quote = await bill(admin, lead2["_id"], document_type="QUOTATION", items=[{**ITEM, "hsn_sac_code": None}])
    assert quote["invoice"]["payment_status"] == "NOT_APPLICABLE" and quote["invoice_number"].startswith("QUOT/")


async def test_money_is_computed_exactly_and_rounded_to_the_rupee(world):
    lead = await create_lead(world.admin_a)
    items = [
        {"name": "Bearing", "hsn_sac_code": "8482", "quantity": 3, "unit_price": 333.33, "gst_rate": 18},
        {"name": "Oil", "hsn_sac_code": "2710", "quantity": 1.5, "unit_price": 199.99, "discount_percentage": 12.5, "gst_rate": 28},
        {"name": "Manual", "hsn_sac_code": "4901", "quantity": 1, "unit_price": 0.1, "gst_rate": 0},
        {"name": "Gold wire", "hsn_sac_code": "7108", "quantity": 1, "unit_price": 10.01, "gst_rate": 3},
    ]
    inv = (await bill(world.admin_a, lead["_id"], items=items))["invoice"]
    f = inv["financials"]
    # bearing 999.99 (+90.00 +90.00) | oil 299.99 - 37.50 = 262.49 (+36.75 +36.75) | manual 0.10 | gold 10.01 (+0.15 +0.15)
    assert [i["taxable_amount"] for i in inv["items"]] == [999.99, 262.49, 0.1, 10.01]
    assert (f["taxable_subtotal"], f["total_discount"], f["total_cgst"], f["total_sgst"]) == (1272.59, 37.5, 126.9, 126.9)
    assert f["grand_total"] == 1526.0 and f["round_off"] == -0.39 and f["balance_due"] == 1526.0
    assert f["grand_total"] == round(f["taxable_subtotal"] + f["total_tax"] + f["round_off"], 2)
    assert inv["amount_in_words"] == "Rupees One Thousand Five Hundred Twenty Six Only"


async def test_document_numbers_are_sequential_unique_and_separate_per_company_and_type(world):
    a, b = world.admin_a, world.admin_b
    leads = [await create_lead(a, phone=f"98250001{i:02d}") for i in range(6)]
    results = await asyncio.gather(*[bill(a, l["_id"]) for l in leads])  # issued concurrently
    numbers = sorted(r["invoice_number"] for r in results)
    assert len(set(numbers)) == 6 and [n.rsplit("/", 1)[1] for n in numbers] == [f"{i:05d}" for i in range(1, 7)]
    quote = await bill(a, leads[0]["_id"], document_type="QUOTATION")
    proforma = await bill(a, leads[0]["_id"], document_type="PROFORMA")
    assert quote["invoice_number"].endswith("/00001") and quote["invoice_number"].startswith("QUOT/")
    assert proforma["invoice_number"].startswith("PI/") and proforma["invoice_number"].endswith("/00001")
    other = await bill(b, (await create_lead(b, state="Maharashtra"))["_id"])
    assert other["invoice_number"].endswith("/00001"), "each company has its own series"
    # a rejected request never burns a number (the GST series stays gap-free)
    await bill(a, (await create_lead(a, phone="9825000199", state=None))["_id"], expect=400)
    nxt = await bill(a, (await create_lead(a, phone="9825000198"))["_id"])
    assert nxt["invoice_number"].endswith("/00007")


async def test_double_submission_and_second_invoice_protection(world):
    admin = world.admin_a
    lead = await create_lead(admin)
    key = {"Idempotency-Key": "c0ffee-1234"}
    first = await admin.post(f"/api/v1/invoices/from-lead/{lead['_id']}", json={"document_type": "TAX_INVOICE", "items": [ITEM]}, headers=key)
    replay = await admin.post(f"/api/v1/invoices/from-lead/{lead['_id']}", json={"document_type": "TAX_INVOICE", "items": [ITEM]}, headers=key)
    assert first.status_code == replay.status_code == 201 and first.json()["invoice_id"] == replay.json()["invoice_id"]
    assert await Invoice.find({}).count() == 1
    again = await bill(admin, lead["_id"], expect=409)
    assert again["detail"]["code"] == "INVOICE_EXISTS"
    confirmed = await bill(admin, lead["_id"], allow_additional_invoice=True)
    assert confirmed["invoice_number"] != first.json()["invoice_number"]
    saved = await Lead.get(lead["_id"])
    assert saved.stage == "WON" and saved.conversion_info.is_converted and saved.timeline[-1].performed_by_name == "Asha Admin"


async def test_payment_ledger_rules(world):
    admin = world.admin_a
    lead = await create_lead(admin)
    inv = (await bill(admin, lead["_id"]))["invoice"]  # 118000
    url = f"/api/v1/invoices/{inv['_id']}/payments"

    async def pay(expect=200, **payload):
        resp = await admin.post(url, json=payload)
        assert resp.status_code == expect, resp.text
        return resp.json()

    assert "exceeds" in (await pay(400, amount=118000.01, payment_mode="NEFT", reference_number="UTR1"))["detail"]
    await pay(422, amount=0, payment_mode="UPI", reference_number="x")
    await pay(422, amount=-5, payment_mode="UPI", reference_number="x")
    assert "mode" in (await pay(400, amount=10, payment_mode="BITCOIN"))["detail"].lower()
    assert "reference" in (await pay(400, amount=10, payment_mode="NEFT"))["detail"].lower()
    assert (await pay(400, amount=10, payment_mode="UPI", reference_number="R1", paid_on=str(date.today() + timedelta(days=2))))["detail"]

    part = await pay(amount=18000, payment_mode="UPI", reference_number="UPI-778899")
    assert part["payment_status"] == "PARTIALLY_PAID" and part["balance_due"] == 100000.0
    assert part["invoice"]["payments"][0]["recorded_by_name"] == "Asha Admin"
    rest = await pay(amount=100000, payment_mode="RTGS", reference_number="UTR-555")
    assert rest["payment_status"] == "PAID" and rest["balance_due"] == 0.0
    assert "exceeds" in (await pay(400, amount=1, payment_mode="CASH"))["detail"]

    # paid invoices cannot be cancelled until the money is reversed; reversal needs a reason and is recorded
    assert (await admin.post(f"/api/v1/invoices/{inv['_id']}/cancel", json={"reason": "wrong party"})).status_code == 400
    payments = rest["invoice"]["payments"]
    assert len({p["payment_id"] for p in payments}) == 2
    for p in payments:
        assert (await admin.post(f"{url}/{p['payment_id']}/reverse", json={"reason": ""})).status_code == 422
        rev = await admin.post(f"{url}/{p['payment_id']}/reverse", json={"reason": "cheque bounced"})
        assert rev.status_code == 200
        assert (await admin.post(f"{url}/{p['payment_id']}/reverse", json={"reason": "again"})).status_code == 400
    after = rev.json()["invoice"]
    assert after["payment_status"] == "UNPAID" and after["financials"]["balance_due"] == 118000.0
    assert all(p["is_reversed"] for p in after["payments"]), "reversed entries stay on the ledger"

    cancelled = await admin.post(f"/api/v1/invoices/{inv['_id']}/cancel", json={"reason": "wrong party"})
    assert cancelled.status_code == 200 and cancelled.json()["invoice"]["payment_status"] == "CANCELLED"
    assert (await pay(400, amount=10, payment_mode="CASH"))["detail"]
    assert (await admin.post(f"/api/v1/invoices/{inv['_id']}/mark-as-paid")).status_code == 400
    saved = await Lead.get(lead["_id"])
    assert saved.conversion_info.is_converted is False and saved.timeline[-1].activity_type == "BILL_CANCELLED"
    # a cancelled invoice no longer blocks a fresh one, and never counts as revenue
    await bill(admin, lead["_id"])
    dash = (await admin.get("/api/v1/analytics/dashboard")).json()["financial_metrics"]
    assert dash["total_invoices_count"] == 1 and dash["total_billed_amount"] == 118000.0


async def test_payments_sharing_an_id_as_in_old_data_can_each_be_reversed(world):
    """The earlier version built payment ids from the clock: two payments in one second got the same id."""
    admin = world.admin_a
    lead = await create_lead(admin)
    inv = (await bill(admin, lead["_id"]))["invoice"]  # 118000
    url = f"/api/v1/invoices/{inv['_id']}/payments"
    for amount, ref in ((18000, "UPI-1"), (40000, "UPI-2")):
        assert (await admin.post(url, json={"amount": amount, "payment_mode": "UPI", "reference_number": ref})).status_code == 200
    stored = await Invoice.get(inv["_id"])
    stored.payments[0].payment_id = stored.payments[1].payment_id = "PAY_1794999263"
    await stored.save()

    first = await admin.post(f"{url}/PAY_1794999263/reverse", json={"reason": "cheque returned"})
    assert first.status_code == 200 and first.json()["invoice"]["financials"]["paid_amount"] == 40000.0
    second = await admin.post(f"{url}/PAY_1794999263/reverse", json={"reason": "cheque returned"})
    assert second.status_code == 200, second.text
    after = second.json()["invoice"]
    assert after["financials"]["paid_amount"] == 0.0 and after["payment_status"] == "UNPAID"
    assert [p["is_reversed"] for p in after["payments"]] == [True, True]
    third = await admin.post(f"{url}/PAY_1794999263/reverse", json={"reason": "again"})
    assert third.status_code == 400 and "already reversed" in third.json()["detail"]
    assert (await admin.post(f"{url}/PAY_0000000000/reverse", json={"reason": "no such payment"})).status_code == 404


async def test_large_cash_receipts_are_refused(world):
    lead = await create_lead(world.admin_a)
    big = {**ITEM, "unit_price": 150000}  # 2 x 150000 + 18% = 354000
    inv = (await bill(world.admin_a, lead["_id"], items=[big]))["invoice"]
    resp = await world.admin_a.post(f"/api/v1/invoices/{inv['_id']}/payments", json={"amount": 200000, "payment_mode": "CASH"})
    assert resp.status_code == 400 and "269ST" in resp.json()["detail"]
    ok = await world.admin_a.post(f"/api/v1/invoices/{inv['_id']}/payments", json={"amount": 199999, "payment_mode": "CASH"})
    assert ok.status_code == 200


async def test_quotations_take_no_payments_and_convert_to_one_invoice(world):
    admin = world.admin_a
    lead = await create_lead(admin, state="Maharashtra")
    quote = (await bill(admin, lead["_id"], document_type="QUOTATION"))["invoice"]
    assert (await Lead.get(lead["_id"])).stage == "PROPOSAL_SENT"
    assert (await admin.post(f"/api/v1/invoices/{quote['_id']}/payments", json={"amount": 10, "payment_mode": "CASH"})).status_code == 400
    assert (await admin.post(f"/api/v1/invoices/{quote['_id']}/mark-as-paid")).status_code == 400

    converted = await admin.post(f"/api/v1/invoices/{quote['_id']}/convert-to-invoice", json={})
    assert converted.status_code == 201, converted.text
    invoice = converted.json()["invoice"]
    assert invoice["document_type"] == "TAX_INVOICE" and invoice["source_quotation_id"] == quote["_id"]
    assert invoice["financials"]["grand_total"] == quote["financials"]["grand_total"] and invoice["is_interstate"] is True
    assert (await admin.post(f"/api/v1/invoices/{quote['_id']}/convert-to-invoice", json={})).status_code == 409
    assert (await admin.post(f"/api/v1/invoices/{invoice['_id']}/convert-to-invoice", json={})).status_code == 400

    settled = await admin.post(f"/api/v1/invoices/{invoice['_id']}/mark-as-paid?payment_mode=UPI")
    assert settled.status_code == 200 and settled.json()["payment_status"] == "PAID" and settled.json()["balance_due"] == 0.0
    assert (await admin.post(f"/api/v1/invoices/{invoice['_id']}/mark-as-paid")).json()["message"].startswith("Invoice is already")
    assert len((await admin.get(f"/api/v1/invoices/{invoice['_id']}")).json()["payments"]) == 1


async def test_overdue_status_and_filters(world):
    admin = world.admin_a
    lead = await create_lead(admin)
    inv = (await bill(admin, lead["_id"]))["invoice"]
    stored = await Invoice.get(inv["_id"])
    stored.due_date = date.today() - timedelta(days=10)
    await stored.save()
    assert (await admin.get(f"/api/v1/invoices/{inv['_id']}")).json()["payment_status"] == "OVERDUE"
    assert (await admin.get("/api/v1/invoices/?payment_status=OVERDUE")).json()["total"] == 1
    assert (await admin.get("/api/v1/invoices/?document_type=QUOTATION")).json()["total"] == 0
    assert (await admin.get("/api/v1/invoices/?document_type=DROP")).status_code == 400
    assert (await admin.get("/api/v1/invoices/?search=(((")).status_code == 200  # regex metacharacters are harmless
    from app.services.scheduler import mark_overdue_invoices

    assert await mark_overdue_invoices() == 1
    assert (await Invoice.get(inv["_id"])).payment_status == "OVERDUE"


@pytest.mark.parametrize("name", ["Shah & Sons <Pvt> Ltd", "A <b>bold</b> \"quote\" 'n co", "नमस्ते ट्रेडर्स", "x" * 180])
async def test_pdf_renders_for_awkward_names_and_is_not_written_to_disk(world, name, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    admin = world.admin_a
    await admin.put(f"/api/v1/tenants/{world.tenant_a.id}/profile", json={"bank_details": {
        "bank_name": "HDFC & Co <Bank>", "account_number": "50200012345678", "ifsc_code": "HDFC0001234", "upi_id": "alpha@hdfcbank"}})
    lead = await create_lead(admin, full_name=name, company_name=name, state="Maharashtra")
    items = [{**ITEM, "name": f"Item {name}", "description": "5 < 6 & 7 > 2"}] * 3
    for doc_type in ("TAX_INVOICE", "QUOTATION"):
        inv = (await bill(admin, lead["_id"], document_type=doc_type, items=items, notes="Deliver <ASAP> & call",
                          allow_additional_invoice=True))["invoice"]
        await reset_rate_limits()
        pdf = await admin.get(f"/api/v1/invoices/{inv['_id']}/pdf")
        assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
        assert pdf.content.startswith(b"%PDF") and len(pdf.content) > 2500
        assert "attachment" in pdf.headers["content-disposition"] and ".pdf" in pdf.headers["content-disposition"]
        assert pdf.headers["cache-control"] == "no-store"
    assert list(tmp_path.iterdir()) == [], "no PDF may be left on the server's disk"


async def test_document_number_uniqueness_is_enforced_by_the_database(world):
    from pymongo.errors import DuplicateKeyError

    from app.core.database import get_db
    from app.services.bootstrap import ensure_indexes

    invoices = get_db()["invoices"]
    # simulate a database created by an older version: same keys, but not unique
    for name, spec in (await invoices.index_information()).items():
        if name != "_id_":
            await invoices.drop_index(name)
    await invoices.create_index([("tenant_id", 1), ("invoice_number", 1)])
    await ensure_indexes()
    info = await invoices.index_information()
    assert info["uniq_tenant_invoice_number"]["unique"] is True and "tenant_id_1_invoice_number_1" not in info

    lead = await create_lead(world.admin_a)
    inv = (await bill(world.admin_a, lead["_id"]))["invoice"]
    with pytest.raises(DuplicateKeyError):
        await invoices.insert_one({"tenant_id": inv["tenant_id"], "invoice_number": inv["invoice_number"]})
    # the same number in another company is fine
    await invoices.insert_one({"tenant_id": str(world.tenant_b.id), "invoice_number": inv["invoice_number"]})

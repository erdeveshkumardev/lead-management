"""Lead lifecycle: creation, de-duplication, stages, assignment, follow-ups, import/export, analytics."""
import asyncio
import csv
import io
from datetime import datetime, timedelta, timezone

from app.models.audit_log import AuditLog
from app.models.lead import Lead
from app.models.user import User
from tests.conftest import ITEM, create_lead, reset_rate_limits


async def test_create_normalises_and_deduplicates_contacts(world):
    admin = world.admin_a
    lead = await create_lead(admin, phone="+91 98250-11111", email="  Kiran@Buyer.Example ", state="gujrat", gstin=None)
    assert lead["phone"] == "9825011111" and lead["email"] == "kiran@buyer.example"
    assert lead["timeline"][0]["performed_by_name"] == "Asha Admin" and "Open Pool" in lead["timeline"][0]["note"]
    assert lead["assigned_to_user_id"] is None and lead["stage"] == "NEW"
    assert "raw_payload" not in lead

    # the same person again (different formatting) is merged into the existing lead
    for variant in ("09825011111", "919825011111", "98250 11111"):
        resp = await admin.post("/api/v1/leads/", json={"full_name": "Kiran B", "phone": variant, "product_inquired": "Lathe"})
        assert resp.status_code == 201 and resp.json()["is_duplicate"] is True and resp.json()["lead"]["_id"] == lead["_id"]
    assert await Lead.find({}).count() == 1
    assert (await Lead.get(lead["_id"])).timeline[-1].activity_type == "DUPLICATE_INQUIRY"

    by_email = await admin.post("/api/v1/leads/", json={"full_name": "Mail Only", "email": "mail.only@buyer.example"})
    assert by_email.status_code == 201 and by_email.json()["lead"]["phone"] == ""
    again = await admin.post("/api/v1/leads/", json={"full_name": "Mail Only 2", "email": "MAIL.ONLY@buyer.example"})
    assert again.json()["is_duplicate"] is True

    # validation
    assert (await admin.post("/api/v1/leads/", json={"full_name": "No Contact"})).status_code == 400
    assert (await admin.post("/api/v1/leads/", json={"full_name": "", "phone": "9825000000"})).status_code == 422
    assert (await admin.post("/api/v1/leads/", json={"full_name": "Bad G", "phone": "9825000001", "gstin": "24ABCDE1234F1Z5"})).status_code == 400
    assert (await admin.post("/api/v1/leads/", json={"full_name": "Neg", "phone": "9825000002", "deal_value": -1})).status_code == 422
    assert (await admin.post("/api/v1/leads/", json={"full_name": "x" * 500, "phone": "9825000003"})).status_code == 422


async def test_stage_changes_are_validated_and_attributed_to_the_real_user(world):
    staff = world.staff_a
    lead = await create_lead(staff)
    bad = await staff.post(f"/api/v1/leads/{lead['_id']}/stage", json={"stage": "MADE_UP_STAGE"})
    assert bad.status_code == 400
    ok = await staff.post(f"/api/v1/leads/{lead['_id']}/stage", json={"stage": "LOST", "lost_reason": "Budget Issue", "note": "Too costly"})
    body = ok.json()["lead"]
    entry = body["timeline"][-1]
    assert body["stage"] == "LOST" and body["lost_reason"] == "Budget Issue"
    assert entry["performed_by_name"] == "Sana Sales" and entry["performed_by_id"] == staff.user["id"]
    assert "Budget Issue" in entry["note"] and "Too costly" in entry["note"]

    cat = await staff.post(f"/api/v1/leads/{lead['_id']}/category", json={"category": "hot"})
    assert cat.json()["lead"]["category"] == "HOT"
    assert (await staff.post(f"/api/v1/leads/{lead['_id']}/category", json={"category": "LUKEWARM"})).status_code == 400
    act = await staff.post(f"/api/v1/leads/{lead['_id']}/activity", json={"activity_type": "CALL_LOG", "note": "Spoke to purchase head"})
    assert act.json()["lead"]["timeline"][-1]["performed_by_name"] == "Sana Sales"
    assert (await staff.post(f"/api/v1/leads/{lead['_id']}/activity", json={"activity_type": "STAGE_CHANGE", "note": "forged"})).status_code == 400

    # a company's own pipeline is honoured; stages in use cannot be removed
    tid = str(world.tenant_a.id)
    stages = [{"id": "NEW", "label": "New"}, {"id": "SITE_VISIT", "label": "Site Visit"}, {"id": "WON", "label": "Won"}]
    blocked = await world.admin_a.put(f"/api/v1/tenants/{tid}/stages", json={"stages": stages})
    assert blocked.status_code == 409 and "LOST" in blocked.json()["detail"]
    stages.append({"id": "LOST", "label": "Lost"})
    assert (await world.admin_a.put(f"/api/v1/tenants/{tid}/stages", json={"stages": stages})).status_code == 200
    assert (await staff.post(f"/api/v1/leads/{lead['_id']}/stage", json={"stage": "SITE_VISIT"})).status_code == 200
    assert (await staff.post(f"/api/v1/leads/{lead['_id']}/stage", json={"stage": "CONTACTED"})).status_code == 400
    assert list((await staff.get("/api/v1/leads/kanban")).json().keys()) == ["NEW", "SITE_VISIT", "WON", "LOST"]


async def test_editing_a_lead(world):
    admin = world.admin_a
    lead = await create_lead(admin)
    other = await create_lead(admin, phone="9825022222", full_name="Other")
    resp = await admin.patch(f"/api/v1/leads/{lead['_id']}", json={
        "phone": "(982) 503-3333", "email": "NEW@Mail.example", "state": "Maharashtra", "address": "12 MG Road", "priority": "high",
        "custom_fields": {"machine": "CNC-20", "$bad": 1}})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["phone"] == "9825033333" and body["email"] == "new@mail.example" and body["state_code"] == "27"
    assert body["priority"] == "HIGH" and body["custom_fields"]["machine"] == "CNC-20" and "$bad" not in body["custom_fields"]
    assert (await admin.patch(f"/api/v1/leads/{lead['_id']}", json={"phone": "9825022222"})).status_code == 409
    assert (await admin.patch(f"/api/v1/leads/{lead['_id']}", json={"gstin": "27AAPFU0939F1ZX"})).status_code == 400
    assert (await admin.patch(f"/api/v1/leads/{lead['_id']}", json={"email": "not-an-email"})).status_code == 400
    # fields that are not editable through this endpoint are ignored (no mass assignment)
    sneaky = await admin.patch(f"/api/v1/leads/{lead['_id']}", json={
        "tenant_id": str(world.tenant_b.id), "assigned_to_user_id": world.staff_a.user["id"], "stage": "WON",
        "is_deleted": True, "conversion_info": {"is_converted": True}, "city": "Pune"})
    saved = await Lead.get(lead["_id"])
    assert sneaky.status_code == 200 and saved.city == "Pune"
    assert saved.tenant_id == str(world.tenant_a.id) and saved.assigned_to_user_id is None and saved.stage == "NEW"
    assert saved.is_deleted is False and saved.conversion_info.is_converted is False
    assert other["_id"] != lead["_id"]


async def test_assignment_rules_and_counters(world):
    admin, manager = world.admin_a, world.manager_a
    s1, s2 = world.staff_a.user["id"], world.staff_a2.user["id"]
    lead = await create_lead(admin)

    refused = await admin.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": admin.user["id"]})
    assert refused.status_code == 400 and "Company Admin cannot be assigned" in refused.json()["detail"]
    other_company_user = world.admin_b.user["id"]
    assert (await admin.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": other_company_user})).status_code == 404

    first = await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": s1, "note": "Hot lead"})
    assert first.status_code == 200 and first.json()["lead"]["assigned_to_user_name"] == "Sana Sales"
    note = first.json()["lead"]["timeline"][-1]
    assert note["performed_by_name"] == "Mohan Manager" and "by Mohan Manager" in note["note"]
    assert (await User.get(s1)).assigned_leads_count == 1
    await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": s2})
    assert (await User.get(s1)).assigned_leads_count == 0 and (await User.get(s2)).assigned_leads_count == 1
    await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": "unassigned"})
    assert (await User.get(s2)).assigned_leads_count == 0 and (await Lead.get(lead["_id"])).assigned_to_user_id is None
    # the new owner can now see it, the previous owner cannot
    await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": s1})
    assert (await world.staff_a.get(f"/api/v1/leads/{lead['_id']}")).status_code == 200
    assert (await world.staff_a2.get(f"/api/v1/leads/{lead['_id']}")).status_code == 404

    more = [await create_lead(admin, phone=f"98250200{i:02d}") for i in range(4)]
    bulk = await admin.post("/api/v1/leads/bulk-assign", json={"lead_ids": [m["_id"] for m in more] + ["000000000000000000000000"], "user_id": s2})
    assert bulk.status_code == 200 and bulk.json()["updated"] == 4
    assert (await User.get(s2)).assigned_leads_count == 4
    assert (await world.staff_a2.get("/api/v1/leads/")).json()["total"] == 4


async def test_follow_up_scheduling_and_completion(world):
    staff = world.staff_a
    lead = await create_lead(staff)
    url = f"/api/v1/leads/{lead['_id']}/followup"
    soon = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat().replace("+00:00", "Z")
    later = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    assert (await staff.post(url, json={"scheduled_at": "not-a-date-at-all", "note": "x"})).status_code == 400
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert (await staff.post(url, json={"scheduled_at": past, "note": "x"})).status_code == 400
    assert (await staff.post(url, json={"scheduled_at": soon, "note": "x", "follow_up_type": "telepathy"})).status_code == 400

    await staff.post(url, json={"scheduled_at": later, "note": "Send revised quote", "follow_up_type": "email"})
    resp = await staff.post(url, json={"scheduled_at": soon, "note": "Call back", "follow_up_type": "call"})
    body = resp.json()["lead"]
    assert body["next_follow_up"]["note"] == "Call back", "the earliest pending follow-up is the next one"
    assert body["next_follow_up"]["assigned_to_user_name"] == "Sana Sales" and len(body["follow_ups"]) == 2

    summary = (await staff.get("/api/v1/leads/followups/summary")).json()
    assert summary["total_active"] == 1 and summary["today_count"] + summary["upcoming_count"] == 1
    assert (await staff.get("/api/v1/leads/?follow_up_filter=has_followup")).json()["total"] == 1
    assert (await staff.get("/api/v1/leads/?follow_up_filter=overdue")).json()["total"] == 0

    done = await staff.post(f"{url}/complete", json={"note": "Customer confirmed"})
    after = done.json()["lead"]
    assert after["next_follow_up"]["note"] == "Send revised quote"
    assert [f["status"] for f in after["follow_ups"]].count("COMPLETED") == 1
    assert "Sana Sales" in after["timeline"][-1]["note"]
    await staff.post(f"{url}/complete", json={})
    assert (await staff.post(f"{url}/complete", json={})).status_code == 400  # nothing left to complete


async def test_concurrent_updates_do_not_lose_timeline_entries(world):
    admin = world.admin_a
    lead = await create_lead(admin)
    calls = [admin.post(f"/api/v1/leads/{lead['_id']}/activity", json={"activity_type": "NOTE", "note": f"note {i}"}) for i in range(8)]
    results = await asyncio.gather(*calls)
    assert all(r.status_code in (200, 409) for r in results)
    saved = await Lead.get(lead["_id"])
    notes = [t.note for t in saved.timeline if t.activity_type == "NOTE"]
    assert len(notes) == sum(1 for r in results if r.status_code == 200), "every accepted note is stored exactly once"


async def test_search_filters_and_pagination_are_injection_safe(world):
    admin = world.admin_a
    await create_lead(admin, full_name="Regex (Special) [Chars]", phone="9825030001", company_name="A+B*C Ltd")
    await create_lead(admin, full_name="Plain Person", phone="9825030002", source="website")
    for term in ("(", "[", "*", ".*", "$where", "A+B*C", "\\", "{\"$gt\":\"\"}"):
        resp = await admin.get("/api/v1/leads/", params={"search": term})
        assert resp.status_code == 200, term
    assert (await admin.get("/api/v1/leads/", params={"search": ".*"})).json()["total"] == 0, "search text is literal, not a pattern"
    assert (await admin.get("/api/v1/leads/", params={"search": "A+B*C"})).json()["total"] == 1
    assert (await admin.get("/api/v1/leads/", params={"search": "x" * 300})).status_code == 422
    # search combined with the unassigned filter keeps both conditions
    both = (await admin.get("/api/v1/leads/", params={"search": "Plain", "assigned_to": "unassigned"})).json()
    assert both["total"] == 1 and both["items"][0]["full_name"] == "Plain Person"
    assert (await admin.get("/api/v1/leads/?source=website")).json()["total"] == 1
    assert (await admin.get("/api/v1/leads/?date_filter=today")).json()["total"] == 2
    assert (await admin.get("/api/v1/leads/?date_filter=custom&start_date=2020-01-01&end_date=2020-12-31")).json()["total"] == 0
    assert (await admin.get("/api/v1/leads/?date_filter=custom&start_date=garbage")).status_code == 400
    page = (await admin.get("/api/v1/leads/?limit=1&skip=1")).json()
    assert len(page["items"]) == 1 and page["total"] == 2
    assert (await admin.get("/api/v1/leads/?limit=100000")).status_code == 422
    assert all("timeline" not in item and "raw_payload" not in item for item in page["items"]), "lists stay lean"


async def test_csv_export_neutralises_formulas_and_import_round_trips(world):
    admin = world.admin_a
    await create_lead(admin, full_name="=HYPERLINK(\"http://evil\",\"x\")", phone="9825040001", company_name="+cmd|' /C calc'!A0",
                      product_inquired="@SUM(1+1)")
    export = await admin.get("/api/v1/leads/export")
    assert export.status_code == 200 and export.headers["content-type"].startswith("text/csv")
    assert "attachment" in export.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(export.text.lstrip("﻿"))))
    assert rows[0][:3] == ["Name", "Phone", "Email"] and len(rows) == 2
    for cell in rows[1]:
        assert not cell or cell[0] not in "=+-@", f"cell would run as a formula: {cell!r}"
    assert await AuditLog.find({"action": "lead.exported"}).count() == 1

    upload = ("Name,Mobile,Email,Company,State,Deal Value,GSTIN\n"
              "Import One,9825050001,one@imp.example,One Co,Gujarat,\"1,25,000\",\n"
              "Import Two,+91-9825050002,,Two Co,Maharashtra,5000,27AAPFU0939F1ZV\n"
              ",9825050003,,No Name,,,\n"
              "No Contact,,,,,,\n"
              "Import One Again,9825050001,,,,,\n")
    resp = await admin.post("/api/v1/leads/import", files={"file": ("leads.csv", upload.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert (result["created"], result["duplicates"]) == (2, 1) and len(result["errors"]) == 2
    two = await Lead.find_one({"phone": "9825050002"})
    assert two.source == "import" and two.state_code == "27" and two.deal_value == 5000 and two.assigned_to_user_id is None
    assert (await Lead.find_one({"phone": "9825050001"})).deal_value == 125000

    await reset_rate_limits()
    assert (await admin.post("/api/v1/leads/import", files={"file": ("x.exe", b"MZ", "application/octet-stream")})).status_code == 400
    assert (await admin.post("/api/v1/leads/import", files={"file": ("x.csv", b"Foo,Bar\n1,2\n", "text/csv")})).status_code == 400
    big = b"Name,Phone\n" + b"A,9825000000\n" * 500_000
    assert (await admin.post("/api/v1/leads/import", files={"file": ("big.csv", big, "text/csv")})).status_code == 413


async def test_soft_delete_and_restore(world):
    admin, manager = world.admin_a, world.manager_a
    lead = await create_lead(admin)
    await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": world.staff_a.user["id"]})
    assert (await admin.delete(f"/api/v1/leads/{lead['_id']}")).status_code == 200
    assert (await admin.get(f"/api/v1/leads/{lead['_id']}")).status_code == 404
    assert (await admin.get("/api/v1/leads/")).json()["total"] == 0
    assert (await admin.get("/api/v1/analytics/dashboard")).json()["leads_metrics"]["total_leads"] == 0
    assert (await User.get(world.staff_a.user["id"])).assigned_leads_count == 0
    kept = await Lead.get(lead["_id"])
    assert kept.is_deleted and kept.deleted_by == admin.user["id"], "the record is retained for audit"
    # a deleted contact can be entered again as a fresh lead
    again = await create_lead(admin)
    assert again["_id"] != lead["_id"]
    # recycle bin: listed for people who may delete, scoped like every other lead list, restorable from there
    binned = (await admin.get("/api/v1/leads/deleted")).json()
    assert binned["total"] == 1 and binned["items"][0]["_id"] == lead["_id"]
    assert "timeline" not in binned["items"][0] and "raw_payload" not in binned["items"][0]
    assert (await world.staff_a.get("/api/v1/leads/deleted")).status_code == 403, "needs the leads_delete permission"
    assert (await world.admin_b.get("/api/v1/leads/deleted")).json()["total"] == 0, "another company never sees it"
    assert (await world.admin_b.post(f"/api/v1/leads/{lead['_id']}/restore")).status_code == 404
    assert (await admin.post(f"/api/v1/leads/{lead['_id']}/restore")).status_code == 200
    assert (await admin.get("/api/v1/leads/deleted")).json()["total"] == 0
    assert (await admin.get("/api/v1/leads/")).json()["total"] == 2


async def test_dashboard_numbers(world):
    admin, manager = world.admin_a, world.manager_a
    s1 = world.staff_a.user["id"]
    leads = [await create_lead(admin, phone=f"98250600{i:02d}", source="website" if i % 2 else "manual", deal_value=1000 * (i + 1)) for i in range(5)]
    for lead in leads[:3]:
        await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": s1})
    await admin.post(f"/api/v1/leads/{leads[0]['_id']}/stage", json={"stage": "CONTACTED"})
    await admin.post(f"/api/v1/invoices/from-lead/{leads[1]['_id']}", json={"document_type": "TAX_INVOICE", "items": [ITEM]})

    data = (await admin.get("/api/v1/analytics/dashboard")).json()
    metrics = data["leads_metrics"]
    assert metrics["total_leads"] == 5 and metrics["converted_leads"] == 1 and metrics["conversion_rate_percentage"] == 20.0
    assert metrics["stage_breakdown"] == {"NEW": 3, "CONTACTED": 1, "WON": 1}
    assert metrics["source_breakdown"] == {"manual": 3, "website": 2}
    by_staff = {s["staff_id"]: s for s in data["staff_summary"]}
    assert by_staff[s1]["total_leads"] == 3 and by_staff[s1]["converted_count"] == 1
    assert by_staff["unassigned"]["total_leads"] == 2 and data["staff_summary"][-1]["staff_id"] == "unassigned"
    assert data["financial_metrics"] == {"total_invoices_count": 1, "total_billed_amount": 118000.0,
                                         "total_collected_amount": 0.0, "total_pending_amount": 118000.0}
    assert len(data["recent_leads"]) == 5 and "timeline" not in data["recent_leads"][0]


async def test_follow_up_whatsapp_alerts_and_lead_simulator(world):
    admin, manager = world.admin_a, world.manager_a
    lead = await create_lead(admin)
    await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": world.staff_a.user["id"]})
    await world.staff_a.put(f"/api/v1/profile/{world.staff_a.user['id']}", json={"whatsapp_number": "9825099999"})
    soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    await world.staff_a.post(f"/api/v1/leads/{lead['_id']}/followup", json={"scheduled_at": soon, "note": "Call"})

    resp = await manager.post("/api/v1/leads/send-followup-whatsapp-alerts")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_pending_leads"] == 1 and body["total_staff_notified"] == 1
    row = body["results"][0]
    # no WhatsApp gateway is configured: nothing is sent, the manager gets a manual wa.me link instead
    assert row["status"] == "simulated" and row["whatsapp_link"].startswith("https://wa.me/919825099999?text=")
    assert row["staff_name"] == "Sana Sales" and row["pending_count"] == 1

    sim = await admin.post("/api/v1/leads/simulate", json={"source": "indiamart"})
    assert sim.status_code == 200 and sim.json()["is_duplicate"] is False
    created = await Lead.find_one({"source": "indiamart"})
    assert created.custom_fields["test_lead"] is True and created.tenant_id == str(world.tenant_a.id)
    assert (await admin.post("/api/v1/leads/simulate", json={"source": "sqlmap"})).status_code == 422

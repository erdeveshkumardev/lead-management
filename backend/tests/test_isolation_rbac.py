"""Multi-tenant isolation and role / permission enforcement on the server."""
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.user import User
from tests.conftest import ITEM, PASSWORD, create_lead, login, make_user, new_client, reset_rate_limits, sign_in


async def _invoice(session, lead_id, document_type="QUOTATION"):
    resp = await session.post(f"/api/v1/invoices/from-lead/{lead_id}", json={"document_type": document_type, "items": [ITEM]})
    assert resp.status_code == 201, resp.text
    return resp.json()["invoice"]


async def test_company_cannot_read_or_change_another_companys_records(world):
    a, b = world.admin_a, world.admin_b
    lead = await create_lead(a)
    invoice = await _invoice(a, lead["_id"])
    product = (await a.post("/api/v1/products/", json={"name": "Lathe", "unit_price": 100, "hsn_sac_code": "8458"})).json()
    staff_id = world.staff_a.user["id"]
    tid_a = str(world.tenant_a.id)

    # company B sees nothing of company A in its own lists
    assert (await b.get("/api/v1/leads/")).json()["total"] == 0
    assert (await b.get("/api/v1/invoices/")).json()["total"] == 0
    assert (await b.get("/api/v1/products/")).json() == []
    assert all(v == [] for v in (await b.get("/api/v1/leads/kanban")).json().values())
    assert (await b.get("/api/v1/analytics/dashboard")).json()["leads_metrics"]["total_leads"] == 0
    assert all(m["id"] != staff_id for m in (await b.get("/api/v1/team/members")).json()["members"])

    # ... and cannot reach A's records by guessing identifiers
    attempts = [
        ("GET", f"/api/v1/leads/{lead['_id']}", None),
        ("PATCH", f"/api/v1/leads/{lead['_id']}", {"full_name": "Hacked"}),
        ("DELETE", f"/api/v1/leads/{lead['_id']}", None),
        ("POST", f"/api/v1/leads/{lead['_id']}/stage", {"stage": "WON"}),
        ("POST", f"/api/v1/leads/{lead['_id']}/activity", {"activity_type": "NOTE", "note": "x"}),
        ("POST", f"/api/v1/leads/{lead['_id']}/assign", {"user_id": None}),
        ("POST", f"/api/v1/invoices/from-lead/{lead['_id']}", {"document_type": "QUOTATION", "items": [ITEM]}),
        ("GET", f"/api/v1/invoices/{invoice['_id']}", None),
        ("GET", f"/api/v1/invoices/{invoice['_id']}/pdf", None),
        ("POST", f"/api/v1/invoices/{invoice['_id']}/payments", {"amount": 1, "payment_mode": "CASH"}),
        ("POST", f"/api/v1/invoices/{invoice['_id']}/mark-as-paid", None),
        ("POST", f"/api/v1/invoices/{invoice['_id']}/cancel", {"reason": "testing"}),
        ("PATCH", f"/api/v1/products/{product['_id']}", {"unit_price": 1}),
        ("DELETE", f"/api/v1/products/{product['_id']}", None),
        ("PATCH", f"/api/v1/team/members/{staff_id}", {"role": "company_admin"}),
        ("PATCH", f"/api/v1/team/members/{staff_id}/permissions", {"permissions": {"leads_delete": True}}),
        ("POST", f"/api/v1/team/members/{staff_id}/reset-password", None),
        ("DELETE", f"/api/v1/team/members/{staff_id}", None),
        ("GET", f"/api/v1/profile/{staff_id}", None),
        ("PUT", f"/api/v1/profile/{staff_id}", {"full_name": "Hacked Name"}),
    ]
    for method, path, body in attempts:
        resp = await b.client.request(method, path, json=body, headers=b.headers)
        assert resp.status_code == 404, f"{method} {path} -> {resp.status_code} {resp.text[:120]}"

    # naming the other company explicitly is refused and recorded
    for path in (f"/api/v1/leads/?tenant_id={tid_a}", f"/api/v1/invoices/?tenant_id={tid_a}", f"/api/v1/tenants/{tid_a}",
                 f"/api/v1/tenants/{tid_a}/integrations", f"/api/v1/tenants/{tid_a}/stages", f"/api/v1/masters/company/{tid_a}",
                 f"/api/v1/team/members?tenant_id={tid_a}", f"/api/v1/settings/communication?tenant_id={tid_a}",
                 f"/api/v1/analytics/dashboard?tenant_id={tid_a}", "/api/v1/leads/?tenant_id=demo_tenant_01"):
        resp = await b.get(path)
        assert resp.status_code == 403, f"{path} -> {resp.status_code}"
    assert (await b.put(f"/api/v1/tenants/{tid_a}/profile", json={"company_name": "Owned"})).status_code == 403
    assert (await b.put(f"/api/v1/tenants/{tid_a}/integrations", json={"integrations": {}})).status_code == 403
    assert await AuditLog.find({"action": "security.cross_tenant_attempt"}).count() >= 10

    # company A's data is untouched
    fresh = (await a.get(f"/api/v1/leads/{lead['_id']}")).json()
    assert fresh["full_name"] == "Kiran Buyer" and fresh["stage"] == "PROPOSAL_SENT"
    assert (await User.get(staff_id)).role == "staff"


async def test_platform_administrator_has_no_access_to_company_business_data(world):
    await make_user("system", "super_admin", "root@platform.example", mfa_enabled=False)
    # enrol 2FA through the API so the session is fully privileged
    import pyotp

    client = new_client()
    token = (await login(client, "root@platform.example"))["access_token"]
    secret = (await client.post("/api/v1/auth/mfa/setup", headers={"Authorization": f"Bearer {token}"})).json()["secret"]
    enabled = await client.post("/api/v1/auth/mfa/enable", headers={"Authorization": f"Bearer {token}"},
                                json={"code": pyotp.TOTP(secret).now()})
    root = {"Authorization": f"Bearer {enabled.json()['access_token']}"}
    tid = str(world.tenant_a.id)

    assert (await client.get("/api/v1/super-admin/companies", headers=root)).status_code == 200
    for path in ("/api/v1/leads/", f"/api/v1/leads/?tenant_id={tid}", "/api/v1/invoices/", "/api/v1/products/",
                 f"/api/v1/team/members?tenant_id={tid}", f"/api/v1/tenants/{tid}/integrations",
                 f"/api/v1/settings/communication?tenant_id={tid}", "/api/v1/analytics/dashboard"):
        resp = await client.get(path, headers=root)
        assert resp.status_code == 403, f"{path} -> {resp.status_code}"
    # the read-only integration health view never contains credentials or tokens
    view = await client.get(f"/api/v1/super-admin/companies/{tid}/integrations", headers=root)
    assert view.status_code == 200 and "token" not in view.text and "secret" not in view.text
    await client.aclose()


async def test_company_users_cannot_use_platform_endpoints(world):
    for session in (world.admin_a, world.manager_a, world.staff_a):
        assert (await session.get("/api/v1/super-admin/companies")).status_code == 403
        assert (await session.get("/api/v1/super-admin/stats")).status_code == 403
        assert (await session.get("/api/v1/super-admin/audit-logs")).status_code == 403
        resp = await session.post("/api/v1/super-admin/companies", json={
            "company_name": "Rogue Co", "admin_name": "Rogue Admin", "admin_email": "rogue@x.example"})
        assert resp.status_code == 403
        tid = str(world.tenant_a.id)
        assert (await session.patch(f"/api/v1/super-admin/companies/{tid}", json={"max_users_limit": 999})).status_code == 403
        assert (await session.patch(f"/api/v1/super-admin/companies/{tid}/status", json={"status": "ACTIVE"})).status_code == 403
        assert (await session.post("/api/v1/masters/global", json={"master_type": "city", "code": "X", "name": "X"})).status_code == 403
    assert (await world.admin_a.get("/api/v1/masters/global")).status_code == 200  # reading masters is fine


async def test_sales_staff_only_see_and_touch_their_own_leads(world):
    admin, staff, other = world.admin_a, world.staff_a, world.staff_a2
    mine = await create_lead(staff, phone="9825000001", full_name="My Lead")
    assert mine["assigned_to_user_id"] == staff.user["id"], "a lead entered by sales staff stays with them"
    theirs = await create_lead(other, phone="9825000002", full_name="Their Lead")
    pool = await create_lead(admin, phone="9825000003", full_name="Pool Lead")
    assert pool["assigned_to_user_id"] is None

    listed = (await staff.get("/api/v1/leads/")).json()
    assert [l["full_name"] for l in listed["items"]] == ["My Lead"]
    # the 'assigned_to' filter cannot be used to look at a colleague's leads or the open pool
    for param in (other.user["id"], "all", "unassigned"):
        rows = (await staff.get(f"/api/v1/leads/?assigned_to={param}")).json()["items"]
        assert [l["full_name"] for l in rows] == ["My Lead"], param
    kanban = (await staff.get(f"/api/v1/leads/kanban?assigned_to={other.user['id']}")).json()
    assert sum(len(v) for v in kanban.values()) == 1
    dash = (await staff.get(f"/api/v1/analytics/dashboard?assigned_to={other.user['id']}")).json()
    assert dash["leads_metrics"]["total_leads"] == 1 and len(dash["staff_summary"]) == 1
    summary = (await staff.get("/api/v1/leads/followups/summary?assigned_to=all")).json()
    assert summary["total_active"] == 0

    for lead in (theirs, pool):
        assert (await staff.get(f"/api/v1/leads/{lead['_id']}")).status_code == 404
        assert (await staff.post(f"/api/v1/leads/{lead['_id']}/stage", json={"stage": "CONTACTED"})).status_code == 404
        assert (await staff.post(f"/api/v1/leads/{lead['_id']}/activity", json={"activity_type": "NOTE", "note": "x"})).status_code == 404
        assert (await staff.post(f"/api/v1/invoices/from-lead/{lead['_id']}", json={"document_type": "QUOTATION", "items": [ITEM]})).status_code == 404

    # a duplicate of a colleague's contact does not leak that lead's details
    dup = await staff.post("/api/v1/leads/", json={"full_name": "Someone", "phone": "9825000002"})
    assert dup.status_code == 201 and dup.json()["lead"] is None and dup.json()["is_duplicate"] is True

    # documents: staff see only what they raised themselves
    await _invoice(admin, pool["_id"])
    own_doc = await _invoice(staff, mine["_id"])
    docs = (await staff.get("/api/v1/invoices/")).json()
    assert [d["_id"] for d in docs["items"]] == [own_doc["_id"]]


async def test_permissions_are_enforced_by_the_server_not_the_browser(world):
    admin, manager, staff = world.admin_a, world.manager_a, world.staff_a
    lead = await create_lead(staff)
    tid = str(world.tenant_a.id)
    forbidden_for_staff = [
        ("POST", f"/api/v1/leads/{lead['_id']}/assign", {"user_id": staff.user["id"]}),
        ("POST", "/api/v1/leads/bulk-assign", {"lead_ids": [lead["_id"]], "user_id": staff.user["id"]}),
        ("DELETE", f"/api/v1/leads/{lead['_id']}", None),
        ("GET", "/api/v1/leads/export", None),
        ("POST", "/api/v1/leads/send-followup-whatsapp-alerts", None),
        ("POST", "/api/v1/leads/simulate", {"source": "indiamart"}),
        ("POST", "/api/v1/team/members", {"full_name": "New Hire", "email": "hire@alpha.example"}),
        ("POST", "/api/v1/products/", {"name": "Thing", "unit_price": 10}),
        ("GET", f"/api/v1/tenants/{tid}/integrations", None),
        ("PUT", f"/api/v1/tenants/{tid}/integrations", {"integrations": {}}),
        ("POST", f"/api/v1/tenants/{tid}/integrations/regenerate-keys", None),
        ("POST", f"/api/v1/tenants/{tid}/integrations/reveal", {"provider": "website", "password": PASSWORD}),
        ("PUT", f"/api/v1/tenants/{tid}/profile", {"company_name": "Renamed"}),
        ("PUT", f"/api/v1/tenants/{tid}/stages", {"stages": [{"id": "A", "label": "A"}, {"id": "B", "label": "B"}]}),
        ("PUT", f"/api/v1/masters/company/{tid}", {"masters": {"lost_reasons": ["x"]}}),
        ("GET", "/api/v1/settings/communication", None),
        ("PUT", "/api/v1/settings/communication", {"sms": {"is_enabled": True}}),
        ("GET", "/api/v1/audit/logs", None),
    ]
    for method, path, body in forbidden_for_staff:
        resp = await staff.client.request(method, path, json=body, headers=staff.headers)
        assert resp.status_code == 403, f"staff {method} {path} -> {resp.status_code} {resp.text[:100]}"

    # staff cannot record payments or cancel documents (no billing_payments / billing_cancel)
    quote = await _invoice(staff, lead["_id"])
    assert (await staff.post(f"/api/v1/invoices/{quote['_id']}/payments", json={"amount": 10, "payment_mode": "CASH"})).status_code == 403
    assert (await staff.post(f"/api/v1/invoices/{quote['_id']}/mark-as-paid")).status_code == 403
    assert (await staff.post(f"/api/v1/invoices/{quote['_id']}/cancel", json={"reason": "oops"})).status_code == 403

    # manager: can assign and manage staff, but cannot touch company settings, delete leads or read the audit trail
    assert (await manager.post(f"/api/v1/leads/{lead['_id']}/assign", json={"user_id": world.staff_a2.user["id"]})).status_code == 200
    assert (await manager.delete(f"/api/v1/leads/{lead['_id']}")).status_code == 403
    assert (await manager.get(f"/api/v1/tenants/{tid}/integrations")).status_code == 403
    assert (await manager.get("/api/v1/audit/logs")).status_code == 403
    # administrator can do all of it
    assert (await admin.get(f"/api/v1/tenants/{tid}/integrations")).status_code == 200
    assert (await admin.get("/api/v1/audit/logs")).status_code == 200
    assert (await admin.delete(f"/api/v1/leads/{lead['_id']}")).status_code == 200


async def test_no_privilege_escalation_through_team_management(world):
    admin, manager, staff = world.admin_a, world.manager_a, world.staff_a
    staff_id, manager_id, admin_id = staff.user["id"], manager.user["id"], admin.user["id"]

    # a manager cannot mint administrators or managers, nor grant what they do not hold
    for role in ("company_admin", "manager", "super_admin", "root"):
        resp = await manager.post("/api/v1/team/members", json={"full_name": "Sneaky User", "email": f"{role}@alpha.example", "role": role})
        assert resp.status_code == 403, role
    resp = await manager.patch(f"/api/v1/team/members/{staff_id}/permissions", json={"permissions": {"leads_delete": True}})
    assert resp.status_code == 403
    resp = await manager.patch(f"/api/v1/team/members/{staff_id}/permissions",
                               json={"permissions": {"settings_manage": True, "audit_view": True}})
    assert resp.status_code == 403
    assert (await manager.patch(f"/api/v1/team/members/{staff_id}", json={"role": "company_admin"})).status_code == 403
    assert (await manager.patch(f"/api/v1/team/members/{admin_id}", json={"is_active": False})).status_code == 403
    assert (await manager.post(f"/api/v1/team/members/{admin_id}/reset-password")).status_code == 403
    assert (await manager.delete(f"/api/v1/team/members/{admin_id}")).status_code == 403
    # nobody edits their own permissions / role, and unknown permission names are ignored
    assert (await manager.patch(f"/api/v1/team/members/{manager_id}/permissions", json={"permissions": {"leads_view_all": True}})).status_code == 400
    assert (await manager.patch(f"/api/v1/team/members/{manager_id}", json={"role": "company_admin"})).status_code in (400, 403)
    ok = await manager.patch(f"/api/v1/team/members/{staff_id}/permissions",
                             json={"permissions": {"leads_export": True, "all_access": True, "companies_manage": True}})
    assert ok.status_code == 200
    perms = ok.json()["permissions"]
    assert perms["leads_export"] is True and perms["all_access"] is False and perms["companies_manage"] is False
    # the grant is live for the staff member's existing session, and only that grant
    await reset_rate_limits()
    assert (await staff.get("/api/v1/leads/export")).status_code == 200
    assert (await staff.get("/api/v1/audit/logs")).status_code == 403

    # the last administrator cannot be removed or demoted
    assert (await admin.delete(f"/api/v1/team/members/{admin_id}")).status_code == 400
    promoted = await admin.patch(f"/api/v1/team/members/{manager_id}", json={"role": "company_admin"})
    assert promoted.status_code == 200
    # a role change ends that user's old sessions (old token carries the old role)
    assert (await manager.get("/api/v1/leads/")).status_code == 401


async def test_team_creation_passwords_and_seat_limit(world):
    admin = world.admin_a
    resp = await admin.post("/api/v1/team/members", json={"full_name": "Fifth Person", "email": "Fifth@Alpha.example", "role": "staff"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    temp = body["temp_password"]
    assert len(temp) >= 12 and body["is_first_login"] is True and "hashed_password" not in resp.text
    stored = await User.find_one({"email": "fifth@alpha.example"})
    assert stored.hashed_password.startswith("$argon2id$") and temp not in stored.model_dump_json()
    assert stored.must_change_password and stored.temp_password_expires_at
    raw = await get_db()["users"].find_one({"email": "fifth@alpha.example"})
    assert "temp_password" not in raw, "temporary passwords are never stored in readable form"

    # the member list never exposes credentials or security internals
    listing = (await admin.get("/api/v1/team/members")).text
    for secret in ("hashed_password", "$argon2", "mfa_secret", "recovery", "token_version", "reset_token"):
        assert secret not in listing, secret
    # colleagues without team_manage get names only (no e-mail / phone / permissions)
    directory = (await world.staff_a.get("/api/v1/team/members")).json()["members"]
    assert all("email" not in m and "permissions" not in m for m in directory)

    # weak passwords chosen by the administrator are refused; the default plan allows 5 active users
    weak = await admin.post("/api/v1/team/members", json={"full_name": "Weak Pass", "email": "weak@alpha.example", "password": "password123"})
    assert weak.status_code == 400
    full = await admin.post("/api/v1/team/members", json={"full_name": "Sixth Person", "email": "sixth@alpha.example"})
    assert full.status_code == 400 and "limit" in full.json()["detail"].lower()
    dup = await admin.post("/api/v1/team/members", json={"full_name": "Dup", "email": "fifth@alpha.example"})
    assert dup.status_code in (400, 409)

    # removing a member frees the seat, signs them out, and keeps the record for the audit trail
    new_session = await sign_in("fifth@alpha.example", temp)
    assert (await admin.delete(f"/api/v1/team/members/{stored.id}")).status_code == 200
    assert (await new_session.get("/api/v1/auth/me")).status_code == 401
    assert (await User.get(stored.id)).is_active is False
    assert (await admin.post("/api/v1/team/members", json={"full_name": "Sixth Person", "email": "sixth@alpha.example"})).status_code == 201
    await new_session.close()


async def test_profile_is_self_service_only(world):
    staff, other = world.staff_a, world.staff_a2
    mine = await staff.put(f"/api/v1/profile/{staff.user['id']}", json={"full_name": "Sana S. Sales", "whatsapp_number": "+91 98250 12345"})
    assert mine.status_code == 200 and mine.json()["profile"]["full_name"] == "Sana S. Sales"
    assert (await staff.put(f"/api/v1/profile/{other.user['id']}", json={"full_name": "Defaced"})).status_code == 404
    assert (await staff.get(f"/api/v1/profile/{other.user['id']}")).status_code == 404
    # changing somebody else's password by naming their id is impossible: the session decides
    resp = await staff.post("/api/v1/profile/change-password", json={
        "user_id": other.user["id"], "current_password": PASSWORD, "new_password": "Fresh!Passw-rd#77", "confirm_password": "Fresh!Passw-rd#77"})
    assert resp.status_code == 200
    async with new_client() as c:
        assert (await c.post("/api/v1/auth/login", json={"email": "staff2@alpha.example", "password": PASSWORD})).status_code == 200
        assert (await c.post("/api/v1/auth/login", json={"email": "staff1@alpha.example", "password": "Fresh!Passw-rd#77"})).status_code == 200
    bad = await staff.put(f"/api/v1/profile/{staff.user['id']}", json={"avatar_url": "javascript:alert(1)"})
    assert bad.status_code in (400, 401)

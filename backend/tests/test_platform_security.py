"""Platform administration, hardening headers, configuration safety, SSRF protection and data migration."""
import json

import pyotp
import pytest
from starlette.requests import Request

from app.core import database
from app.core.config import Settings, settings
from app.core.crypto import decrypt_str, encrypt_str, is_encrypted, mask_secret
from app.core.database import get_db
from app.core.deps import get_client_ip
from app.core.net import UnsafeDestination, is_public_ip, validate_public_url, validate_smtp_host
from app.core.security import verify_password
from app.core.validators import sanitize_flat_dict, sanitize_nested
from app.models.audit_log import AuditLog
from app.models.tenant import Tenant
from app.models.user import User
from app.services.csv_service import neutralize
from tests.conftest import (PASSWORD, bearer, create_lead, login, make_user, new_client, reset_rate_limits, sign_in,
                            valid_gstin)


async def platform_admin():
    """A platform administrator session with two-factor authentication completed."""
    await make_user("system", "super_admin", "root@platform.example", full_name="Root Admin")
    client = new_client()
    token = (await login(client, "root@platform.example"))["access_token"]
    secret = (await client.post("/api/v1/auth/mfa/setup", headers=bearer(token))).json()["secret"]
    session = (await client.post("/api/v1/auth/mfa/enable", headers=bearer(token), json={"code": pyotp.TOTP(secret).now()})).json()
    return client, bearer(session["access_token"])


async def test_company_onboarding_by_the_platform_administrator(world):
    client, root = await platform_admin()
    resp = await client.post("/api/v1/super-admin/companies", headers=root, json={
        "company_name": "Gamma Exports Pvt. Ltd.", "admin_name": "Gita Admin", "admin_email": "Gita@Gamma.example",
        "max_users_limit": 3, "plan_name": "Starter", "gstin": valid_gstin("27", "AAACG4321K")})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    temp = body["temp_password"]
    assert body["admin_email"] == "gita@gamma.example" and body["email_status"] == "not_configured" and len(temp) >= 12
    tenant = await Tenant.get(body["tenant_id"])
    assert tenant.state_code == "27" and tenant.state_name == "Maharashtra" and tenant.slug == "gamma-exports-pvt-ltd"
    admin = await User.find_one({"email": "gita@gamma.example"})
    assert admin.must_change_password and admin.role == "company_admin" and verify_password(temp, admin.hashed_password)

    # validation and uniqueness
    dup = await client.post("/api/v1/super-admin/companies", headers=root, json={
        "company_name": "Gamma Exports Pvt. Ltd.", "admin_name": "Other", "admin_email": "gita@gamma.example"})
    assert dup.status_code == 409
    bad = await client.post("/api/v1/super-admin/companies", headers=root, json={
        "company_name": "Delta", "admin_name": "D Admin", "admin_email": "d@delta.example", "gstin": "27AAPFU0939F1ZX"})
    assert bad.status_code == 400
    weak = await client.post("/api/v1/super-admin/companies", headers=root, json={
        "company_name": "Delta", "admin_name": "D Admin", "admin_email": "d@delta.example", "admin_password": "password123"})
    assert weak.status_code == 400 and await Tenant.find({"company_name": "Delta"}).count() == 0

    listing = (await client.get("/api/v1/super-admin/companies", headers=root)).json()
    assert {c["company_name"] for c in listing} >= {"Alpha Industries", "Beta Traders", "Gamma Exports Pvt. Ltd."}
    alpha = next(c for c in listing if c["company_name"] == "Alpha Industries")
    assert alpha["current_users"] == 4 and "integrations" not in alpha
    stats = (await client.get("/api/v1/super-admin/stats", headers=root)).json()
    assert stats["total_companies"] == 3 and stats["total_platform_users"] == 6

    # licensing: the seat limit cannot drop below the active head-count; suspension signs everyone out
    tid = str(world.tenant_a.id)
    low = await client.patch(f"/api/v1/super-admin/companies/{tid}", headers=root, json={"max_users_limit": 2})
    assert low.status_code == 400
    assert (await client.patch(f"/api/v1/super-admin/companies/{tid}/status", headers=root, json={"status": "DELETED"})).status_code == 400
    assert (await world.admin_a.get("/api/v1/leads/")).status_code == 200
    assert (await client.patch(f"/api/v1/super-admin/companies/{tid}/status", headers=root, json={"status": "SUSPENDED"})).status_code == 200
    assert (await world.admin_a.get("/api/v1/leads/")).status_code in (401, 403)
    assert (await world.admin_b.get("/api/v1/leads/")).status_code == 200, "other companies are unaffected"

    # account recovery for a locked-out company administrator
    await client.patch(f"/api/v1/super-admin/companies/{tid}/status", headers=root, json={"status": "ACTIVE"})
    reset = await client.post(f"/api/v1/super-admin/companies/{tid}/reset-admin-password", headers=root)
    assert reset.status_code == 200 and reset.json()["admin_email"] == "admin@alpha.example"
    recovered = await sign_in("admin@alpha.example", reset.json()["temp_password"])
    assert recovered.user["is_first_login"] is True
    await recovered.close()

    actions = {a.action for a in await AuditLog.find({"actor_role": "super_admin"}).to_list()}
    assert {"platform.company_created", "platform.company_status_changed", "platform.company_admin_password_reset"} <= actions
    logs = await client.get("/api/v1/super-admin/audit-logs?action=platform.", headers=root)
    assert logs.status_code == 200 and logs.json()["total"] >= 4
    await client.aclose()


async def test_audit_trail_records_who_did_what_without_secrets(world):
    admin = world.admin_a
    lead = await create_lead(admin)
    await admin.delete(f"/api/v1/leads/{lead['_id']}")
    await admin.post("/api/v1/team/members", json={"full_name": "Audit Target", "email": "target@alpha.example"})
    async with new_client() as c:
        await c.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": "wrong-password"})

    logs = (await admin.get("/api/v1/audit/logs?limit=200")).json()["items"]
    by_action = {entry["action"]: entry for entry in logs}
    assert {"auth.login", "auth.login_failed", "lead.created", "lead.deleted", "team.member_created"} <= set(by_action)
    deleted = by_action["lead.deleted"]
    assert deleted["actor_email"] == "admin@alpha.example" and deleted["entity_id"] == lead["_id"] and deleted["ip"]
    assert by_action["auth.login_failed"]["status"] == "failure"
    dump = json.dumps(logs)
    assert PASSWORD not in dump and "wrong-password" not in dump and "$argon2" not in dump
    # each company only sees its own trail
    other = (await world.admin_b.get("/api/v1/audit/logs?limit=200")).json()["items"]
    assert all(entry["tenant_id"] == str(world.tenant_b.id) for entry in other)
    assert (await admin.get("/api/v1/audit/logs?action=lead.&status=success")).json()["total"] == 2


async def test_security_headers_and_error_hygiene(client, monkeypatch):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    headers = resp.headers
    assert headers["x-content-type-options"] == "nosniff" and headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer" and "frame-ancestors 'none'" in headers["content-security-policy"]
    assert headers["cache-control"] == "no-store" and len(headers["x-request-id"]) >= 16
    assert "server" not in headers
    assert "strict-transport-security" not in headers, "HSTS is a production-only header"
    assert (await client.get("/readyz")).status_code == 200

    # production: HTTPS is enforced by the browser for a year, without committing the domain to the preload list
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    hsts = (await client.get("/healthz")).headers["strict-transport-security"]
    assert hsts == "max-age=31536000; includeSubDomains" and "preload" not in hsts
    monkeypatch.setattr(settings, "HSTS_MAX_AGE_SECONDS", 0)
    assert "strict-transport-security" not in (await client.get("/healthz")).headers
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    assert (await client.get("/")).json() == {"status": "online"}  # nothing about versions or documentation

    # an unexpected failure returns a reference id, never a stack trace or internal message
    async def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail: mongodb://user:password@host")

    monkeypatch.setattr("app.api.v1.endpoints.auth.rate_limiter.enforce", boom)
    async with new_client() as safe:
        safe._transport = __import__("httpx").ASGITransport(app=safe._transport.app, raise_app_exceptions=False)
        crash = await safe.post("/api/v1/auth/login", json={"email": "a@b.example", "password": "x"})
    assert crash.status_code == 500
    assert "secret internal detail" not in crash.text and "Traceback" not in crash.text and crash.json()["request_id"]

    # validation errors never echo the submitted value (it could be a password)
    bad = await client.post("/api/v1/auth/login", json={"email": "a@b.example", "password": "p" * 500})
    assert bad.status_code == 422 and "ppppp" not in bad.text
    oversized = await client.post("/api/v1/auth/login", content=b"x" * (settings.MAX_REQUEST_BODY_BYTES + 1),
                                  headers={"Content-Type": "application/json"})
    assert oversized.status_code == 413


def _request(xff=None, peer="10.0.0.9"):
    headers = [(b"x-forwarded-for", xff.encode())] if xff else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234), "method": "GET", "path": "/"})


def test_client_ip_trusts_only_the_configured_proxy_hops(monkeypatch):
    monkeypatch.setattr(settings, "FORWARDED_ALLOW_HOPS", 1)
    # the proxy appends the address it really saw; anything left of it was supplied by the client
    assert get_client_ip(_request("1.1.1.1, 203.0.113.7")) == "203.0.113.7"
    assert get_client_ip(_request("203.0.113.7")) == "203.0.113.7"
    assert get_client_ip(_request(None)) == "10.0.0.9"
    monkeypatch.setattr(settings, "FORWARDED_ALLOW_HOPS", 2)
    assert get_client_ip(_request("6.6.6.6, 203.0.113.7, 10.0.0.1")) == "203.0.113.7"
    monkeypatch.setattr(settings, "FORWARDED_ALLOW_HOPS", 0)
    assert get_client_ip(_request("6.6.6.6")) == "10.0.0.9", "without a proxy the header is ignored entirely"


async def test_host_header_allow_list_spares_only_the_health_probes():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core.middleware import ProbeAwareTrustedHostMiddleware

    probe_app = FastAPI()

    @probe_app.get("/healthz")
    def _healthz():
        return {"status": "ok"}

    @probe_app.get("/api/v1/anything")
    def _anything():
        return {"reached": True}

    probe_app.add_middleware(ProbeAwareTrustedHostMiddleware, allowed_hosts=["crm.example.com"])
    async with AsyncClient(transport=ASGITransport(app=probe_app), base_url="http://10.42.0.15:8000") as pod_ip:
        assert (await pod_ip.get("/healthz")).status_code == 200, "kubelet probes arrive with the pod IP as Host"
        assert (await pod_ip.get("/api/v1/anything")).status_code == 400, "everything else needs an allowed Host"
        assert (await pod_ip.get("/healthz/../api/v1/anything")).status_code in (400, 404)
    async with AsyncClient(transport=ASGITransport(app=probe_app), base_url="https://crm.example.com") as public:
        assert (await public.get("/api/v1/anything")).json() == {"reached": True}
        evil = await public.get("/api/v1/anything", headers={"Host": "evil.example.net"})
        assert evil.status_code == 400


def test_configuration_refuses_to_start_unsafely():
    strong = "k" * 48
    key = "x1XGRuTn3bY1mXjv8q0Xz6m6k1y2b9s7H5cN3wQ4rT8="

    def check(**env):
        Settings(_env_file=None, **env).validate_runtime()

    for weak in ("supersecret_jwt_key_change_in_production", "dev_secret_key_change_in_production", "short", "changeme"):
        with pytest.raises(RuntimeError):
            check(ENVIRONMENT="development", SECRET_KEY=weak, ENCRYPTION_KEYS=key)
    with pytest.raises(RuntimeError, match="ENCRYPTION_KEYS"):
        check(ENVIRONMENT="development", SECRET_KEY=strong, ENCRYPTION_KEYS="")
    with pytest.raises(RuntimeError, match="Fernet"):
        check(ENVIRONMENT="development", SECRET_KEY=strong, ENCRYPTION_KEYS="not-a-key")
    prod = dict(ENVIRONMENT="production", SECRET_KEY=strong, ENCRYPTION_KEYS=key, FRONTEND_BASE_URL="https://crm.example.com",
                BACKEND_CORS_ORIGINS="https://crm.example.com", ALLOWED_HOSTS="crm.example.com")
    check(**prod)
    for override in ({"SECRET_KEY": ""}, {"BACKEND_CORS_ORIGINS": "*"}, {"BACKEND_CORS_ORIGINS": "http://crm.example.com"},
                     {"COOKIE_SECURE": False}, {"FRONTEND_BASE_URL": "http://crm.example.com"}, {"ALLOW_PRIVATE_OUTBOUND": True},
                     {"BACKEND_CORS_ORIGINS": ""}, {"ACCESS_TOKEN_EXPIRE_MINUTES": 10080}, {"REFRESH_TOKEN_EXPIRE_DAYS": 365}):
        with pytest.raises(RuntimeError):
            check(**{**prod, **override})
    # the week-long access tokens of older deployments are refused in every environment
    with pytest.raises(RuntimeError, match="ACCESS_TOKEN_EXPIRE_MINUTES"):
        check(ENVIRONMENT="development", SECRET_KEY=strong, ENCRYPTION_KEYS=key, ACCESS_TOKEN_EXPIRE_MINUTES=10080)
    production = Settings(_env_file=None, **prod)
    assert production.cookie_secure is True and production.docs_enabled is False and production.lead_simulator_enabled is False


async def test_outbound_destinations_are_checked_against_ssrf():
    for ip in ("127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1",
               "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1", "not-an-ip"):
        assert not is_public_ip(ip), ip
    assert is_public_ip("8.8.8.8") and is_public_ip("2606:4700:4700::1111")

    for url in ("http://8.8.8.8/hook", "https://127.0.0.1/hook", "https://169.254.169.254/latest/meta-data/",
                "https://10.0.0.5:443/x", "https://[::1]/x", "https://user:pass@8.8.8.8/x", "https://8.8.8.8:22/x",
                "ftp://8.8.8.8/x", "file:///etc/passwd", "https:///nohost", "gopher://8.8.8.8/", "https://localhost/x"):
        with pytest.raises(UnsafeDestination):
            await validate_public_url(url)
    parts, ip, port = await validate_public_url("https://8.8.8.8/hook?x=1")
    assert (ip, port, parts.path) == ("8.8.8.8", 443, "/hook")
    with pytest.raises(UnsafeDestination):
        await validate_smtp_host("127.0.0.1", 587)
    with pytest.raises(UnsafeDestination):
        await validate_smtp_host("8.8.8.8", 6379)  # not a mail port
    assert await validate_smtp_host("8.8.8.8", 587) == "8.8.8.8"


async def test_communication_gateways_are_protected_encrypted_and_masked(world):
    admin = world.admin_a
    saved = await admin.put("/api/v1/settings/communication", json={
        "email": {"is_enabled": True, "mode": "api", "api_provider": "sendgrid", "api_key": "SG.super-secret-key-1234", "from_email": "crm@alpha.example"},
        "whatsapp": {"is_enabled": True, "provider": "cloud_api", "phone_number_id": "1234567890", "access_token": "EAAB-wa-token-9876"},
        "sms": {"is_enabled": False, "provider": "fast2sms", "api_key": "F2S-key-5555", "status": "Hacked", "unknown_field": "x"}})
    assert saved.status_code == 200, saved.text
    shown = (await admin.get("/api/v1/settings/communication")).json()
    assert shown["email"]["api_key"].endswith("1234") and "super-secret" not in json.dumps(shown)
    assert shown["whatsapp"]["has_access_token"] is True and "EAAB" not in json.dumps(shown)
    assert shown["sms"]["status"] == "Disabled" and "unknown_field" not in shown["sms"]
    raw = await get_db()["tenants"].find_one({"_id": world.tenant_a.id})
    comm = raw["communication_settings"]
    assert all(is_encrypted(v) for v in (comm["email"]["api_key"], comm["whatsapp"]["access_token"], comm["sms"]["api_key"]))
    assert decrypt_str(comm["email"]["api_key"]) == "SG.super-secret-key-1234"
    # saving the masked form back keeps the real secret
    await admin.put("/api/v1/settings/communication", json={"email": {"api_key": shown["email"]["api_key"], "from_name": "Alpha CRM"}})
    raw = await get_db()["tenants"].find_one({"_id": world.tenant_a.id})
    assert decrypt_str(raw["communication_settings"]["email"]["api_key"]) == "SG.super-secret-key-1234"

    # gateway addresses that point inside the network are refused when saved
    for body in ({"sms": {"provider": "custom_http", "custom_url": "http://169.254.169.254/latest/meta-data/?k={API_KEY}"}},
                 {"sms": {"provider": "custom_http", "custom_url": "https://127.0.0.1/send?to={TO}"}},
                 {"whatsapp": {"provider": "custom_webhook", "custom_webhook_url": "https://10.0.0.8/wa"}},
                 {"email": {"is_enabled": True, "mode": "smtp", "smtp_host": "127.0.0.1", "smtp_port": 587}},
                 {"email": {"is_enabled": True, "mode": "smtp", "smtp_host": "8.8.8.8", "smtp_port": 6379}},
                 {"email": {"is_enabled": True, "mode": "smtp", "smtp_host": "8.8.8.8", "smtp_port": 587, "smtp_use_tls": False}},
                 {"email": {"mode": "carrier-pigeon"}}):
        resp = await admin.put("/api/v1/settings/communication", json=body)
        assert resp.status_code == 400, body

    # test messages: validated recipient, rate limited, no gateway -> honest answer + manual WhatsApp link
    await admin.put("/api/v1/settings/communication", json={"whatsapp": {"is_enabled": False}, "email": {"is_enabled": False}})
    assert (await admin.post("/api/v1/settings/communication/test", json={"channel": "email", "recipient": "not-an-email"})).status_code == 400
    assert (await admin.post("/api/v1/settings/communication/test", json={"channel": "fax", "recipient": "12345678"})).status_code == 422
    mail = (await admin.post("/api/v1/settings/communication/test", json={"channel": "email", "recipient": "qa@alpha.example"})).json()
    assert mail["status"] == "not_configured"
    wa = (await admin.post("/api/v1/settings/communication/test", json={"channel": "whatsapp", "recipient": "9825012345"})).json()
    assert wa["status"] == "simulated" and wa["whatsapp_link"].startswith("https://wa.me/919825012345")
    codes = [(await admin.post("/api/v1/settings/communication/test", json={"channel": "sms", "recipient": "9825012345"})).status_code for _ in range(5)]
    assert codes[-1] == 429


async def test_company_profile_validation(world):
    admin, tid = world.admin_a, str(world.tenant_a.id)
    url = f"/api/v1/tenants/{tid}/profile"
    for body in ({"gstin": "24ABCDE1234F1Z5"}, {"pan_number": "BADPAN"}, {"pincode": "12"}, {"email": "nope"},
                 {"bank_details": {"ifsc_code": "HDFC"}}, {"bank_details": {"upi_id": "no-at-sign"}}, {"company_name": "   "},
                 {"phone": "<script>"}):
        assert (await admin.put(url, json=body)).status_code == 400, body
    new_gstin = valid_gstin("27", "AAACB1111M")
    ok = await admin.put(url, json={"gstin": new_gstin.lower(), "state_code": "24", "pincode": "411001", "address": "<b>12</b> MG Road",
                                    "bank_details": {"bank_name": "HDFC", "account_number": "5020 0012 3456 78", "ifsc_code": "hdfc0001234"}})
    assert ok.status_code == 200, ok.text
    tenant = ok.json()["tenant"]
    assert tenant["gstin"] == new_gstin and tenant["state_code"] == "27" and tenant["state_name"] == "Maharashtra"
    assert tenant["pan_number"] == "AAACB1111M" and tenant["bank_details"]["ifsc_code"] == "HDFC0001234"
    assert tenant["bank_details"]["account_number"] == "50200012345678" and "integrations" not in tenant
    # colleagues can read the company card but not its bank details
    seen = (await world.staff_a.get(f"/api/v1/tenants/{tid}")).json()
    assert seen["company_name"] == "Alpha Industries" and "bank_details" not in seen and "integrations" not in seen

    # custom fields and company masters are validated too
    fields = f"/api/v1/tenants/{tid}/custom-fields"
    made = await admin.post(fields, json={"field_key": "Machine Size!", "field_label": "Machine Size", "field_type": "text"})
    assert made.status_code == 201 and made.json()["field_key"] == "machine_size"
    assert (await admin.post(fields, json={"field_key": "machine_size", "field_label": "Again"})).status_code == 409
    assert (await admin.post(fields, json={"field_key": "x", "field_label": "X", "field_type": "script"})).status_code == 400
    assert len((await world.staff_a.get(fields)).json()) == 1
    assert (await admin.delete(f"{fields}/{made.json()['_id']}")).status_code == 200
    masters = f"/api/v1/masters/company/{tid}"
    assert (await admin.put(masters, json={"masters": {"lost_reasons": ["Price", "  ", "Competitor"]}})).json()["company_masters"]["lost_reasons"] == ["Price", "Competitor"]
    assert (await admin.put(masters, json={"masters": {"is_admin": True}})).status_code == 400
    assert (await admin.put(masters, json={"masters": {"lead_categories": "HOT"}})).status_code == 400
    states = (await world.staff_a.get("/api/v1/masters/states")).json()
    assert {"code": "24", "name": "Gujarat"} in states and len(states) >= 36


async def test_upgrade_migrates_data_written_by_the_old_insecure_version():
    await database.close_db()
    from mongomock_motor import AsyncMongoMockClient

    client = AsyncMongoMockClient()
    db = client[settings.DATABASE_NAME]
    tenant_id = (await db["tenants"].insert_one({
        "company_name": "Apex Machineries Pvt Ltd", "slug": "apex-machineries", "status": "ACTIVE", "max_users_limit": 5,
        "integrations": {"indiamart": {"is_enabled": True, "crm_key": "PLAINTEXT-IM-KEY"},
                         "website": {"is_enabled": True, "webhook_token": "wh_pub_plain", "secret_key": "whsec_plain"}},
        "communication_settings": {"email": {"is_enabled": True, "smtp_password": "plain-smtp-pass"}},
    })).inserted_id
    await db["users"].insert_many([
        {"tenant_id": "system", "full_name": "Platform Super Admin", "email": "superadmin@leadcash.com", "role": "super_admin",
         "hashed_password": "password123", "is_active": True},
        {"tenant_id": "demo_tenant_01", "full_name": "Vikram", "email": "Admin@ApexMachineries.com", "role": "company_admin",
         "hashed_password": "Vikram#Apex@2026x", "is_active": True, "is_first_login": False},
        {"tenant_id": str(tenant_id), "full_name": "Rajesh", "email": "rajesh@apexmachineries.com", "role": "staff",
         "hashed_password": "Staff@K7P2QX", "temp_password": "Staff@K7P2QX", "is_first_login": True, "is_active": True},
    ])
    await db["leads"].insert_one({"tenant_id": "demo_tenant_01", "full_name": "Old Lead", "phone": "9825000000", "source": "manual"})

    await database.init_db(client=client)
    from app.services.bootstrap import run_startup_tasks

    await run_startup_tasks()
    await run_startup_tasks()  # idempotent

    users = {u["email"]: u async for u in db["users"].find({})}
    assert set(users) == {"superadmin@leadcash.com", "admin@apexmachineries.com", "rajesh@apexmachineries.com"}
    for user in users.values():
        assert user["hashed_password"].startswith("$argon2id$") and user["must_change_password"] is True
        assert "temp_password" not in user and "is_first_login" not in user
    tid = str(tenant_id)
    assert users["admin@apexmachineries.com"]["tenant_id"] == tid and (await db["leads"].find_one({}))["tenant_id"] == tid
    tenant = await db["tenants"].find_one({"_id": tenant_id})
    blob = json.dumps(tenant, default=str)
    assert "PLAINTEXT-IM-KEY" not in blob and "wh_pub_plain" not in blob and "plain-smtp-pass" not in blob and "whsec_plain" not in blob
    assert decrypt_str(tenant["integrations"]["indiamart"]["crm_key"]) == "PLAINTEXT-IM-KEY"

    async with new_client() as c:
        # the publicly known default password is dead, even for the right account
        assert (await c.post("/api/v1/auth/login", json={"email": "superadmin@leadcash.com", "password": "password123"})).status_code == 401
        await reset_rate_limits()
        # a private password keeps working once and must then be replaced
        kept = await c.post("/api/v1/auth/login", json={"email": "admin@apexmachineries.com", "password": "Vikram#Apex@2026x"})
        assert kept.status_code == 200 and kept.json()["must_change_password"] is True
        assert (await c.get("/api/v1/leads/", headers=bearer(kept.json()["access_token"]))).status_code == 403
    await database.close_db()


async def test_upgrade_fills_in_indiamart_enquiries_the_old_version_could_not_read():
    """The earlier version stored IndiaMART's push format as 'IndiaMART Buyer' without a phone number."""
    await database.close_db()
    from mongomock_motor import AsyncMongoMockClient

    client = AsyncMongoMockClient()
    db = client[settings.DATABASE_NAME]
    tid = str((await db["tenants"].insert_one({"company_name": "Apex Machineries Pvt Ltd", "slug": "apex", "status": "ACTIVE"})).inserted_id)

    def enquiry(**fields):
        return {"CODE": 200, "STATUS": "SUCCESS", "RESPONSE": fields}

    def unread(raw_payload, **stored):
        return {"tenant_id": tid, "source": "indiamart", "source_lead_id": None, "full_name": "IndiaMART Buyer", "phone": "",
                "email": None, "city": None, "state": None, "stage": "NEW", "category": "WARM", "custom_fields": {},
                "raw_payload": raw_payload, "follow_ups": [],
                "timeline": [{"activity_type": "LEAD_CREATED", "note": "New lead captured from INDIAMART.", "performed_by_id": "SYSTEM"}],
                **stored}

    full = enquiry(UNIQUE_QUERY_ID="IM-778899", QUERY_TYPE="W", SENDER_NAME="  Kiran Shah ", SENDER_MOBILE="+91-98250 12345",
                   SENDER_EMAIL="Kiran@ShahTools.example", SENDER_COMPANY="Shah Tools", SENDER_CITY="Rajkot", SENDER_STATE="Gujarat",
                   QUERY_PRODUCT_NAME="Hydraulic Press 50T", QUERY_MESSAGE="Need price for 2 units")
    ids = (await db["leads"].insert_many([
        unread(full),                                                                          # 0: is filled in
        unread(full, phone="9000000009"),                                                      # 1: number typed in by hand
        unread(full, full_name="Mr Shah (called)"),                                            # 2: renamed by hand
        unread(enquiry(QUERY_TYPE="W")),                                                       # 3: nothing usable was sent
        unread({"RESPONSE": [{"SENDER_MOBILE": "9811111111"}, {"SENDER_MOBILE": "9822222222"}]}),   # 4: two enquiries in one
        unread(enquiry(SENDER_NAME="Asha Rao", SENDER_MOBILE="9833333333", SENDER_CITY="Pune"), city="Surat"),  # 5: stored city kept
        {"tenant_id": tid, "source": "manual", "full_name": "Ramesh Traders", "phone": "9825012345", "stage": "NEW"},  # 6: same number
        unread(enquiry(SENDER_NAME="Deleted Buyer", SENDER_MOBILE="9844444444"), is_deleted=True),  # 7: stays deleted
    ])).inserted_ids
    before = {i: await db["leads"].find_one({"_id": i}) for i in ids}

    await database.init_db(client=client)
    from app.models.lead import Lead
    from app.services.bootstrap import restore_unread_indiamart_leads, run_background_upgrades, run_startup_tasks

    await run_startup_tasks()
    assert (await db["leads"].find_one({"_id": ids[0]}))["phone"] == ""   # start-up itself is not delayed by this repair
    await run_background_upgrades()
    await run_background_upgrades()  # idempotent
    assert await restore_unread_indiamart_leads() == 0
    after = {i: await db["leads"].find_one({"_id": i}) for i in ids}

    lead = after[ids[0]]
    assert (lead["full_name"], lead["phone"], lead["email"]) == ("Kiran Shah", "9825012345", "kiran@shahtools.example")
    assert (lead["company_name"], lead["city"], lead["state"], lead["state_code"]) == ("Shah Tools", "Rajkot", "Gujarat", "24")
    assert lead["source_lead_id"] == "IM-778899" and lead["product_inquired"] == "Hydraulic Press 50T"
    assert lead["inquiry_message"] == "Need price for 2 units" and lead["custom_fields"]["indiamart_query_type"] == "W"
    assert lead["raw_payload"] == before[ids[0]]["raw_payload"]
    notes = [t for t in lead["timeline"] if t["activity_type"] == "DETAILS_RESTORED"]
    assert len(lead["timeline"]) == 2 and len(notes) == 1 and "Ramesh Traders" in notes[0]["note"]
    assert (await Lead.get(ids[0])).full_name == "Kiran Shah"   # the document is valid for the application

    for untouched in (1, 2, 3, 4, 6):
        assert after[ids[untouched]] == before[ids[untouched]], untouched
    kept = after[ids[5]]
    assert (kept["full_name"], kept["phone"], kept["city"]) == ("Asha Rao", "9833333333", "Surat")
    assert after[ids[7]]["is_deleted"] is True and after[ids[7]]["phone"] == "9844444444"

    events = await AuditLog.find({"action": "data.indiamart_leads_restored"}).to_list()
    assert len(events) == 1 and events[0].tenant_id == tid and events[0].details == {"leads": 3}

    # the same enquiry arriving again (IndiaMART retries, or the pull API) is recognised, not stored twice
    from app.services.adapters.indiamart import IndiaMARTAdapter
    from app.services.lead_service import process_and_save_lead

    again, duplicate = await process_and_save_lead(IndiaMARTAdapter().parse_payload(full["RESPONSE"], tid))
    assert duplicate is True and again.id == ids[0] and await db["leads"].count_documents({}) == len(ids)
    await database.close_db()


async def test_operator_recovers_the_platform_account_through_deployment_secrets(monkeypatch):
    await make_user("system", "super_admin", "superadmin@leadcash.com", must_change_password=True, password_changed_at=None)
    from app.services.bootstrap import ensure_bootstrap_superadmin

    monkeypatch.setattr(settings, "BOOTSTRAP_SUPERADMIN_EMAIL", "superadmin@leadcash.com")
    monkeypatch.setattr(settings, "BOOTSTRAP_SUPERADMIN_PASSWORD", "password123")
    await ensure_bootstrap_superadmin()  # a weak bootstrap password is ignored
    async with new_client() as c:
        assert (await c.post("/api/v1/auth/login", json={"email": "superadmin@leadcash.com", "password": "password123"})).status_code == 401
    monkeypatch.setattr(settings, "BOOTSTRAP_SUPERADMIN_PASSWORD", "Oper@tor-Recovery#2026")
    await ensure_bootstrap_superadmin()
    async with new_client() as c:
        ok = await c.post("/api/v1/auth/login", json={"email": "superadmin@leadcash.com", "password": "Oper@tor-Recovery#2026"})
        assert ok.status_code == 200 and ok.json()["mfa_enrollment_required"] is True
    # once the account works, the variables can no longer overwrite it or create extra administrators
    monkeypatch.setattr(settings, "BOOTSTRAP_SUPERADMIN_PASSWORD", "An0ther-Passw-rd#2026")
    monkeypatch.setattr(settings, "BOOTSTRAP_SUPERADMIN_EMAIL", "intruder@evil.example")
    await ensure_bootstrap_superadmin()
    assert await User.find({"role": "super_admin"}).count() == 1


def test_crypto_and_sanitisers():
    token = encrypt_str("s3cr3t-value")
    assert token.startswith("enc:v1:") and token != encrypt_str("s3cr3t-value"), "random IV: equal secrets do not look equal"
    assert decrypt_str(token) == "s3cr3t-value" and encrypt_str(token) == token and decrypt_str("legacy-plain") == "legacy-plain"
    assert mask_secret(token) == "••••••••alue" and mask_secret(None) == "" and decrypt_str("enc:v1:garbage") is None
    assert sanitize_flat_dict({"$set": 1, "a.b": {"x": 1}, "ok": "v", "list": [1, 2]}) == {"_set": 1, "a_b": '{"x": 1}', "ok": "v", "list": "1, 2"}
    nested = sanitize_nested({"$where": "x", "deep": {"$gt": 1, "fine": [{"$in": [1]}]}})
    assert "$" not in json.dumps(nested)
    assert neutralize("=1+1") == "'=1+1" and neutralize("@x") == "'@x" and neutralize("-5") == "'-5" and neutralize("Safe") == "Safe"
    assert neutralize(None) == "" and neutralize(42) == "42"

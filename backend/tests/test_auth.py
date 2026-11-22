"""Authentication, sessions, lockout, password policy and two-factor authentication."""
import time
from datetime import datetime, timedelta

import jwt
import pyotp
import pytest

from app.core.config import settings
from app.core.crypto import decrypt_str
from app.models.session import RefreshSession
from app.models.user import User
from tests.conftest import BROWSER, PASSWORD, bearer, login, make_tenant, make_user, new_client, reset_rate_limits, sign_in

PROTECTED = [
    ("GET", "/api/v1/leads/"),
    ("GET", "/api/v1/leads/kanban"),
    ("GET", "/api/v1/leads/export"),
    ("GET", "/api/v1/invoices/"),
    ("GET", "/api/v1/products/"),
    ("GET", "/api/v1/team/members"),
    ("GET", "/api/v1/analytics/dashboard"),
    ("GET", "/api/v1/super-admin/companies"),
    ("GET", "/api/v1/super-admin/stats"),
    ("GET", "/api/v1/masters/global"),
    ("GET", "/api/v1/audit/logs"),
    ("GET", "/api/v1/settings/communication"),
    ("GET", "/api/v1/auth/me"),
    ("POST", "/api/v1/super-admin/companies"),
    ("POST", "/api/v1/leads/"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
async def test_every_business_endpoint_requires_a_session(client, method, path):
    resp = await client.request(method, path, json={})
    assert resp.status_code == 401, f"{method} {path} answered {resp.status_code} without a token"


async def test_tenant_scoped_paths_require_a_session(client):
    tenant = await make_tenant()
    tid = str(tenant.id)
    for path in (f"/api/v1/tenants/{tid}", f"/api/v1/tenants/{tid}/integrations", f"/api/v1/tenants/{tid}/stages",
                 f"/api/v1/masters/company/{tid}", f"/api/v1/profile/{tid}"):
        assert (await client.get(path)).status_code == 401, path


async def test_removed_demo_endpoints_are_gone(client):
    assert (await client.post("/api/v1/auth/seed-initial")).status_code in (404, 405)
    assert (await client.get("/api/v1/auth/demo-accounts")).status_code in (404, 405)
    # no account is ever created implicitly by a login attempt
    await client.post("/api/v1/auth/login", json={"email": "superadmin@leadcash.com", "password": "password123"})
    assert await User.find({}).count() == 0


async def test_login_issues_bearer_token_and_httponly_refresh_cookie(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "company_admin", "admin@alpha.example")
    resp = await client.post("/api/v1/auth/login", json={"email": "ADMIN@alpha.example ", "password": PASSWORD})
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert body["user"]["email"] == "admin@alpha.example" and body["tenant"]["id"] == str(tenant.id)
    assert "hashed_password" not in str(body) and "mfa_secret" not in str(body)
    cookie = resp.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/api/v1/auth" in cookie
    me = await client.get("/api/v1/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200 and me.json()["user"]["role"] == "company_admin"


async def test_wrong_password_and_old_master_password_are_rejected(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "company_admin", "admin@alpha.example")
    for attempt in ("password123", "wrong", PASSWORD + "x"):
        resp = await client.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": attempt})
        assert resp.status_code == 401
    unknown = await client.post("/api/v1/auth/login", json={"email": "nobody@alpha.example", "password": PASSWORD})
    assert unknown.status_code == 401
    # identical message for unknown account and wrong password: no account enumeration
    assert unknown.json()["detail"] == resp.json()["detail"]


async def test_account_locks_after_repeated_failures(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "staff@alpha.example")
    for _ in range(settings.MAX_FAILED_LOGINS):
        bad = await client.post("/api/v1/auth/login", json={"email": "staff@alpha.example", "password": "nope"})
        assert bad.status_code == 401
    locked = await client.post("/api/v1/auth/login", json={"email": "staff@alpha.example", "password": PASSWORD})
    assert locked.status_code == 401, "correct password must not work while the account is locked"
    user = await User.find_one({"email": "staff@alpha.example"})
    assert user.locked_until and user.locked_until > datetime.utcnow()
    # lock expires
    user.locked_until = datetime.utcnow() - timedelta(seconds=1)
    await user.save()
    assert (await client.post("/api/v1/auth/login", json={"email": "staff@alpha.example", "password": PASSWORD})).status_code == 200


async def test_login_is_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_RATE_LIMIT_PER_IP_PER_MINUTE", 12)
    for _ in range(12):  # different accounts each time: only the per-address limit can stop this
        resp = await client.post("/api/v1/auth/login", json={"email": f"x{_}@alpha.example", "password": "nope"})
        assert resp.status_code == 401
    resp = await client.post("/api/v1/auth/login", json={"email": "y@alpha.example", "password": "nope"})
    assert resp.status_code == 429 and "retry-after" in resp.headers


async def test_login_is_rate_limited_per_account_whatever_the_address(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "staff@alpha.example")
    codes = []
    for attempt in range(settings.LOGIN_RATE_LIMIT_PER_MINUTE + 1):
        resp = await client.post("/api/v1/auth/login", json={"email": "staff@alpha.example", "password": "nope"},
                                 headers={"X-Forwarded-For": f"203.0.113.{attempt + 1}"})  # a new address every time
        codes.append(resp.status_code)
    assert codes[-1] == 429 and set(codes[:-1]) == {401}
    assert settings.LOGIN_RATE_LIMIT_PER_IP_PER_MINUTE > settings.LOGIN_RATE_LIMIT_PER_MINUTE, \
        "an office behind one address must not be throttled as if it were one account"


async def test_hidden_visitor_address_is_reported_once_in_production(client, monkeypatch, caplog):
    import logging

    from app.core import deps

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(deps, "_hidden_address_reported", False)
    with caplog.at_level(logging.WARNING, logger="app.deps"):
        for _ in range(3):  # the ingress reports its own cluster address for every visitor
            await client.post("/api/v1/auth/login", json={"email": "nobody@alpha.example", "password": "nope"},
                              headers={"X-Forwarded-For": "10.42.0.1"})
    warnings = [r for r in caplog.records if "Real visitor addresses" in r.getMessage()]
    assert len(warnings) == 1 and "10.42.0.1" in warnings[0].getMessage()

    caplog.clear()
    monkeypatch.setattr(deps, "_hidden_address_reported", False)
    with caplog.at_level(logging.WARNING, logger="app.deps"):
        await client.post("/api/v1/auth/login", json={"email": "nobody@alpha.example", "password": "nope"},
                          headers={"X-Forwarded-For": "203.0.113.7"})
    assert not [r for r in caplog.records if "Real visitor addresses" in r.getMessage()], "a public address is normal"


async def test_refresh_rotates_token_and_detects_reuse(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "company_admin", "admin@alpha.example")
    first = await login(client, "admin@alpha.example")
    old_cookie = client.cookies.get(settings.REFRESH_COOKIE_NAME)

    # CSRF defence: a cookie alone is not enough
    assert (await client.post("/api/v1/auth/refresh")).status_code == 403
    assert (await client.post("/api/v1/auth/refresh", headers={**BROWSER, "Origin": "https://evil.example"})).status_code == 403

    second = await client.post("/api/v1/auth/refresh", headers=BROWSER)
    assert second.status_code == 200
    new_token = second.json()["access_token"]
    assert client.cookies.get(settings.REFRESH_COOKIE_NAME) != old_cookie
    assert (await client.get("/api/v1/auth/me", headers=bearer(new_token))).status_code == 200

    # an attacker replays the stolen (already rotated) refresh token after the grace period
    await RefreshSession.find({"revoked_reason": "rotated"}).update({"$set": {"revoked_at": datetime.utcnow() - timedelta(minutes=5)}})
    async with new_client() as thief:
        stolen = {"Cookie": f"{settings.REFRESH_COOKIE_NAME}={old_cookie}"}
        replay = await thief.post("/api/v1/auth/refresh", headers={**BROWSER, **stolen})
        assert replay.status_code == 401 and replay.json()["detail"] == "Session revoked"
    # ... which kills the whole session family, including the legitimate user's current tokens
    assert (await client.get("/api/v1/auth/me", headers=bearer(new_token))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=bearer(first["access_token"]))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=BROWSER)).status_code == 401


async def test_logout_invalidates_the_access_token_immediately(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "company_admin", "admin@alpha.example")
    token = (await login(client, "admin@alpha.example"))["access_token"]
    assert (await client.get("/api/v1/leads/", headers=bearer(token))).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=BROWSER)).status_code == 200
    assert (await client.get("/api/v1/leads/", headers=bearer(token))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=BROWSER)).status_code == 401


async def test_forged_and_tampered_tokens_are_rejected(client):
    tenant = await make_tenant()
    user = await make_user(str(tenant.id), "staff", "staff@alpha.example")
    good = (await login(client, "staff@alpha.example"))["access_token"]
    claims = jwt.decode(good, options={"verify_signature": False})

    def forge(key, algorithm="HS256", **changes):
        return jwt.encode({**claims, **changes}, key, algorithm=algorithm)

    attacks = {
        "signed with the old public default key": forge("supersecret_jwt_key_change_in_production"),
        "role escalated": good.rsplit(".", 1)[0] + ".AAAA",
        "unsigned (alg none)": jwt.encode({**claims, "role": "super_admin"}, None, algorithm="none"),
        "wrong audience": forge(settings.SECRET_KEY, aud="someone-else"),
        "expired": forge(settings.SECRET_KEY, exp=int(time.time()) - 10),
        "mfa-pending token used as access token": forge(settings.SECRET_KEY, type="mfa_pending"),
        "role claim changed": forge(settings.SECRET_KEY, role="company_admin"),
        "tenant claim changed": forge(settings.SECRET_KEY, tid="000000000000000000000000"),
        "unknown session family": forge(settings.SECRET_KEY, sid="deadbeef"),
    }
    for name, token in attacks.items():
        resp = await client.get("/api/v1/leads/", headers=bearer(token))
        assert resp.status_code == 401, name

    # deactivating the user ends the session at once
    user.is_active = False
    await user.save()
    assert (await client.get("/api/v1/leads/", headers=bearer(good))).status_code == 401


async def test_first_login_forces_a_password_change_with_policy(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "new@alpha.example", must_change_password=True,
                    temp_password_expires_at=datetime.utcnow() + timedelta(days=1), full_name="Naveen Kumar")
    data = await login(client, "new@alpha.example")
    assert data["must_change_password"] is True and data["user"]["is_first_login"] is True
    headers = bearer(data["access_token"])
    blocked = await client.get("/api/v1/leads/", headers=headers)
    assert blocked.status_code == 403 and "Password change required" in blocked.json()["detail"]

    async def change(new, current=PASSWORD):
        return await client.post("/api/v1/profile/change-password", headers=headers,
                                 json={"current_password": current, "new_password": new, "confirm_password": new})

    assert (await change("Short1!")).status_code == 400  # policy
    assert (await change("Fresh!Passw-rd#77", current="wrong")).status_code == 400
    assert (await change(PASSWORD)).status_code == 400  # same as current
    ok = await change("Fresh!Passw-rd#77")
    assert ok.status_code == 200 and ok.json()["is_first_login"] is False
    # the old token died with the password change; the response carries the new session
    assert (await client.get("/api/v1/leads/", headers=headers)).status_code == 401
    assert (await client.get("/api/v1/leads/", headers=bearer(ok.json()["access_token"]))).status_code == 200
    async with new_client() as other:
        assert (await other.post("/api/v1/auth/login", json={"email": "new@alpha.example", "password": PASSWORD})).status_code == 401
        assert (await other.post("/api/v1/auth/login", json={"email": "new@alpha.example", "password": "Fresh!Passw-rd#77"})).status_code == 200


async def test_expired_temporary_password_is_rejected(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "late@alpha.example", must_change_password=True,
                    temp_password_expires_at=datetime.utcnow() - timedelta(minutes=1))
    resp = await client.post("/api/v1/auth/login", json={"email": "late@alpha.example", "password": PASSWORD})
    assert resp.status_code == 403 and "expired" in resp.json()["detail"]


async def test_two_factor_enrolment_login_replay_and_recovery_codes(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "company_admin", "admin@alpha.example")
    first = await login(client, "admin@alpha.example")
    headers = bearer(first["access_token"])

    setup = await client.post("/api/v1/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200 and setup.json()["qr_code"].startswith("data:image/svg+xml;base64,")
    secret = setup.json()["secret"]
    stored = await User.find_one({"email": "admin@alpha.example"})
    assert stored.mfa_pending_secret.startswith("enc:v1:") and decrypt_str(stored.mfa_pending_secret) == secret

    assert (await client.post("/api/v1/auth/mfa/enable", headers=headers, json={"code": "000000"})).status_code == 400
    enabled = await client.post("/api/v1/auth/mfa/enable", headers=headers, json={"code": pyotp.TOTP(secret).now()})
    assert enabled.status_code == 200
    recovery = enabled.json()["recovery_codes"]
    assert len(recovery) == 8
    assert (await client.get("/api/v1/leads/", headers=headers)).status_code == 401  # pre-2FA token is dead

    async with new_client() as browser:
        step1 = await browser.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": PASSWORD})
        assert step1.json() == {"mfa_required": True, "mfa_token": step1.json()["mfa_token"]}
        pending = step1.json()["mfa_token"]
        assert (await browser.get("/api/v1/leads/", headers=bearer(pending))).status_code == 401
        assert (await browser.post("/api/v1/auth/mfa/verify", json={"mfa_token": pending, "code": "123456"})).status_code == 401

        user = await User.find_one({"email": "admin@alpha.example"})
        future = pyotp.TOTP(secret).at(int(time.time()) + 30)  # next time-step (the enrolment code is already used)
        done = await browser.post("/api/v1/auth/mfa/verify", json={"mfa_token": pending, "code": future})
        assert done.status_code == 200
        assert (await browser.get("/api/v1/leads/", headers=bearer(done.json()["access_token"]))).status_code == 200
        # the same one-time code cannot be replayed
        again = await browser.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": PASSWORD})
        replay = await browser.post("/api/v1/auth/mfa/verify", json={"mfa_token": again.json()["mfa_token"], "code": future})
        assert replay.status_code == 401
        assert user.mfa_last_used_step is not None

    await reset_rate_limits()
    async with new_client() as phone_lost:
        step1 = await phone_lost.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": PASSWORD})
        ok = await phone_lost.post("/api/v1/auth/mfa/verify", json={"mfa_token": step1.json()["mfa_token"], "code": recovery[0]})
        assert ok.status_code == 200
        step1 = await phone_lost.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": PASSWORD})
        reused = await phone_lost.post("/api/v1/auth/mfa/verify", json={"mfa_token": step1.json()["mfa_token"], "code": recovery[0]})
        assert reused.status_code == 401, "a recovery code works only once"


async def test_platform_administrator_must_enrol_two_factor_first(client):
    await make_user("system", "super_admin", "root@platform.example")
    data = await login(client, "root@platform.example")
    assert data["mfa_enrollment_required"] is True
    resp = await client.get("/api/v1/super-admin/companies", headers=bearer(data["access_token"]))
    assert resp.status_code == 403 and "Two-factor" in resp.json()["detail"]
    # enrolment itself is allowed
    assert (await client.post("/api/v1/auth/mfa/setup", headers=bearer(data["access_token"]))).status_code == 200


async def test_suspended_company_cannot_sign_in_or_use_existing_sessions(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "company_admin", "admin@alpha.example")
    session = await sign_in("admin@alpha.example")
    tenant.status = "SUSPENDED"
    await tenant.save()
    from app.core.deps import invalidate_tenant_cache

    invalidate_tenant_cache(str(tenant.id))
    assert (await session.get("/api/v1/leads/")).status_code == 403
    resp = await client.post("/api/v1/auth/login", json={"email": "admin@alpha.example", "password": PASSWORD})
    assert resp.status_code == 403
    await session.close()


async def test_session_list_and_remote_sign_out(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "staff@alpha.example")
    laptop = await sign_in("staff@alpha.example")
    phone = await sign_in("staff@alpha.example")
    sessions = (await laptop.get("/api/v1/auth/sessions")).json()
    assert len(sessions) == 2 and sum(1 for s in sessions if s["current"]) == 1
    other = next(s for s in sessions if not s["current"])
    assert (await laptop.delete(f"/api/v1/auth/sessions/{other['id']}")).status_code == 200
    assert (await phone.get("/api/v1/leads/")).status_code == 401
    assert (await laptop.get("/api/v1/leads/")).status_code == 200
    await laptop.close()
    await phone.close()


async def test_forgot_password_never_reveals_whether_an_account_exists(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "staff@alpha.example")
    known = await client.post("/api/v1/auth/forgot-password", json={"email": "staff@alpha.example"})
    unknown = await client.post("/api/v1/auth/forgot-password", json={"email": "ghost@alpha.example"})
    assert known.status_code == unknown.status_code == 200 and known.json() == unknown.json()
    bad = await client.post("/api/v1/auth/reset-password", json={"token": "x" * 40, "new_password": "Fresh!Passw-rd#77"})
    assert bad.status_code == 400


def test_password_policy_rules():
    from app.core.security import password_policy_errors

    assert password_policy_errors("Fresh!Passw-rd#77") == []
    assert password_policy_errors("Sh0rt!") != []  # too short
    assert password_policy_errors("password1234") != []  # common / contains 'password'
    assert password_policy_errors("alllowercaseletters") != []  # a single character class
    assert password_policy_errors("Naveen-2026-secure", full_name="Naveen Kumar") != []  # contains the name
    assert password_policy_errors("rajesh.s-Secure#1", email="rajesh.s@alpha.example") != []  # contains the e-mail name
    assert password_policy_errors("x" * 129) != []


async def test_change_password_is_rate_limited(client):
    tenant = await make_tenant()
    await make_user(str(tenant.id), "staff", "staff@alpha.example")
    headers = bearer((await login(client, "staff@alpha.example"))["access_token"])
    codes = []
    for _ in range(7):
        resp = await client.post("/api/v1/auth/change-password", headers=headers,
                                 json={"current_password": "guess", "new_password": "Fresh!Passw-rd#77"})
        codes.append(resp.status_code)
    assert codes[:5] == [400] * 5 and codes[-1] == 429

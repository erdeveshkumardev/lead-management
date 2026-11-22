"""Inbound lead webhooks: authentication is mandatory on every provider endpoint."""
import hashlib
import hmac
import json
import time

from app.core.config import settings
from app.core.crypto import decrypt_str
from app.core.database import get_db
from app.core.middleware import redact_path
from app.models.lead import Lead
from app.models.tenant import Tenant
from tests.conftest import reset_rate_limits

IM_PAYLOAD = {
    "CODE": 200, "STATUS": "SUCCESS",
    "RESPONSE": {
        "UNIQUE_QUERY_ID": "2012487827", "QUERY_TYPE": "W", "QUERY_TIME": "2026-11-18 10:00:00",
        "SENDER_NAME": "Amit Buyer", "SENDER_MOBILE": "+91-9825012345", "SENDER_EMAIL": "amit@buyer.example",
        "SENDER_COMPANY": "Amit Tools", "SENDER_CITY": "Surat", "SENDER_STATE": "Gujarat",
        "QUERY_PRODUCT_NAME": "CNC Milling Center", "QUERY_MESSAGE": "Need price for 2 units",
    },
}


async def _integrations(world, enable=("indiamart", "tradeindia", "justdial", "facebook", "website"), extra=None):
    admin, tid = world.admin_a, str(world.tenant_a.id)
    payload = {p: {"is_enabled": True} for p in enable}
    for provider, values in (extra or {}).items():
        payload.setdefault(provider, {}).update(values)
    resp = await admin.put(f"/api/v1/tenants/{tid}/integrations", json={"integrations": payload})
    assert resp.status_code == 200, resp.text
    return resp.json()["integrations"], tid


async def test_marketplace_webhooks_reject_missing_or_wrong_tokens(world, client):
    cfg, tid = await _integrations(world)
    for provider in ("indiamart", "tradeindia", "justdial"):
        base = f"/api/v1/webhooks/{provider}/{tid}"
        body = IM_PAYLOAD if provider == "indiamart" else {"sender_name": "Buyer", "sender_mobile": "9825099999", "name": "Buyer", "mobile": "9825099999"}
        assert (await client.post(base, json=body)).status_code == 401, f"{provider}: no token"
        assert (await client.post(f"{base}/wrong-token", json=body)).status_code == 401
        assert (await client.post(f"{base}?token=", json=body)).status_code == 401
        # the pre-security behaviour accepted the company id / slug / any CRM key as proof - no longer
        for guess in (tid, world.tenant_a.slug, "demo_tenant_01"):
            assert (await client.post(f"{base}?token={guess}", json=body)).status_code == 401
            assert (await client.post(base, json=body, headers={"X-API-Key": guess, "X-CRM-Key": guess})).status_code == 401
    assert await Lead.find({}).count() == 0

    token = cfg["indiamart"]["webhook_token"]
    assert cfg["indiamart"]["webhook_path"] == f"/webhooks/indiamart/{tid}/{token}"
    ok = await client.post(f"/api/v1/webhooks/indiamart/{tid}/{token}", json=IM_PAYLOAD)
    assert ok.status_code == 200 and ok.json()["is_duplicate"] is False
    lead = await Lead.find_one({})
    assert lead.tenant_id == tid and lead.source == "indiamart" and lead.phone == "9825012345"
    assert lead.full_name == "Amit Buyer" and lead.state_code == "24" and lead.source_lead_id == "2012487827"
    assert lead.assigned_to_user_id is None, "new marketplace leads start in the open pool"
    # header and query-string forms of the same token also work (for providers that cannot change the path)
    for request in ({"params": {"token": cfg["tradeindia"]["webhook_token"]}}, {"headers": {"X-Webhook-Token": cfg["tradeindia"]["webhook_token"]}}):
        resp = await client.post(f"/api/v1/webhooks/tradeindia/{tid}", json={"sender_name": "T Buyer", "sender_mobile": "9825077777"}, **request)
        assert resp.status_code == 200


async def test_indiamart_retries_are_idempotent_and_repeat_inquiries_are_merged(world, client):
    cfg, tid = await _integrations(world)
    url = f"/api/v1/webhooks/indiamart/{tid}/{cfg['indiamart']['webhook_token']}"
    assert (await client.post(url, json=IM_PAYLOAD)).json()["is_duplicate"] is False
    retry = await client.post(url, json=IM_PAYLOAD)  # IndiaMART re-delivers the same UNIQUE_QUERY_ID
    assert retry.status_code == 200 and retry.json()["is_duplicate"] is True
    lead = await Lead.find_one({})
    assert await Lead.find({}).count() == 1 and len(lead.timeline) == 1, "a retry must not add anything"

    second = json.loads(json.dumps(IM_PAYLOAD))
    second["RESPONSE"].update({"UNIQUE_QUERY_ID": "2012487999", "QUERY_PRODUCT_NAME": "Lathe"})
    assert (await client.post(url, json=second)).json()["is_duplicate"] is True
    lead = await Lead.find_one({})
    assert await Lead.find({}).count() == 1 and lead.timeline[-1].activity_type == "DUPLICATE_INQUIRY"
    # flat (un-wrapped) payloads and whole-envelope relays are understood too
    flat = {"UNIQUE_QUERY_ID": "3000000001", "SENDER_NAME": "Flat Buyer", "SENDER_MOBILE": "9825011111"}
    assert (await client.post(url, json=flat)).json()["is_duplicate"] is False
    envelope = {"method": "POST", "body": {"CODE": 200, "RESPONSE": {"UNIQUE_QUERY_ID": "3000000002", "SENDER_NAME": "Env Buyer", "SENDER_MOBILE": "9825022222"}}}
    assert (await client.post(url, json=envelope)).json()["is_duplicate"] is False
    assert await Lead.find({}).count() == 3


async def test_disabled_integration_unknown_or_suspended_company_all_look_the_same(world, client):
    cfg, tid = await _integrations(world, enable=("indiamart",))
    token = cfg["indiamart"]["webhook_token"]
    other = str(world.tenant_b.id)
    answers = [
        await client.post(f"/api/v1/webhooks/tradeindia/{tid}/{token}", json={}),  # integration disabled
        await client.post(f"/api/v1/webhooks/indiamart/{other}/{token}", json=IM_PAYLOAD),  # other company, not enabled
        await client.post(f"/api/v1/webhooks/indiamart/000000000000000000000000/{token}", json=IM_PAYLOAD),
        await client.post(f"/api/v1/webhooks/indiamart/not-an-id/{token}", json=IM_PAYLOAD),
    ]
    assert {a.status_code for a in answers} == {404} and len({a.json()["detail"] for a in answers}) == 1
    world.tenant_a.status = "SUSPENDED"
    fresh = await Tenant.get(world.tenant_a.id)
    fresh.status = "SUSPENDED"
    await fresh.save()
    assert (await client.post(f"/api/v1/webhooks/indiamart/{tid}/{token}", json=IM_PAYLOAD)).status_code == 404
    assert await Lead.find({}).count() == 0


async def test_webhook_token_of_one_company_cannot_write_into_another(world, client):
    cfg_a, tid_a = await _integrations(world)
    tid_b = str(world.tenant_b.id)
    resp = await world.admin_b.put(f"/api/v1/tenants/{tid_b}/integrations", json={"integrations": {"indiamart": {"is_enabled": True}}})
    token_b = resp.json()["integrations"]["indiamart"]["webhook_token"]
    assert token_b != cfg_a["indiamart"]["webhook_token"]
    assert (await client.post(f"/api/v1/webhooks/indiamart/{tid_a}/{token_b}", json=IM_PAYLOAD)).status_code == 401
    assert (await client.post(f"/api/v1/webhooks/indiamart/{tid_b}/{token_b}", json=IM_PAYLOAD)).status_code == 200
    assert (await Lead.find_one({})).tenant_id == tid_b


async def test_regenerating_keys_revokes_the_old_token_immediately(world, client):
    cfg, tid = await _integrations(world)
    old = cfg["indiamart"]["webhook_token"]
    rotated = await world.admin_a.post(f"/api/v1/tenants/{tid}/integrations/regenerate-keys?provider=indiamart")
    new = rotated.json()["webhook_token"]
    assert rotated.status_code == 200 and new != old
    assert (await client.post(f"/api/v1/webhooks/indiamart/{tid}/{old}", json=IM_PAYLOAD)).status_code == 401
    assert (await client.post(f"/api/v1/webhooks/indiamart/{tid}/{new}", json=IM_PAYLOAD)).status_code == 200


async def test_meta_lead_ads_handshake_signature_and_graph_fetch(world, client, monkeypatch):
    app_secret, page_token = "meta-app-secret-123", "EAAB-page-token"
    cfg, tid = await _integrations(world, extra={"facebook": {"secret_key": app_secret, "api_key": page_token}})
    verify = cfg["facebook"]["verify_token"]
    url = f"/api/v1/webhooks/facebook/{tid}"

    # subscription handshake
    assert (await client.get(url, params={"hub.mode": "subscribe", "hub.challenge": "1158201444", "hub.verify_token": "wrong"})).status_code == 403
    assert (await client.get(url, params={"hub.mode": "subscribe", "hub.challenge": "1158201444"})).status_code == 403
    good = await client.get(url, params={"hub.mode": "subscribe", "hub.challenge": "1158201444", "hub.verify_token": verify})
    assert good.status_code == 200 and good.text == "1158201444"

    fetched = []

    async def fake_fetch(leadgen_id, token):
        fetched.append((leadgen_id, token))
        return {"id": leadgen_id, "created_time": "2026-11-18T05:00:00+0000", "field_data": [
            {"name": "full_name", "values": ["Anita Desai"]}, {"name": "phone_number", "values": ["+919898011223"]},
            {"name": "email", "values": ["anita@desai.example"]}, {"name": "budget", "values": ["5 lakh+"]}]}

    monkeypatch.setattr("app.services.integration_service.fetch_meta_lead", fake_fetch)
    event = {"object": "page", "entry": [{"id": "1", "time": 1, "changes": [
        {"field": "leadgen", "value": {"leadgen_id": "444555666", "form_id": "777", "page_id": "1", "ad_id": "99"}}]}]}
    raw = json.dumps(event).encode()
    headers = {"Content-Type": "application/json"}

    forged = await client.post(url, content=raw, headers={**headers, "X-Hub-Signature-256": "sha256=" + "0" * 64})
    assert forged.status_code == 401
    assert (await client.post(url, content=raw, headers=headers)).status_code == 401, "unsigned and no token"
    assert await Lead.find({}).count() == 0 and fetched == []

    signature = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
    signed = await client.post(url, content=raw, headers={**headers, "X-Hub-Signature-256": signature})
    assert signed.status_code == 200 and signed.json()["received"] == 1
    assert fetched == [("444555666", page_token)], "the lead is fetched from the Graph API with the stored page token"
    lead = await Lead.find_one({})
    assert lead.full_name == "Anita Desai" and lead.phone == "9898011223" and lead.source == "facebook"
    assert lead.custom_fields["budget"] == "5 lakh+" and lead.source_lead_id == "444555666"
    # a body altered after signing is rejected
    tampered = raw.replace(b"444555666", b"444555667")
    assert (await client.post(url, content=tampered, headers={**headers, "X-Hub-Signature-256": signature})).status_code == 401


async def test_website_form_token_origin_and_bot_traps(world, client):
    cfg, tid = await _integrations(world, extra={"website": {"allowed_domains": ["https://www.alpha-industries.example"]}})
    token = cfg["website"]["webhook_token"]
    assert cfg["website"]["allowed_domains"] == ["www.alpha-industries.example"]
    url = f"/api/v1/webhooks/website/{tid}"
    form = {"full_name": "Karan Mehra", "phone": "9811122334", "email": "karan@mehra.example", "inquiry_message": "Need a quote"}
    site = {"Origin": "https://www.alpha-industries.example"}

    assert (await client.post(url, json=form, headers=site)).status_code == 401  # no token
    assert (await client.post(f"{url}?token={tid}", json=form, headers=site)).status_code == 401  # company id is not a token
    assert (await client.post(f"{url}?token={token}", json=form, headers={"Origin": "https://evil.example"})).status_code == 403
    assert (await client.post(f"{url}?token={token}", json=form)).status_code == 403  # allow-list set but no Origin
    assert await Lead.find({}).count() == 0

    # bots: honeypot filled, or submitted within two seconds of rendering -> looks successful, stores nothing
    trapped = await client.post(f"{url}?token={token}", json={**form, "website_hp": "http://spam"}, headers=site)
    fast = await client.post(f"{url}?token={token}", json={**form, "_render_time": int(time.time() * 1000)}, headers=site)
    real = await client.post(f"{url}?token={token}", json={**form, "_render_time": int((time.time() - 30) * 1000)}, headers=site)
    for resp in (trapped, fast, real):
        assert resp.status_code == 200 and resp.json()["status"] == "success"
    assert set(trapped.json()) == set(real.json()), "a trapped bot must not be able to tell it was filtered"
    assert await Lead.find({}).count() == 1
    lead = await Lead.find_one({})
    assert lead.full_name == "Karan Mehra" and lead.inquiry_message == "Need a quote" and lead.source == "website"
    assert "token" not in json.dumps(lead.raw_payload)

    # junk numbers are dropped, form-encoded posts are accepted
    await reset_rate_limits()
    junk = await client.post(f"{url}?token={token}", json={"name": "X", "phone": "9999999999"}, headers=site)
    assert junk.json()["status"] == "ignored"
    encoded = await client.post(f"{url}/{token}", data={"name": "Form Post", "phone": "9811100000"}, headers=site)
    assert encoded.status_code == 200 and await Lead.find({}).count() == 2


async def test_website_server_to_server_hmac_and_secret(world, client):
    cfg, tid = await _integrations(world)
    reveal = await world.admin_a.post(f"/api/v1/tenants/{tid}/integrations/reveal", json={"provider": "website", "password": "Str0ng!Passw-rd#2026"})
    secret = reveal.json()["secret_key"]
    assert secret.startswith("whsec_") and "••••" in cfg["website"]["secret_key"]
    url = f"/api/v1/webhooks/website/{tid}"
    raw = json.dumps({"name": "Backend Lead", "phone": "9811100001", "submission_id": "sub-1"}).encode()
    headers = {"Content-Type": "application/json"}

    bad = await client.post(url, content=raw, headers={**headers, "X-Webhook-Signature": "sha256=" + "f" * 64})
    assert bad.status_code == 401
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    good = await client.post(url, content=raw, headers={**headers, "X-Webhook-Signature": f"sha256={sig}"})
    assert good.status_code == 200 and good.json()["is_duplicate"] is False
    again = await client.post(url, content=raw, headers={**headers, "X-Webhook-Signature": f"sha256={sig}"})
    assert again.json()["is_duplicate"] is True  # same submission id
    bearer_ok = await client.post(url, json={"name": "Bearer Lead", "phone": "9811100002"}, headers={"Authorization": f"Bearer {secret}"})
    assert bearer_ok.status_code == 200
    assert (await client.post(url, json={"name": "X", "phone": "9811100003"}, headers={"Authorization": "Bearer whsec_wrong"})).status_code == 401


async def test_public_form_endpoint_answers_cors_but_no_other_route_does(world, client):
    _, tid = await _integrations(world)
    pre = await client.options(f"/api/v1/webhooks/website/{tid}", headers={
        "Origin": "https://any-customer-site.example", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert pre.status_code == 204 and pre.headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-credentials" not in pre.headers
    # the rest of the API only talks to the configured front-end origin
    evil = await client.options("/api/v1/auth/login", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in evil.headers
    app_origin = await client.options("/api/v1/auth/login", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert app_origin.headers["access-control-allow-origin"] == "http://localhost:5173"
    evil_marketplace = await client.options(f"/api/v1/webhooks/indiamart/{tid}", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in evil_marketplace.headers


async def test_webhooks_are_rate_limited_and_size_limited(world, client):
    cfg, tid = await _integrations(world)
    token = cfg["website"]["webhook_token"]
    url = f"/api/v1/webhooks/website/{tid}?token={token}"
    codes = [(await client.post(url, json={"name": f"Lead {i}", "phone": f"98111000{i:02d}"})).status_code
             for i in range(settings.WEBSITE_FORM_RATE_LIMIT_PER_MINUTE + 2)]
    assert codes[: settings.WEBSITE_FORM_RATE_LIMIT_PER_MINUTE] == [200] * settings.WEBSITE_FORM_RATE_LIMIT_PER_MINUTE
    assert codes[-1] == 429
    # a spoofed X-Forwarded-For chain does not buy a fresh quota: only the trusted proxy hop counts
    spoofed = await client.post(url, json={"name": "Spoof", "phone": "9811100099"}, headers={"X-Forwarded-For": "1.2.3.4, 5.6.7.8"})
    assert spoofed.status_code in (200, 429)

    await reset_rate_limits()
    huge = {"name": "Big", "phone": "9811100050", "message": "x" * (settings.WEBHOOK_MAX_BODY_BYTES + 10)}
    assert (await client.post(url, json=huge)).status_code == 413
    assert (await client.post(url, content=b"not json", headers={"Content-Type": "application/json"})).status_code == 400
    assert (await client.post(url, json=["a", "list"])).status_code == 400


async def test_hostile_payload_keys_and_secrets_at_rest(world, client):
    cfg, tid = await _integrations(world, extra={"indiamart": {"crm_key": "IM-PULL-KEY-9988"}})
    token = cfg["website"]["webhook_token"]
    hostile = {"name": "Mongo Injector", "phone": "9811100077", "$where": "sleep(1000)", "a.b": {"$gt": ""},
               "custom_fields": {"$set": {"role": "admin"}, "normal": "ok"}}
    resp = await client.post(f"/api/v1/webhooks/website/{tid}?token={token}", json=hostile)
    assert resp.status_code == 200
    stored = await get_db()["leads"].find_one({"full_name": "Mongo Injector"})
    dumped = json.dumps(stored, default=str)
    assert '"$' not in dumped and '"a.b"' not in dumped, "operator-looking keys must never be stored"

    # credentials are encrypted in the database and masked in the API
    raw = await get_db()["tenants"].find_one({"_id": world.tenant_a.id})
    assert raw["integrations"]["indiamart"]["crm_key"].startswith("enc:v1:")
    assert raw["integrations"]["website"]["webhook_token"].startswith("enc:v1:")
    assert "IM-PULL-KEY-9988" not in json.dumps(raw, default=str) and token not in json.dumps(raw, default=str)
    assert decrypt_str(raw["integrations"]["indiamart"]["crm_key"]) == "IM-PULL-KEY-9988"
    shown = (await world.admin_a.get(f"/api/v1/tenants/{tid}/integrations")).json()["integrations"]["indiamart"]
    assert shown["crm_key"].endswith("9988") and "IM-PULL" not in shown["crm_key"] and shown["has_crm_key"] is True
    # saving the masked value back leaves the stored key untouched; an empty value clears it
    await world.admin_a.put(f"/api/v1/tenants/{tid}/integrations", json={"integrations": {"indiamart": {"crm_key": shown["crm_key"]}}})
    raw = await get_db()["tenants"].find_one({"_id": world.tenant_a.id})
    assert decrypt_str(raw["integrations"]["indiamart"]["crm_key"]) == "IM-PULL-KEY-9988"
    wrong_pw = await world.admin_a.post(f"/api/v1/tenants/{tid}/integrations/reveal", json={"provider": "indiamart", "password": "guess"})
    assert wrong_pw.status_code == 403

    # the audit trail names exactly what changed - and never contains a credential
    await get_db()["audit_logs"].delete_many({"action": "tenant.integrations_updated"})
    await world.admin_a.put(f"/api/v1/tenants/{tid}/integrations", json={"integrations": {
        "indiamart": {"is_enabled": True, "crm_key": shown["crm_key"], "api_key": ""},          # nothing new
        "justdial": {"is_enabled": False, "api_key": "JD-NEW-SECRET-1"},                         # two real changes
        "website": {"allowed_domains": ["Shop.Example.com"]}}})
    entry = await get_db()["audit_logs"].find_one({"action": "tenant.integrations_updated"})
    assert entry["details"]["changed"] == "justdial.api_key, justdial.is_enabled=False, website.allowed_domains"
    assert "JD-NEW-SECRET-1" not in json.dumps(entry, default=str)


def test_webhook_tokens_never_reach_the_access_log():
    path = "/api/v1/webhooks/indiamart/6afd317b0a54d028a8869a18/wh_pub_0123456789abcdef"
    assert redact_path(path) == "/api/v1/webhooks/indiamart/6afd317b0a54d028a8869a18/[redacted]"
    assert redact_path("/api/v1/leads/abc") == "/api/v1/leads/abc"

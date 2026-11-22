"""
Idempotent start-up tasks (safe to run on every boot and on several replicas):

  * indexes: TTL for sessions / rate limits / audit logs, unique document numbers per company
  * one-time security migration of data written by older versions
      - plaintext passwords      -> Argon2id hashes; every migrated account must set a new password,
                                    publicly known default passwords are disabled outright
      - readable 'temp_password' -> removed from the database
      - plaintext gateway / integration credentials -> encrypted
      - demo tenant aliases ("demo_tenant_01", slugs) -> real company ids
      - IndiaMART enquiries the earlier version could not read -> buyer details filled in from the stored original
        (after start-up, in the background: see run_background_upgrades)
  * first platform administrator from BOOTSTRAP_SUPERADMIN_* (only when configured)
"""
import asyncio
import logging
import secrets
from datetime import datetime
from typing import Any, Dict

from pymongo import ASCENDING, DESCENDING

from app.core.audit import audit
from app.core.config import settings
from app.core.crypto import encrypt_str, is_encrypted
from app.core.database import get_db
from app.core.security import COMMON_PASSWORDS, hash_password, password_policy_errors, temp_password_expiry
from app.models.tenant import COMMUNICATION_SECRET_FIELDS, Tenant
from app.models.user import User, get_default_permissions_for_role

logger = logging.getLogger("app.bootstrap")

INTEGRATION_SECRET_FIELDS = ("api_key", "crm_key", "secret_key", "webhook_token", "verify_token")
INTEGRATION_PROVIDERS = ("indiamart", "facebook", "tradeindia", "justdial", "website")


async def ensure_indexes() -> None:
    db = get_db()
    specs = [
        ("refresh_sessions", [("expires_at", ASCENDING)], {"expireAfterSeconds": 0, "name": "session_ttl"}),
        ("rate_limits", [("expires_at", ASCENDING)], {"expireAfterSeconds": 0, "name": "rate_limit_ttl"}),
        ("audit_logs", [("created_at", ASCENDING)],
         {"expireAfterSeconds": settings.AUDIT_RETENTION_DAYS * 86400, "name": "audit_ttl"}),
        ("invoices", [("tenant_id", ASCENDING), ("idempotency_key", ASCENDING)], {"name": "tenant_idempotency", "sparse": True}),
        ("leads", [("tenant_id", ASCENDING), ("is_deleted", ASCENDING), ("created_at", DESCENDING)],
         {"name": "tenant_active_created"}),
    ]
    for collection, keys, options in specs:
        try:
            await db[collection].create_index(keys, **options)
        except Exception as exc:  # e.g. changed options on an existing index: report, never block start-up
            logger.warning("Index %s on %s was not created: %s", options.get("name"), collection, type(exc).__name__)
    await _ensure_unique_document_numbers(db)


async def _ensure_unique_document_numbers(db) -> None:
    """A document number may exist only once per company. Older versions created this index non-unique."""
    invoices = db["invoices"]
    keys = [("tenant_id", ASCENDING), ("invoice_number", ASCENDING)]
    try:
        existing = await invoices.index_information()
        for name, spec in existing.items():
            if [tuple(k) for k in spec.get("key", [])] == keys and not spec.get("unique"):
                await invoices.drop_index(name)
        await invoices.create_index(keys, unique=True, name="uniq_tenant_invoice_number")
    except Exception as exc:
        logger.error("Unique document-number index could not be created (%s). Check for duplicate numbers.", type(exc).__name__)


async def migrate_legacy_users() -> int:
    """Brings accounts created by pre-security versions up to the current model."""
    collection = User.get_motor_collection()

    # 1. e-mail addresses are compared in lower case
    async for doc in collection.find({"email": {"$regex": "[A-Z]"}}, {"email": 1}):
        lowered = str(doc["email"]).strip().lower()
        if not await collection.find_one({"email": lowered, "_id": {"$ne": doc["_id"]}}):
            await collection.update_one({"_id": doc["_id"]}, {"$set": {"email": lowered}})

    # 2. passwords that were stored in readable form
    migrated = 0
    async for doc in collection.find({"hashed_password": {"$not": {"$regex": r"^\$argon2"}}}):
        plain = doc.get("hashed_password") or ""
        known_default = (not plain) or plain.lower() in COMMON_PASSWORDS or "password" in plain.lower()
        disable = known_default or settings.LEGACY_PASSWORD_MIGRATION == "disable"
        update = {
            "hashed_password": hash_password(secrets.token_urlsafe(32) if disable else plain),
            "must_change_password": True,
            "temp_password_expires_at": temp_password_expiry(),
            "token_version": int(doc.get("token_version") or 0) + 1,
            "updated_at": datetime.utcnow(),
        }
        result = await collection.update_one({"_id": doc["_id"], "hashed_password": plain}, {"$set": update})
        if result.modified_count:
            migrated += 1
            await audit("security.password_migrated", tenant_id=doc.get("tenant_id") if doc.get("tenant_id") != "system" else None,
                        entity_type="user", entity_id=str(doc["_id"]),
                        details={"outcome": "disabled_reset_required" if disable else "hashed_change_required",
                                 "meets_policy": not password_policy_errors(plain, doc.get("email"))})
    if migrated:
        logger.warning("%s accounts had readable passwords: they were hashed and must set a new password "
                       "(known default passwords were disabled and need an administrator reset).", migrated)

    # 3. remove fields that must never be stored
    await collection.update_many({"temp_password": {"$exists": True}}, {"$unset": {"temp_password": ""}})
    await collection.update_many({"is_first_login": True, "must_change_password": {"$ne": True}},
                                 {"$set": {"must_change_password": True}})
    await collection.update_many({"is_first_login": {"$exists": True}}, {"$unset": {"is_first_login": ""}})
    return migrated


async def encrypt_stored_credentials() -> int:
    collection = Tenant.get_motor_collection()
    changed = 0
    async for doc in collection.find({}, {"integrations": 1, "communication_settings": 1}):
        update = {}
        for provider in INTEGRATION_PROVIDERS:
            cfg = (doc.get("integrations") or {}).get(provider) or {}
            for field in INTEGRATION_SECRET_FIELDS:
                value = cfg.get(field)
                if isinstance(value, str) and value and not is_encrypted(value):
                    update[f"integrations.{provider}.{field}"] = encrypt_str(value)
        for channel, fields in COMMUNICATION_SECRET_FIELDS.items():
            cfg = (doc.get("communication_settings") or {}).get(channel) or {}
            for field in fields:
                value = cfg.get(field)
                if isinstance(value, str) and value and not is_encrypted(value):
                    update[f"communication_settings.{channel}.{field}"] = encrypt_str(value)
        if update:
            await collection.update_one({"_id": doc["_id"]}, {"$set": update})
            changed += 1
    if changed:
        logger.warning("Encrypted previously readable credentials of %s companies.", changed)
    return changed


async def repair_legacy_tenant_refs() -> None:
    """Older builds stored records under 'demo_tenant_01' or a slug instead of the company's id."""
    db = get_db()
    aliases = {}
    for tenant in await Tenant.find({}).to_list():
        tid = str(tenant.id)
        if tenant.slug and tenant.slug != tid:
            aliases[tenant.slug] = tid
        if tenant.slug == "apex-machineries":
            aliases["demo_tenant_01"] = tid
    for alias, tid in aliases.items():
        for collection in ("leads", "invoices", "products", "users", "custom_field_definitions"):
            result = await db[collection].update_many({"tenant_id": alias}, {"$set": {"tenant_id": tid}})
            if result.modified_count:
                logger.warning("Re-linked %s %s records from alias '%s' to company %s",
                               result.modified_count, collection, alias, tid)


INDIAMART_PLACEHOLDER_NAME = "IndiaMART Buyer"


async def restore_unread_indiamart_leads() -> int:
    """
    The earlier version could not read IndiaMART's push format ({"RESPONSE": {...}}): it stored such an enquiry as
    'IndiaMART Buyer' without a phone number and kept the original data in raw_payload. The buyer's details are
    filled in from that data - only into fields that are still empty, and only while the lead still has the
    placeholder name and no phone number, so a lead somebody completed by hand is never changed.
    """
    from app.core.gst import resolve_state_code
    from app.core.validators import clean_text, sanitize_flat_dict
    from app.services.adapters.indiamart import IndiaMARTAdapter, extract_indiamart_records
    from app.services.lead_service import normalize_email, normalize_phone_number

    collection = get_db()["leads"]
    unread = {"source": "indiamart", "full_name": INDIAMART_PLACEHOLDER_NAME, "phone": {"$in": ["", None]}}
    per_company: Dict[str, int] = {}
    failed = 0
    async for doc in collection.find({**unread, "raw_payload.RESPONSE": {"$exists": True}}):
        try:
            records = extract_indiamart_records(doc.get("raw_payload") or {})
            if len(records) != 1:
                continue  # several enquiries stored in one lead cannot be told apart
            tenant_id = str(doc.get("tenant_id") or "")
            dto = IndiaMARTAdapter().parse_payload(records[0], tenant_id)
            name = clean_text(dto.full_name, 200)
            phone = normalize_phone_number(dto.phone)
            found: Dict[str, Any] = {
                "full_name": name if name != INDIAMART_PLACEHOLDER_NAME else None,
                "phone": phone if len(phone) >= 7 else None,
                "email": normalize_email(dto.email),
                "source_lead_id": clean_text(dto.source_lead_id, 120),
                "company_name": clean_text(dto.company_name, 200),
                "city": clean_text(dto.city, 100),
                "state": clean_text(dto.state, 100),
                "pincode": clean_text(dto.pincode, 10),
                "address": clean_text(dto.address, 500),
                "product_inquired": clean_text(dto.product_inquired, 300),
                "inquiry_message": clean_text(dto.inquiry_message, 5000),
            }
            # name and phone replace the placeholder; every other field is written only where nothing is stored
            update = {field: value for field, value in found.items()
                      if value and (field in ("full_name", "phone") or not doc.get(field))}
            if not update:
                continue
            state_code = resolve_state_code(update.get("state") or doc.get("state"))
            if state_code and not doc.get("state_code"):
                update["state_code"] = state_code
            stored_fields = doc.get("custom_fields") if isinstance(doc.get("custom_fields"), dict) else {}
            custom_fields = {**sanitize_flat_dict(dto.custom_fields), **stored_fields}
            if custom_fields != doc.get("custom_fields"):
                update["custom_fields"] = custom_fields

            note = "Buyer details filled in from the original IndiaMART enquiry (the earlier version could not read them)."
            if update.get("phone"):
                twin = await collection.find_one(
                    {"tenant_id": doc.get("tenant_id"), "phone": update["phone"], "_id": {"$ne": doc["_id"]},
                     "is_deleted": {"$ne": True}}, {"full_name": 1})
                if twin:
                    note += f" Another lead has the same phone number: {clean_text(twin.get('full_name'), 80) or 'unnamed'}."
            entry = {"activity_type": "DETAILS_RESTORED", "note": note, "performed_by_id": "SYSTEM",
                     "performed_by_name": "System upgrade", "metadata": {"fields": sorted(update)},
                     "timestamp": datetime.utcnow()}
            update["updated_at"] = datetime.utcnow()
            if isinstance(doc.get("timeline"), list):
                change = {"$set": update, "$push": {"timeline": entry}}
            else:
                change = {"$set": {**update, "timeline": [entry]}}
            result = await collection.update_one({"_id": doc["_id"], **unread}, change)
            if result.modified_count:
                per_company[tenant_id] = per_company.get(tenant_id, 0) + 1
        except Exception as exc:  # one unreadable record must not stop the other records
            failed += 1
            if failed <= 5:
                logger.warning("IndiaMART enquiry %s was left as it is: %s", doc.get("_id"), type(exc).__name__)
    if failed > 5:
        logger.warning("%s IndiaMART enquiries in total were left as they are.", failed)

    for tenant_id, count in per_company.items():
        await audit("data.indiamart_leads_restored", tenant_id=tenant_id or None, entity_type="lead", details={"leads": count})
    total = sum(per_company.values())
    if total:
        logger.warning("Buyer details of %s IndiaMART enquiries were filled in from their stored original data "
                       "(the earlier version had saved them as '%s' without a phone number).", total, INDIAMART_PLACEHOLDER_NAME)
    return total


async def ensure_bootstrap_superadmin() -> None:
    email = (settings.BOOTSTRAP_SUPERADMIN_EMAIL or "").strip().lower()
    password = settings.BOOTSTRAP_SUPERADMIN_PASSWORD or ""
    if not email or not password:
        return
    errors = password_policy_errors(password, email)
    if errors:
        logger.error("BOOTSTRAP_SUPERADMIN_PASSWORD rejected: %s", " ".join(errors))
        return
    existing = await User.find_one({"email": email})
    if existing:
        # recovery path after the security migration: the operator proves control through the deployment secret
        if existing.role == "super_admin" and existing.must_change_password and existing.password_changed_at is None:
            existing.hashed_password = hash_password(password)
            existing.must_change_password = False
            existing.temp_password_expires_at = None
            existing.is_active = True
            existing.password_changed_at = datetime.utcnow()
            existing.token_version = (existing.token_version or 0) + 1
            await existing.save()
            logger.warning("Bootstrap password applied to the existing platform administrator %s", email)
            await audit("security.superadmin_bootstrapped", entity_type="user", entity_id=str(existing.id),
                        details={"mode": "takeover"})
        return
    if await User.find_one({"role": "super_admin", "password_changed_at": {"$ne": None}}):
        return  # a working platform administrator already exists; never create extra ones silently
    user = User(
        tenant_id="system", full_name=settings.BOOTSTRAP_SUPERADMIN_NAME, email=email,
        hashed_password=hash_password(password), role="super_admin",
        permissions=get_default_permissions_for_role("super_admin"), password_changed_at=datetime.utcnow(),
    )
    await user.insert()
    logger.warning("Platform administrator created from BOOTSTRAP_SUPERADMIN_*: %s. Remove these variables now.", email)
    await audit("security.superadmin_bootstrapped", entity_type="user", entity_id=str(user.id), details={"mode": "created"})


async def run_startup_tasks() -> None:
    from app.api.v1.endpoints.masters import seed_initial_global_masters
    from app.services.scheduler import acquire_lease

    await ensure_indexes()
    if not await acquire_lease("startup_migrations", 120):
        logger.info("Another instance is running the start-up migrations.")
        return
    await repair_legacy_tenant_refs()
    await migrate_legacy_users()
    await encrypt_stored_credentials()
    await seed_initial_global_masters()
    await ensure_bootstrap_superadmin()


async def run_background_upgrades() -> None:
    """
    Repairs of old data that can take long on a large database. They run after the application has started
    (start-up is never delayed by them), on one instance at a time, and continue at the next start if interrupted.
    """
    from app.services.scheduler import acquire_lease

    try:
        for _ in range(12):
            if await acquire_lease("background_upgrades", 900):
                await restore_unread_indiamart_leads()
                return
            await asyncio.sleep(300)  # another instance is at work; look again when its lease has run out
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Background data upgrade stopped (%s); it continues at the next start.", type(exc).__name__)

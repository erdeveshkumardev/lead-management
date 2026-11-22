"""
Operator command line.

    python -m app.cli generate-keys                 # print fresh SECRET_KEY / ENCRYPTION_KEYS
    python -m app.cli init-env                      # create backend/.env with fresh keys (local development)
    python -m app.cli create-superadmin EMAIL       # create the platform administrator (asks for the password)
    python -m app.cli reset-password EMAIL          # set a temporary password for any account
    python -m app.cli reset-mfa EMAIL               # remove two-factor authentication from an account
    python -m app.cli rotate-encryption             # re-encrypt stored credentials with the first ENCRYPTION_KEYS entry
    python -m app.cli seed-demo                     # development only: demo company with random passwords
"""
import argparse
import asyncio
import getpass
import secrets
import sys
from pathlib import Path

from cryptography.fernet import Fernet


def generate_keys() -> None:
    print(f"SECRET_KEY={secrets.token_urlsafe(48)}")
    print(f"ENCRYPTION_KEYS={Fernet.generate_key().decode()}")
    print("\n# Keep these private. Put them in backend/.env (local) or in your secret store / Kubernetes Secret.")
    print("# Never commit them. Losing ENCRYPTION_KEYS makes the stored integration credentials unreadable.")


def init_env() -> None:
    target = Path(__file__).resolve().parent.parent / ".env"
    if target.exists():
        print(f"{target} already exists - not overwriting it.")
        return
    example = target.with_name(".env.example").read_text(encoding="utf-8")
    example = example.replace("SECRET_KEY=", f"SECRET_KEY={secrets.token_urlsafe(48)}", 1)
    example = example.replace("ENCRYPTION_KEYS=", f"ENCRYPTION_KEYS={Fernet.generate_key().decode()}", 1)
    target.write_text(example, encoding="utf-8")
    try:
        target.chmod(0o600)
    except OSError:
        pass
    print(f"Created {target} with freshly generated keys. Set MONGODB_URL in it, then start the server.")


async def _with_db(coro_factory):
    from app.core.config import settings
    from app.core.database import close_db, init_db

    settings.validate_runtime()
    await init_db()
    try:
        return await coro_factory()
    finally:
        await close_db()


def _ask_password(email: str, name: str = "") -> str:
    from app.core.security import password_policy_errors

    while True:
        first = getpass.getpass("New password: ")
        errors = password_policy_errors(first, email, name)
        if errors:
            print("  " + " ".join(errors))
            continue
        if first != getpass.getpass("Repeat password: "):
            print("  Passwords do not match.")
            continue
        return first


async def create_superadmin(email: str, name: str, password: Optional[str] = None) -> None:
    from app.core.audit import audit
    from app.core.security import hash_password, password_policy_errors, utcnow
    from app.models.user import User, get_default_permissions_for_role

    email = email.strip().lower()
    if password:
        errors = password_policy_errors(password, email, name)
        if errors:
            print("Password does not meet requirements: " + " ".join(errors))
            return
    else:
        password = _ask_password(email, name)

    existing = await User.find_one({"email": email})
    if existing:
        existing.role = "super_admin"
        existing.tenant_id = "system"
        existing.full_name = name or existing.full_name
        existing.hashed_password = hash_password(password)
        existing.permissions = get_default_permissions_for_role("super_admin")
        existing.password_changed_at = utcnow()
        existing.must_change_password = False
        existing.temp_password_expires_at = None
        existing.mfa_enabled = False
        existing.mfa_secret = None
        existing.mfa_pending_secret = None
        existing.mfa_recovery_codes = []
        existing.mfa_last_used_step = None
        existing.is_active = True
        existing.failed_login_attempts = 0
        existing.locked_until = None
        existing.token_version = (existing.token_version or 0) + 1
        await existing.save()
        await audit("security.superadmin_created_cli", entity_type="user", entity_id=str(existing.id), details={"mode": "updated"})
        print(f"Platform administrator {email} updated successfully. (2FA is disabled)")
        return

    user = User(tenant_id="system", full_name=name, email=email, hashed_password=hash_password(password),
                role="super_admin", permissions=get_default_permissions_for_role("super_admin"),
                password_changed_at=utcnow(), must_change_password=False, mfa_enabled=False)
    await user.insert()
    await audit("security.superadmin_created_cli", entity_type="user", entity_id=str(user.id), details={"mode": "created"})
    print(f"Platform administrator {email} created successfully. (2FA is disabled)")


async def reset_password(email: str) -> None:
    from app.core.audit import audit
    from app.core.security import generate_temp_password, hash_password, temp_password_expiry
    from app.models.user import User
    from app.services.auth_service import revoke_all_sessions

    user = await User.find_one({"email": email.strip().lower()})
    if not user:
        print("No such user.")
        return
    temp = generate_temp_password()
    user.hashed_password = hash_password(temp)
    user.must_change_password = True
    user.temp_password_expires_at = temp_password_expiry()
    user.failed_login_attempts = 0
    user.locked_until = None
    user.is_active = True
    user.token_version = (user.token_version or 0) + 1
    await user.save()
    await revoke_all_sessions(str(user.id), "password_reset_cli")
    await audit("security.password_reset_cli", entity_type="user", entity_id=str(user.id),
                tenant_id=user.tenant_id if user.tenant_id != "system" else None)
    print(f"Temporary password for {user.email}: {temp}")
    print("It must be changed at the next sign-in and stops working after the configured number of days.")


async def reset_mfa(email: str) -> None:
    from app.core.audit import audit
    from app.models.user import User
    from app.services.auth_service import revoke_all_sessions

    user = await User.find_one({"email": email.strip().lower()})
    if not user:
        print("No such user.")
        return
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_pending_secret = None
    user.mfa_recovery_codes = []
    user.mfa_last_used_step = None
    user.token_version = (user.token_version or 0) + 1
    await user.save()
    await revoke_all_sessions(str(user.id), "mfa_reset_cli")
    await audit("security.mfa_reset_cli", entity_type="user", entity_id=str(user.id))
    print(f"Two-factor authentication removed for {user.email}.")


async def rotate_encryption() -> None:
    from app.core.crypto import rotate
    from app.models.tenant import COMMUNICATION_SECRET_FIELDS, Tenant
    from app.models.user import User
    from app.services.bootstrap import INTEGRATION_PROVIDERS, INTEGRATION_SECRET_FIELDS

    tenants = users = 0
    async for doc in Tenant.get_motor_collection().find({}, {"integrations": 1, "communication_settings": 1}):
        update = {}
        for provider in INTEGRATION_PROVIDERS:
            for field in INTEGRATION_SECRET_FIELDS:
                value = ((doc.get("integrations") or {}).get(provider) or {}).get(field)
                if value:
                    update[f"integrations.{provider}.{field}"] = rotate(value)
        for channel, fields in COMMUNICATION_SECRET_FIELDS.items():
            for field in fields:
                value = ((doc.get("communication_settings") or {}).get(channel) or {}).get(field)
                if value:
                    update[f"communication_settings.{channel}.{field}"] = rotate(value)
        if update:
            await Tenant.get_motor_collection().update_one({"_id": doc["_id"]}, {"$set": update})
            tenants += 1
    async for doc in User.get_motor_collection().find({"$or": [{"mfa_secret": {"$ne": None}}, {"mfa_pending_secret": {"$ne": None}}]}):
        update = {f: rotate(doc[f]) for f in ("mfa_secret", "mfa_pending_secret") if doc.get(f)}
        if update:
            await User.get_motor_collection().update_one({"_id": doc["_id"]}, {"$set": update})
            users += 1
    print(f"Re-encrypted credentials for {tenants} companies and {users} users with the primary key.")
    print("You can now remove the old key from ENCRYPTION_KEYS.")


async def seed_demo() -> None:
    from app.core.config import settings
    from app.core.gst import gstin_checksum_char
    from app.core.security import generate_temp_password, hash_password, temp_password_expiry
    from app.models.tenant import Tenant
    from app.models.user import User, get_default_permissions_for_role

    if settings.is_production:
        print("seed-demo is disabled in production.")
        return
    if await Tenant.find_one({"slug": "demo-machineries"}):
        print("Demo company already exists.")
        return
    base = "24AAACD1234F1Z"  # sample GSTIN with a valid checksum, for local testing only
    tenant = Tenant(company_name="Demo Machineries Pvt Ltd", slug="demo-machineries", company_type="manufacturing",
                    max_users_limit=5, plan_name="Professional", status="ACTIVE", gstin=base + gstin_checksum_char(base),
                    state_code="24", state_name="Gujarat", address="Plot 42, Industrial Estate", city="Ahmedabad",
                    phone="+919800000000", email="admin@demo-machineries.example")
    await tenant.insert()
    print("Demo accounts (temporary passwords, must be changed at first sign-in):")
    for role, name, email in (("company_admin", "Demo Admin", "admin@demo-machineries.example"),
                              ("manager", "Demo Manager", "manager@demo-machineries.example"),
                              ("staff", "Demo Sales Rep", "sales@demo-machineries.example")):
        temp = generate_temp_password()
        await User(tenant_id=str(tenant.id), full_name=name, email=email, hashed_password=hash_password(temp), role=role,
                   permissions=get_default_permissions_for_role(role), must_change_password=True,
                   temp_password_expires_at=temp_password_expiry()).insert()
        print(f"  {role:14} {email:38} {temp}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Lead-to-Cash operator commands")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("generate-keys")
    sub.add_parser("init-env")
    p = sub.add_parser("create-superadmin")
    p.add_argument("email")
    p.add_argument("--name", default="Platform Super Admin")
    p.add_argument("--password", default=None, help="Super admin password")
    sub.add_parser("reset-password").add_argument("email")
    sub.add_parser("reset-mfa").add_argument("email")
    sub.add_parser("rotate-encryption")
    sub.add_parser("seed-demo")
    args = parser.parse_args()

    if args.command == "generate-keys":
        return generate_keys()
    if args.command == "init-env":
        return init_env()
    jobs = {
        "create-superadmin": lambda: create_superadmin(args.email, args.name, getattr(args, "password", None)),
        "reset-password": lambda: reset_password(args.email),
        "reset-mfa": lambda: reset_mfa(args.email),
        "rotate-encryption": rotate_encryption,
        "seed-demo": seed_demo,
    }
    try:
        asyncio.run(_with_db(jobs[args.command]))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

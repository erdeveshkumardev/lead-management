"""
Password hashing (Argon2id), password policy, JWT handling, opaque tokens and TOTP 2FA.
"""
import hashlib
import hmac
import re
import secrets
import string
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import settings

# Argon2id with the library defaults (t=3, m=64 MiB, p=4). Automated tests use a cheap profile for speed.
_hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1) if settings.is_test else PasswordHasher()
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))

COMMON_PASSWORDS = {
    "password", "password1", "password123", "password@123", "passw0rd", "p@ssw0rd", "p@ssword123",
    "123456", "1234567", "12345678", "123456789", "1234567890", "qwerty", "qwerty123", "qwertyuiop",
    "admin", "admin123", "admin@123", "administrator", "welcome", "welcome1", "welcome123", "welcome@123",
    "letmein", "iloveyou", "abc123", "abcd1234", "india123", "india@123", "test1234", "changeme",
    "superadmin", "superadmin123", "default", "secret", "monkey", "dragon", "sunshine", "master",
}


def utcnow() -> datetime:
    """Naive UTC timestamp (consistent with data already stored in MongoDB)."""
    return datetime.utcnow()


# ---------------------------------------------------------------- passwords
def is_password_hash(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("$argon2")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: Optional[str]) -> bool:
    if not password or not is_password_hash(hashed):
        dummy_verify()
        return False
    try:
        return _hasher.verify(hashed, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def dummy_verify() -> None:
    """Spend the same time as a real verification (prevents user enumeration via timing)."""
    try:
        _hasher.verify(_DUMMY_HASH, "not-the-password")
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        pass


def password_needs_rehash(hashed: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hashed)
    except Exception:
        return False


def password_policy_errors(password: str, email: Optional[str] = None, full_name: Optional[str] = None) -> List[str]:
    errors: List[str] = []
    pw = password or ""
    if len(pw) < settings.PASSWORD_MIN_LENGTH:
        errors.append(f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters long.")
    if len(pw) > 128:
        errors.append("Password must be at most 128 characters long.")
    classes = sum([
        bool(re.search(r"[a-z]", pw)),
        bool(re.search(r"[A-Z]", pw)),
        bool(re.search(r"\d", pw)),
        bool(re.search(r"[^A-Za-z0-9]", pw)),
    ])
    if classes < 3:
        errors.append("Password must contain at least 3 of: lowercase, uppercase, number, special character.")
    lowered = pw.lower()
    if lowered in COMMON_PASSWORDS or "password" in lowered:
        errors.append("Password is too common. Choose a less predictable password.")
    if email:
        local = email.split("@")[0].lower()
        if len(local) >= 4 and local in lowered:
            errors.append("Password must not contain your email address.")
    if full_name:
        for part in re.split(r"\s+", full_name.lower()):
            if len(part) >= 4 and part in lowered:
                errors.append("Password must not contain your name.")
                break
    return errors


def temp_password_expiry() -> datetime:
    return utcnow() + timedelta(days=settings.TEMP_PASSWORD_VALID_DAYS)


def generate_temp_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*-_"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if not password_policy_errors(pw):
            return pw


# ---------------------------------------------------------------- generic token helpers
def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_opaque_token(nbytes: int = 48) -> str:
    return secrets.token_urlsafe(nbytes)


def constant_time_equals(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


# ---------------------------------------------------------------- JWT
def _jwt_encode(claims: Dict[str, Any]) -> str:
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(
    *, user_id: str, tenant_id: str, role: str, token_version: int, amr: List[str], session_family: str
) -> Tuple[str, int]:
    now = int(time.time())
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    claims = {
        "sub": user_id,
        "tid": tenant_id,
        "role": role,
        "ver": token_version,
        "amr": amr,
        "sid": session_family,
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "nbf": now,
        "exp": now + expires_in,
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
    }
    return _jwt_encode(claims), expires_in


def create_mfa_pending_token(user_id: str, token_version: int) -> str:
    now = int(time.time())
    claims = {
        "sub": user_id,
        "ver": token_version,
        "type": "mfa_pending",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + 300,
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
    }
    return _jwt_encode(claims)


def decode_token(token: str, expected_type: str) -> Dict[str, Any]:
    """Raises jwt.InvalidTokenError on any problem."""
    claims = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        audience=settings.JWT_AUDIENCE,
        issuer=settings.JWT_ISSUER,
        options={"require": ["exp", "iat", "sub", "type"]},
    )
    if claims.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return claims


def refresh_expiry() -> datetime:
    return utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


# ---------------------------------------------------------------- TOTP 2FA
def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account_name: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=settings.MFA_ISSUER)


def verify_totp(secret: str, code: str, last_used_step: Optional[int]) -> Optional[int]:
    """Returns the matched time-step (store it to block replay) or None."""
    code = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = pyotp.TOTP(secret)
    current = int(time.time() // 30)
    for step in (current - 1, current, current + 1):
        if last_used_step is not None and step <= last_used_step:
            continue
        if hmac.compare_digest(totp.at(step * 30), code):
            return step
    return None


def generate_recovery_codes(count: int = 8) -> List[str]:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(alphabet) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_recovery_code(code: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "", code or "").upper()
    return sha256_hex("recovery:" + normalized)

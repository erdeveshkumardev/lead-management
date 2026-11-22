"""
Field-level encryption for secrets stored at rest (integration API keys, webhook tokens, TOTP seeds).
Uses Fernet (AES-128-CBC + HMAC-SHA256). MultiFernet allows key rotation: the first key encrypts,
every configured key can decrypt.
"""
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings

logger = logging.getLogger("app.crypto")

_PREFIX = "enc:v1:"
_fernet: Optional[MultiFernet] = None


def _get_fernet() -> MultiFernet:
    global _fernet
    if _fernet is None:
        _fernet = MultiFernet([Fernet(k) for k in settings.encryption_keys()])
    return _fernet


def is_encrypted(value: Optional[str]) -> bool:
    return isinstance(value, str) and value.startswith(_PREFIX)


def encrypt_str(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return value
    if is_encrypted(value):
        return value
    token = _get_fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt_str(value: Optional[str]) -> Optional[str]:
    """Decrypts values written by encrypt_str. Legacy plaintext values are returned unchanged."""
    if not is_encrypted(value):
        return value
    try:
        return _get_fernet().decrypt(value[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.error("Unable to decrypt a stored secret - check ENCRYPTION_KEYS configuration.")
        return None


def rotate(value: Optional[str]) -> Optional[str]:
    """Re-encrypts with the current primary key."""
    if not is_encrypted(value):
        return encrypt_str(value)
    return _PREFIX + _get_fernet().rotate(value[len(_PREFIX):].encode("ascii")).decode("ascii")


def mask_secret(value: Optional[str]) -> str:
    plain = decrypt_str(value) if value else None
    if not plain:
        return ""
    if len(plain) <= 4:
        return "••••"
    return "••••••••" + plain[-4:]


def looks_masked(value: Optional[str]) -> bool:
    return isinstance(value, str) and "••••" in value

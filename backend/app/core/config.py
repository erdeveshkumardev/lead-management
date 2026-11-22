"""
Central application settings.

All secrets come from the environment (or a local .env file that is NEVER committed).
In production the app refuses to start with weak or missing secrets.
"""
import base64
import hashlib
import json
import logging
import secrets
from typing import List, Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("app.config")

_WEAK_SECRETS = {
    "",
    "secret",
    "changeme",
    "change_me",
    "supersecret_jwt_key_change_in_production",
    "dev_secret_key_change_in_production",
}


def _parse_list(raw: Optional[str]) -> List[str]:
    """Accepts a JSON array string or a comma separated string."""
    if raw is None:
        return []
    value = str(raw).strip()
    if not value:
        return []
    if value.startswith("["):
        try:
            return [str(v).strip() for v in json.loads(value) if str(v).strip()]
        except json.JSONDecodeError:
            pass
    return [v.strip().strip('"').strip("'") for v in value.strip("[]").split(",") if v.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ---------------- General ----------------
    PROJECT_NAME: str = "Lead-to-Cash LMS"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"  # development | staging | production | test
    TIMEZONE: str = "Asia/Kolkata"
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    ENABLE_API_DOCS: Optional[bool] = None  # default: enabled outside production

    # ---------------- Secrets ----------------
    SECRET_KEY: str = ""  # JWT signing key: private random value, at least 32 characters
    SECRET_KEY_IS_EPHEMERAL: bool = False  # internal flag, set when a temporary development key was generated
    ENCRYPTION_KEYS: str = ""  # comma separated Fernet keys; first one encrypts, all decrypt (rotation)

    # ---------------- Tokens & sessions ----------------
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "leadcash-api"
    JWT_AUDIENCE: str = "leadcash-web"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    REFRESH_COOKIE_NAME: str = "lc_refresh"
    COOKIE_SECURE: Optional[bool] = None  # default: True in production
    COOKIE_SAMESITE: str = "strict"
    COOKIE_DOMAIN: Optional[str] = None

    # ---------------- Login protection ----------------
    MAX_FAILED_LOGINS: int = 5
    LOCKOUT_MINUTES: int = 15
    LOGIN_RATE_LIMIT_PER_MINUTE: int = 10  # sign-in attempts per ACCOUNT per minute
    # Per network address. Deliberately higher: a whole office usually shares one public address, and
    # behind an ingress that hides visitor addresses every user shares one (see SECURITY.md).
    LOGIN_RATE_LIMIT_PER_IP_PER_MINUTE: int = 60
    REFRESH_RATE_LIMIT_PER_IP_PER_MINUTE: int = 300
    PASSWORD_MIN_LENGTH: int = 10
    PASSWORD_RESET_TOKEN_MINUTES: int = 30
    TEMP_PASSWORD_VALID_DAYS: int = 7  # temporary passwords issued by administrators expire after this
    MFA_ISSUER: str = "Lead-to-Cash"
    MFA_REQUIRED_ROLES: str = ""  # comma separated roles that must enrol in 2FA (e.g. "super_admin"); empty disables mandatory 2FA

    # ---------------- Database ----------------
    MONGODB_URL: str = "mongodb://localhost:27017"
    DATABASE_NAME: str = "lead_management_db"

    # ---------------- HTTP hardening ----------------
    BACKEND_CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    ALLOWED_HOSTS: str = "*"
    FORWARDED_ALLOW_HOPS: int = 1  # number of trusted reverse proxies in front of the API
    # Production only: browsers refuse plain HTTP (and certificate warnings cannot be clicked through) for
    # this long after a visit. Keep certificate renewal automatic. 0 switches the header off.
    HSTS_MAX_AGE_SECONDS: int = 31536000
    ALLOW_PRIVATE_OUTBOUND: bool = False  # development only: allow gateways / SMTP on private addresses
    MAX_REQUEST_BODY_BYTES: int = 6 * 1024 * 1024
    WEBHOOK_MAX_BODY_BYTES: int = 128 * 1024
    WEBHOOK_RATE_LIMIT_PER_MINUTE: int = 60
    WEBSITE_FORM_RATE_LIMIT_PER_MINUTE: int = 10
    AUDIT_RETENTION_DAYS: int = 400

    # ---------------- Upgrade from pre-security versions ----------------
    # force_change: old passwords still work once, then a new one must be set (known defaults are always disabled)
    # disable:      every old password is invalidated; administrators issue new temporary passwords
    LEGACY_PASSWORD_MIGRATION: str = "force_change"

    # ---------------- Bootstrap (first super admin) ----------------
    BOOTSTRAP_SUPERADMIN_EMAIL: Optional[str] = None
    BOOTSTRAP_SUPERADMIN_PASSWORD: Optional[str] = None
    BOOTSTRAP_SUPERADMIN_NAME: str = "Platform Super Admin"

    # ---------------- Integrations ----------------
    META_GRAPH_API_VERSION: str = "v19.0"
    INDIAMART_PULL_URL: str = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/"
    ENABLE_SCHEDULER: bool = True
    ENABLE_LEAD_SIMULATOR: Optional[bool] = None  # test-lead tool for admins; default: off in production
    INDIAMART_SYNC_INTERVAL_MINUTES: int = 15

    # ---------------- E-mail (optional, used for password reset) ----------------
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    SMTP_USE_TLS: bool = True

    @model_validator(mode="after")
    def _fill_dev_defaults(self) -> "Settings":
        if not self.SECRET_KEY and not self.is_production:
            # local development convenience only; production must configure the key (see validate_runtime)
            object.__setattr__(self, "SECRET_KEY", secrets.token_urlsafe(48))
            object.__setattr__(self, "SECRET_KEY_IS_EPHEMERAL", True)
        return self

    # ---------------- Derived values ----------------
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() in {"production", "prod"}

    @property
    def is_test(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "test"

    @property
    def cors_origins(self) -> List[str]:
        return _parse_list(self.BACKEND_CORS_ORIGINS)

    @property
    def allowed_hosts(self) -> List[str]:
        hosts = _parse_list(self.ALLOWED_HOSTS)
        return hosts or ["*"]

    @property
    def mfa_required_roles(self) -> List[str]:
        return [r.lower() for r in _parse_list(self.MFA_REQUIRED_ROLES)]

    @property
    def docs_enabled(self) -> bool:
        if self.ENABLE_API_DOCS is not None:
            return bool(self.ENABLE_API_DOCS)
        return not self.is_production

    @property
    def cookie_secure(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return bool(self.COOKIE_SECURE)
        return self.is_production

    @property
    def lead_simulator_enabled(self) -> bool:
        if self.ENABLE_LEAD_SIMULATOR is not None:
            return bool(self.ENABLE_LEAD_SIMULATOR)
        return not self.is_production

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_FROM)

    def encryption_keys(self) -> List[bytes]:
        keys = [k.encode() for k in _parse_list(self.ENCRYPTION_KEYS)]
        if keys:
            return keys
        # Only reachable in automated tests (validate_runtime requires the keys everywhere else)
        digest = hashlib.sha256(("lc-test-encryption:" + self.SECRET_KEY).encode()).digest()
        return [base64.urlsafe_b64encode(digest)]

    def validate_runtime(self) -> None:
        """
        Fail fast on insecure configuration - the application refuses to start rather than run unsafely.
        A publicly known or missing key is rejected in EVERY environment, because an instance that was
        deployed without ENVIRONMENT=production must not silently fall back to guessable secrets.
        """
        hint = " Generate values with: python -m app.cli generate-keys"
        problems: List[str] = []
        if self.SECRET_KEY.strip().lower() in _WEAK_SECRETS or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY must be a private random value of at least 32 characters." + hint)
        if not self.is_test:
            keys = _parse_list(self.ENCRYPTION_KEYS)
            if not keys:
                problems.append("ENCRYPTION_KEYS must be set (stored credentials are encrypted with it)." + hint)
            for key in keys:
                try:
                    if len(base64.urlsafe_b64decode(key.encode())) != 32:
                        raise ValueError
                except Exception:
                    problems.append("ENCRYPTION_KEYS contains a value that is not a valid Fernet key." + hint)
                    break
        if self.is_production:
            if self.SECRET_KEY_IS_EPHEMERAL:
                problems.append("SECRET_KEY must be configured in production.")
            if not self.cookie_secure:
                problems.append("COOKIE_SECURE must be true in production.")
            if not self.cors_origins or any(o.strip() == "*" for o in self.cors_origins):
                problems.append("BACKEND_CORS_ORIGINS must list the exact front-end origins in production.")
            if any(o.startswith("http://") for o in self.cors_origins):
                problems.append("BACKEND_CORS_ORIGINS must use https:// origins in production.")
            if not self.FRONTEND_BASE_URL.startswith("https://"):
                problems.append("FRONTEND_BASE_URL must be the https:// address of the web application in production.")
            if self.ALLOW_PRIVATE_OUTBOUND:
                problems.append("ALLOW_PRIVATE_OUTBOUND must be false in production.")
            if "*" in self.allowed_hosts:
                logger.warning("ALLOWED_HOSTS is '*': set it to your public host name(s) to block Host-header attacks.")
        # Access tokens cannot be withdrawn once issued, so they stay short; the refresh cookie keeps people
        # signed in. (Older deployments configured 10080 minutes = 7 days: that value is refused.)
        if not 1 <= self.ACCESS_TOKEN_EXPIRE_MINUTES <= 60:
            problems.append("ACCESS_TOKEN_EXPIRE_MINUTES must be between 1 and 60 (15 is recommended).")
        if not 1 <= self.REFRESH_TOKEN_EXPIRE_DAYS <= 30:
            problems.append("REFRESH_TOKEN_EXPIRE_DAYS must be between 1 and 30.")
        if min(self.LOGIN_RATE_LIMIT_PER_MINUTE, self.LOGIN_RATE_LIMIT_PER_IP_PER_MINUTE,
               self.REFRESH_RATE_LIMIT_PER_IP_PER_MINUTE, self.MAX_FAILED_LOGINS) < 1:
            problems.append("Sign-in limits (LOGIN_RATE_LIMIT_*, REFRESH_RATE_LIMIT_*, MAX_FAILED_LOGINS) must be at least 1.")
        if self.LEGACY_PASSWORD_MIGRATION not in {"force_change", "disable"}:
            problems.append("LEGACY_PASSWORD_MIGRATION must be force_change or disable.")
        if self.COOKIE_SAMESITE.lower() not in {"strict", "lax", "none"}:
            problems.append("COOKIE_SAMESITE must be one of strict|lax|none.")
        if self.COOKIE_SAMESITE.lower() == "none" and not self.cookie_secure:
            problems.append("COOKIE_SAMESITE=none requires COOKIE_SECURE=true.")
        if problems:
            raise RuntimeError("Insecure configuration - refusing to start:\n  - " + "\n  - ".join(problems))
        if self.SECRET_KEY_IS_EPHEMERAL:
            logger.warning("SECRET_KEY not set - using a temporary key for this run (all sessions end on restart).")


settings = Settings()

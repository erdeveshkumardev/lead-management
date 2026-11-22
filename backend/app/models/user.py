from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document, Indexed
from pydantic import EmailStr, Field

ROLES = ("super_admin", "company_admin", "manager", "staff")
ROLE_RANK = {"staff": 1, "agent": 1, "manager": 2, "company_admin": 3, "super_admin": 4}

# Tenant-level permissions that can be granted per user
PERMISSION_KEYS: List[str] = [
    "leads_view_all",
    "leads_create_edit",
    "leads_delete",
    "leads_assign",
    "leads_export",
    "leads_import",
    "billing_convert",
    "billing_view",
    "billing_payments",
    "billing_cancel",
    "team_manage",
    "products_manage",
    "analytics_view",
    "settings_manage",
    "audit_view",
]


def get_default_permissions_for_role(role: str) -> Dict[str, bool]:
    if role in ("super_admin", "company_admin"):
        perms = {k: True for k in PERMISSION_KEYS}
        perms["all_access"] = True
        perms["companies_manage"] = role == "super_admin"
        return perms
    if role == "manager":
        perms = {k: True for k in PERMISSION_KEYS}
        perms.update({"leads_delete": False, "settings_manage": False, "audit_view": False})
    else:  # staff / sales agent
        perms = {k: False for k in PERMISSION_KEYS}
        perms.update({"leads_create_edit": True, "billing_convert": True, "billing_view": True})
    perms["all_access"] = False
    perms["companies_manage"] = False
    return perms


def effective_permissions(role: str, stored: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    """Role defaults overlaid with explicit per-user grants. Admin roles are always full access."""
    perms = get_default_permissions_for_role(role)
    if role in ("super_admin", "company_admin"):
        return perms
    for key in PERMISSION_KEYS:
        if stored and key in stored:
            perms[key] = bool(stored[key])
    return perms


class User(Document):
    tenant_id: Indexed(str)  # "system" for super_admin, otherwise the tenant ObjectId string
    full_name: str
    email: Indexed(EmailStr, unique=True)
    hashed_password: str  # Argon2id hash - never returned by the API
    phone: Optional[str] = None
    role: str = "staff"
    designation: Optional[str] = None
    department: Optional[str] = None
    permissions: Dict[str, bool] = Field(default_factory=dict)
    is_active: bool = True
    assigned_leads_count: int = 0

    # ---- extended profile ----
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    whatsapp_number: Optional[str] = None
    receive_whatsapp_notifications: bool = True
    receive_email_notifications: bool = True

    # ---- security state ----
    must_change_password: bool = False  # first login / admin reset: a new password must be set before anything else
    temp_password_expires_at: Optional[datetime] = None  # temporary passwords stop working after this time
    password_changed_at: Optional[datetime] = None
    failed_login_attempts: int = 0
    locked_until: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    last_login_ip: Optional[str] = None
    token_version: int = 0  # bump to invalidate every issued access token
    mfa_enabled: bool = False
    mfa_secret: Optional[str] = None  # encrypted
    mfa_pending_secret: Optional[str] = None  # encrypted, during enrolment
    mfa_last_used_step: Optional[int] = None
    mfa_recovery_codes: List[str] = Field(default_factory=list)  # sha256 hashes
    password_reset_token_hash: Optional[str] = None
    password_reset_expires_at: Optional[datetime] = None
    deactivated_at: Optional[datetime] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"
        indexes = [
            [("tenant_id", 1), ("role", 1)],
            [("tenant_id", 1), ("is_active", 1)],
        ]

    def to_public(self, include_private: bool = True) -> Dict[str, Any]:
        """Safe representation: never contains password hashes, MFA seeds or reset tokens."""
        uid = str(self.id) if self.id else None
        data: Dict[str, Any] = {
            "_id": uid,
            "id": uid,
            "tenant_id": self.tenant_id,
            "full_name": self.full_name,
            "role": self.role,
            "designation": self.designation,
            "department": self.department,
            "is_active": self.is_active,
            "assigned_leads_count": self.assigned_leads_count,
        }
        if include_private:
            data.update({
                "email": str(self.email),
                "phone": self.phone,
                "whatsapp_number": self.whatsapp_number,
                "avatar_url": self.avatar_url,
                "bio": self.bio,
                "receive_whatsapp_notifications": self.receive_whatsapp_notifications,
                "receive_email_notifications": self.receive_email_notifications,
                "permissions": effective_permissions(self.role, self.permissions),
                "mfa_enabled": self.mfa_enabled,
                "must_change_password": self.must_change_password,
                "is_first_login": self.must_change_password,  # name used by the web client
                "last_login_at": self.last_login_at,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
            })
        return data

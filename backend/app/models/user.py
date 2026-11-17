from datetime import datetime
from typing import Optional, Dict, Any
from beanie import Document, Indexed
from pydantic import Field, EmailStr


def get_default_permissions_for_role(role: str) -> Dict[str, bool]:
    if role == "super_admin":
        return {
            "all_access": True,
            "leads_view_all": True,
            "leads_create_edit": True,
            "leads_delete": True,
            "billing_convert": True,
            "billing_view": True,
            "billing_payments": True,
            "team_manage": True,
            "products_manage": True,
            "analytics_view": True,
            "companies_manage": True,
        }
    elif role == "company_admin":
        return {
            "all_access": True,
            "leads_view_all": True,
            "leads_create_edit": True,
            "leads_delete": True,
            "billing_convert": True,
            "billing_view": True,
            "billing_payments": True,
            "team_manage": True,
            "products_manage": True,
            "analytics_view": True,
            "companies_manage": False,
        }
    elif role == "manager":
        return {
            "leads_view_all": True,
            "leads_create_edit": True,
            "leads_delete": False,
            "billing_convert": True,
            "billing_view": True,
            "billing_payments": True,
            "team_manage": True,
            "products_manage": True,
            "analytics_view": True,
            "companies_manage": False,
        }
    else:  # "staff" / sales agent
        return {
            "leads_view_all": False,
            "leads_create_edit": True,
            "leads_delete": False,
            "billing_convert": True,
            "billing_view": True,
            "billing_payments": False,
            "team_manage": False,
            "products_manage": False,
            "analytics_view": False,
            "companies_manage": False,
        }


class User(Document):
    tenant_id: Indexed(str)  # "system" for super_admin, or company tenant ID
    full_name: str
    email: Indexed(EmailStr, unique=True)
    hashed_password: str
    phone: Optional[str] = None
    role: str = "staff"  # "super_admin", "company_admin", "manager", "staff"
    designation: Optional[str] = None  # e.g. "Sales Executive", "Senior BDA", "Team Leader"
    department: Optional[str] = None  # e.g. "Sales & Business Development", "Management"
    permissions: Dict[str, bool] = Field(default_factory=dict)
    is_active: bool = True
    assigned_leads_count: int = 0
    
    # First-time login and security profile
    is_first_login: bool = False
    temp_password: Optional[str] = None
    
    # Extended user profile
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    whatsapp_number: Optional[str] = None
    receive_whatsapp_notifications: bool = True
    receive_email_notifications: bool = True
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"
        indexes = [
            [("tenant_id", 1), ("role", 1)],
            [("tenant_id", 1), ("is_active", 1)],
        ]

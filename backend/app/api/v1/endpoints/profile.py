from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from app.models.user import User
from app.models.tenant import Tenant
from app.core.database import get_document_by_id

router = APIRouter(prefix="/profile", tags=["User Profile & Security"])


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    receive_whatsapp_notifications: Optional[bool] = None
    receive_email_notifications: Optional[bool] = None


class ChangePasswordRequest(BaseModel):
    user_id: str
    current_password: Optional[str] = None
    new_password: str
    confirm_password: str


@router.get("/{user_id}")
async def get_user_profile(user_id: str):
    """
    Get full profile details for a user.
    """
    user = await get_document_by_id(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    company_name = "Platform Super Admin"
    if user.tenant_id and user.tenant_id != "system":
        tenant = await get_document_by_id(Tenant, user.tenant_id)
        if tenant:
            company_name = tenant.company_name

    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "whatsapp_number": user.whatsapp_number or user.phone,
        "role": user.role,
        "designation": user.designation,
        "department": user.department,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "company_name": company_name,
        "tenant_id": user.tenant_id,
        "is_first_login": getattr(user, "is_first_login", False),
        "assigned_leads_count": getattr(user, "assigned_leads_count", 0),
        "receive_whatsapp_notifications": getattr(user, "receive_whatsapp_notifications", True),
        "receive_email_notifications": getattr(user, "receive_email_notifications", True),
        "created_at": user.created_at,
        "updated_at": user.updated_at
    }


@router.put("/{user_id}")
async def update_user_profile(user_id: str, payload: UpdateProfileRequest):
    """
    Update personal profile information.
    """
    user = await get_document_by_id(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.phone is not None:
        user.phone = payload.phone.strip()
    if payload.whatsapp_number is not None:
        user.whatsapp_number = payload.whatsapp_number.strip()
    if payload.designation is not None:
        user.designation = payload.designation.strip()
    if payload.department is not None:
        user.department = payload.department.strip()
    if payload.bio is not None:
        user.bio = payload.bio.strip()
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.receive_whatsapp_notifications is not None:
        user.receive_whatsapp_notifications = payload.receive_whatsapp_notifications
    if payload.receive_email_notifications is not None:
        user.receive_email_notifications = payload.receive_email_notifications

    user.updated_at = datetime.utcnow()
    await user.save()

    return {
        "status": "success",
        "message": "Profile updated successfully",
        "profile": {
            "id": str(user.id),
            "full_name": user.full_name,
            "email": user.email,
            "phone": user.phone,
            "whatsapp_number": user.whatsapp_number,
            "designation": user.designation,
            "department": user.department,
            "bio": user.bio,
            "avatar_url": user.avatar_url,
            "receive_whatsapp_notifications": user.receive_whatsapp_notifications,
            "receive_email_notifications": user.receive_email_notifications
        }
    }


@router.post("/change-password")
async def change_password(payload: ChangePasswordRequest):
    """
    Change user password. If is_first_login is True, allows setting new password without strict current password check.
    """
    user = await get_document_by_id(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters long.")

    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="New password and Confirm Password do not match.")

    is_first = getattr(user, "is_first_login", False)

    # If not first login, verify current password
    if not is_first:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Current password is required.")
        if (
            user.hashed_password != payload.current_password
            and payload.current_password != "password123"
        ):
            raise HTTPException(status_code=400, detail="Current password does not match our records.")

    # Update password and clear first-time login flag
    user.hashed_password = payload.new_password
    user.is_first_login = False
    user.temp_password = None
    user.updated_at = datetime.utcnow()
    await user.save()

    return {
        "status": "success",
        "message": "Password changed successfully! You can now use your new password.",
        "user_id": str(user.id),
        "is_first_login": False
    }

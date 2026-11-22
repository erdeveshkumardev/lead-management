"""
User profile. A user can only read and change their own profile; the identity always comes from the
verified session (the user id in the URL is accepted for compatibility but must be the caller's own,
or - read only - a member of the caller's company when the caller manages the team).
"""
import re
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import ChangePasswordRequest, change_password as auth_change_password
from app.core.audit import audit
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_current_user, get_current_user_allow_pending
from app.core.validators import clean_text
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter(prefix="/profile", tags=["User Profile & Security"])

_PHONE_RE = re.compile(r"^[+0-9\-\s()]{7,20}$")


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=20)
    whatsapp_number: Optional[str] = Field(default=None, max_length=20)
    designation: Optional[str] = Field(default=None, max_length=100)
    department: Optional[str] = Field(default=None, max_length=100)
    bio: Optional[str] = Field(default=None, max_length=1000)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    receive_whatsapp_notifications: Optional[bool] = None
    receive_email_notifications: Optional[bool] = None


class ProfileChangePasswordRequest(BaseModel):
    user_id: Optional[str] = Field(default=None, max_length=40)  # ignored: the session decides whose password changes
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)
    confirm_password: str = Field(min_length=1, max_length=128)


async def _profile_view(user: User) -> Dict[str, Any]:
    company_name = "Platform Administration"
    if user.tenant_id and user.tenant_id != "system":
        tenant = await get_document_by_id(Tenant, user.tenant_id)
        if tenant:
            company_name = tenant.company_name
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": str(user.email),
        "phone": user.phone,
        "whatsapp_number": user.whatsapp_number or user.phone,
        "role": user.role,
        "designation": user.designation,
        "department": user.department,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "company_name": company_name,
        "tenant_id": user.tenant_id,
        "is_first_login": user.must_change_password,
        "mfa_enabled": user.mfa_enabled,
        "assigned_leads_count": user.assigned_leads_count or 0,
        "receive_whatsapp_notifications": user.receive_whatsapp_notifications,
        "receive_email_notifications": user.receive_email_notifications,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


async def _target_user(ctx: AuthContext, user_id: str, write: bool) -> User:
    if user_id in ("me", ctx.user_id):
        return ctx.user
    if not write and ctx.has("team_manage") and not ctx.is_super_admin:
        user = await get_document_by_id(User, user_id)
        if user and user.tenant_id == ctx.tenant_id:
            return user
    # same answer whether the account exists or not
    raise HTTPException(status_code=404, detail="User not found")


def _clean_phone(value: Optional[str], label: str) -> Optional[str]:
    text = clean_text(value, 20)
    if text and not _PHONE_RE.match(text):
        raise HTTPException(status_code=400, detail=f"{label} is not a valid phone number.")
    return text


@router.post("/change-password")
async def change_password(payload: ProfileChangePasswordRequest, request: Request, response: Response,
                          ctx: AuthContext = Depends(get_current_user_allow_pending)):
    """Changes the caller's own password (also used for the mandatory first sign-in password change)."""
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="New password and Confirm Password do not match.")
    session = await auth_change_password(
        ChangePasswordRequest(current_password=payload.current_password, new_password=payload.new_password),
        request, response, ctx,
    )
    return {"status": "success", "message": "Password changed successfully.", "is_first_login": False, **session}


@router.get("/{user_id}")
async def get_user_profile(user_id: str, ctx: AuthContext = Depends(get_current_user_allow_pending)):
    return await _profile_view(await _target_user(ctx, user_id, write=False))


@router.put("/{user_id}")
async def update_user_profile(user_id: str, payload: UpdateProfileRequest, ctx: AuthContext = Depends(get_current_user)):
    user = await _target_user(ctx, user_id, write=True)
    data = payload.model_dump(exclude_unset=True)

    if data.get("full_name"):
        user.full_name = clean_text(data["full_name"], 120)
    if "phone" in data:
        user.phone = _clean_phone(data["phone"], "Phone")
    if "whatsapp_number" in data:
        user.whatsapp_number = _clean_phone(data["whatsapp_number"], "WhatsApp number")
    for field, max_len in (("designation", 100), ("department", 100), ("bio", 1000)):
        if field in data:
            setattr(user, field, clean_text(data[field], max_len))
    if "avatar_url" in data:
        avatar = clean_text(data["avatar_url"], 500)
        if avatar and not avatar.lower().startswith("https://"):
            raise HTTPException(status_code=400, detail="Avatar must be an https:// image link.")
        user.avatar_url = avatar
    for flag in ("receive_whatsapp_notifications", "receive_email_notifications"):
        if data.get(flag) is not None:
            setattr(user, flag, bool(data[flag]))

    user.updated_at = datetime.utcnow()
    await user.save()
    await audit("profile.updated", ctx=ctx, entity_type="user", entity_id=str(user.id),
                details={"fields": ", ".join(sorted(data.keys()))})
    view = await _profile_view(user)
    return {"status": "success", "message": "Profile updated successfully", "profile": view, "user": user.to_public()}

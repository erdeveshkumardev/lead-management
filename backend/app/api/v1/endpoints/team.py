from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from app.models.user import User, get_default_permissions_for_role
from app.models.tenant import Tenant
from app.core.database import get_document_by_id

router = APIRouter(prefix="/team", tags=["Company Team & Permission Manager"])


class AddTeamMemberRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str = "password123"
    role: str = "staff"  # "manager", "staff"
    phone: Optional[str] = None
    custom_permissions: Optional[Dict[str, bool]] = None


class UpdatePermissionsRequest(BaseModel):
    permissions: Dict[str, bool]


@router.get("/members")
async def list_team_members(tenant_id: str):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company tenant not found")

    members = await User.find(User.tenant_id == tenant_id).sort("created_at").to_list()
    active_count = len([m for m in members if m.is_active])

    return {
        "tenant_id": tenant_id,
        "company_name": tenant.company_name,
        "max_users_limit": tenant.max_users_limit,
        "current_users_count": active_count,
        "remaining_seats": max(0, tenant.max_users_limit - active_count),
        "members": members
    }


@router.post("/members")
async def add_team_member(tenant_id: str, payload: AddTeamMemberRequest):
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    # ENFORCE LICENSING LIMIT SET BY SUPER ADMIN
    active_users_count = await User.find(User.tenant_id == tenant_id, User.is_active == True).count()
    if active_users_count >= tenant.max_users_limit:
        raise HTTPException(
            status_code=400,
            detail=f"User limit reached! Your company plan allows maximum {tenant.max_users_limit} active users. Please contact Super Admin to increase user limits."
        )

    # Check if email is already taken
    existing = await User.find_one(User.email == payload.email)
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")

    # Permissions
    perms = get_default_permissions_for_role(payload.role)
    if payload.custom_permissions:
        perms.update(payload.custom_permissions)

    new_user = User(
        tenant_id=tenant_id,
        full_name=payload.full_name,
        email=payload.email,
        hashed_password=payload.password,
        phone=payload.phone,
        role=payload.role,
        permissions=perms
    )
    await new_user.insert()

    return {
        "status": "success",
        "message": f"Team member {payload.full_name} added as {payload.role.upper()}",
        "member": new_user
    }


@router.patch("/members/{user_id}/permissions")
async def update_member_permissions(user_id: str, tenant_id: str, payload: UpdatePermissionsRequest):
    user = await get_document_by_id(User, user_id)
    if not user or user.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Team member not found")

    if user.role == "company_admin":
        raise HTTPException(status_code=400, detail="Cannot alter full access permissions of the Company Admin.")

    user.permissions.update(payload.permissions)
    user.updated_at = datetime.utcnow()
    await user.save()

    return {
        "status": "success",
        "message": f"Permissions updated for {user.full_name}",
        "permissions": user.permissions
    }


@router.delete("/members/{user_id}")
async def remove_team_member(user_id: str, tenant_id: str):
    user = await get_document_by_id(User, user_id)
    if not user or user.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Team member not found")

    if user.role == "company_admin":
        raise HTTPException(status_code=400, detail="Cannot delete Company Admin.")

    await user.delete()
    return {"status": "success", "message": f"Team member {user.full_name} deleted successfully"}

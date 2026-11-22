from datetime import datetime
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.core.audit import audit
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_current_user, require_permission, resolve_tenant_id
from app.core.security import generate_temp_password, hash_password, password_policy_errors, temp_password_expiry
from app.core.validators import clean_text
from app.models.tenant import Tenant
from app.models.user import PERMISSION_KEYS, ROLE_RANK, User, get_default_permissions_for_role
from app.services import auth_service
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/team", tags=["Company Team & Permission Manager"])

TENANT_ROLES = ("company_admin", "manager", "staff")


class AddTeamMemberRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: Optional[str] = Field(default=None, max_length=128)
    role: str = "staff"
    designation: Optional[str] = Field(default=None, max_length=100)
    department: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=20)
    custom_permissions: Optional[Dict[str, bool]] = None


class UpdateTeamMemberRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=20)
    designation: Optional[str] = Field(default=None, max_length=100)
    department: Optional[str] = Field(default=None, max_length=100)
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UpdatePermissionsRequest(BaseModel):
    permissions: Dict[str, bool]


def _can_assign_role(ctx: AuthContext, role: str) -> bool:
    if role not in TENANT_ROLES:
        return False
    if ctx.role in ("super_admin", "company_admin"):
        return True
    return ROLE_RANK[role] < ctx.rank


def _can_manage_user(ctx: AuthContext, target: User) -> bool:
    if ctx.role in ("super_admin", "company_admin"):
        return True
    return ROLE_RANK.get(target.role, 0) < ctx.rank


def _filter_grantable(ctx: AuthContext, requested: Optional[Dict[str, bool]]) -> Dict[str, bool]:
    """A user can never grant a permission they do not hold themselves."""
    granted: Dict[str, bool] = {}
    for key, value in (requested or {}).items():
        if key not in PERMISSION_KEYS:
            continue
        if value and not ctx.has(key):
            raise HTTPException(status_code=403, detail=f"You cannot grant the '{key}' permission because you do not have it.")
        granted[key] = bool(value)
    return granted


async def _load_member(ctx: AuthContext, user_id: str, tenant_id: Optional[str]) -> User:
    tid = await resolve_tenant_id(ctx, tenant_id)
    user = await get_document_by_id(User, user_id)
    if not user or user.tenant_id != tid:
        raise HTTPException(status_code=404, detail="Team member not found")
    return user


async def _active_admin_count(tenant_id: str) -> int:
    return await User.find({"tenant_id": tenant_id, "role": "company_admin", "is_active": True}).count()


@router.get("/members")
async def list_team_members(tenant_id: Optional[str] = None, ctx: AuthContext = Depends(get_current_user)):
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    members = await User.find({"tenant_id": tid}).sort("created_at").to_list()
    can_manage = ctx.has("team_manage")
    if not can_manage:
        members = [m for m in members if m.is_active]
    active_count = sum(1 for m in members if m.is_active)
    return {
        "tenant_id": tid,
        "company_name": tenant.company_name,
        "max_users_limit": tenant.max_users_limit,
        "current_users_count": active_count,
        "remaining_seats": max(0, tenant.max_users_limit - active_count),
        "members": [m.to_public(include_private=can_manage) for m in members],
    }


@router.post("/members", status_code=201)
async def add_team_member(payload: AddTeamMemberRequest, tenant_id: Optional[str] = None,
                          ctx: AuthContext = Depends(require_permission("team_manage"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    tenant = await get_document_by_id(Tenant, tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")
    if not _can_assign_role(ctx, payload.role):
        raise HTTPException(status_code=403, detail="You are not allowed to create a user with this role.")

    email = str(payload.email).strip().lower()
    if await User.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A user with this email already exists.")

    active = await User.find({"tenant_id": tid, "is_active": True}).count()
    if active >= tenant.max_users_limit:
        raise HTTPException(
            status_code=400,
            detail=f"User limit reached. Your plan allows a maximum of {tenant.max_users_limit} active users. "
                   "Contact the platform administrator to increase the limit.",
        )

    # the initial password is always temporary: it expires and must be replaced at first sign-in
    password = (payload.password or "").strip()
    if password:
        errors = password_policy_errors(password, email, payload.full_name)
        if errors:
            raise HTTPException(status_code=400, detail=" ".join(errors))
    else:
        password = generate_temp_password()

    perms = get_default_permissions_for_role(payload.role)
    perms.update(_filter_grantable(ctx, payload.custom_permissions))

    user = User(
        tenant_id=tid,
        full_name=clean_text(payload.full_name, 120),
        email=email,
        hashed_password=hash_password(password),
        phone=clean_text(payload.phone, 20),
        role=payload.role,
        designation=clean_text(payload.designation, 100),
        department=clean_text(payload.department, 100),
        permissions=perms,
        must_change_password=True,
        temp_password_expires_at=temp_password_expiry(),
    )
    await user.insert()

    # compensate for a concurrent request that used the last seat at the same time
    if await User.find({"tenant_id": tid, "is_active": True}).count() > tenant.max_users_limit:
        await user.delete()
        raise HTTPException(status_code=400, detail="User limit reached. Please try again.")

    await audit("team.member_created", ctx=ctx, tenant_id=tid, entity_type="user", entity_id=str(user.id),
                details={"role": user.role, "email": email})
    email_result = await NotificationService.notify_team_member_created(tenant, user, password)
    delivered = email_result.get("status") == "success"
    return {
        "status": "success",
        "message": f"Team member {user.full_name} added as {user.role.replace('_', ' ').title()}. "
                   + ("A welcome e-mail with sign-in details was sent. " if delivered
                      else "E-mail is not configured: share the temporary password securely. ")
                   + "They must set their own password at first sign-in.",
        "member": user.to_public(),
        # shown once to the administrator; it is never stored in readable form
        "temp_password": password,
        "is_first_login": True,
        "email_status": email_result.get("status", "error"),
    }


@router.patch("/members/{user_id}")
async def update_team_member(user_id: str, payload: UpdateTeamMemberRequest, tenant_id: Optional[str] = None,
                             ctx: AuthContext = Depends(require_permission("team_manage"))):
    user = await _load_member(ctx, user_id, tenant_id)
    if not _can_manage_user(ctx, user):
        raise HTTPException(status_code=403, detail="You are not allowed to modify this user.")
    changes = payload.model_dump(exclude_unset=True)
    is_self = str(user.id) == ctx.user_id

    if "role" in changes and changes["role"] != user.role:
        if is_self:
            raise HTTPException(status_code=400, detail="You cannot change your own role.")
        if not _can_assign_role(ctx, changes["role"]):
            raise HTTPException(status_code=403, detail="You are not allowed to assign this role.")
        if user.role == "company_admin" and await _active_admin_count(user.tenant_id) <= 1:
            raise HTTPException(status_code=400, detail="A company must keep at least one active Company Admin.")
        user.role = changes["role"]
        user.permissions = get_default_permissions_for_role(user.role)
        user.token_version = (user.token_version or 0) + 1

    if "is_active" in changes and changes["is_active"] != user.is_active:
        if is_self:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
        if changes["is_active"]:
            tenant = await get_document_by_id(Tenant, user.tenant_id)
            active = await User.find({"tenant_id": user.tenant_id, "is_active": True}).count()
            if tenant and active >= tenant.max_users_limit:
                raise HTTPException(status_code=400, detail="User limit reached. Deactivate another user or increase the limit.")
            user.is_active = True
            user.deactivated_at = None
        else:
            if user.role == "company_admin" and await _active_admin_count(user.tenant_id) <= 1:
                raise HTTPException(status_code=400, detail="A company must keep at least one active Company Admin.")
            user.is_active = False
            user.deactivated_at = datetime.utcnow()
            user.token_version = (user.token_version or 0) + 1
            await auth_service.revoke_all_sessions(str(user.id), "deactivated")

    for field, max_len in (("full_name", 120), ("phone", 20), ("designation", 100), ("department", 100)):
        if field in changes:
            setattr(user, field, clean_text(changes[field], max_len))

    user.updated_at = datetime.utcnow()
    await user.save()
    await audit("team.member_updated", ctx=ctx, tenant_id=user.tenant_id, entity_type="user", entity_id=str(user.id),
                details={"fields": ", ".join(sorted(changes.keys()))})
    return {"status": "success", "message": f"{user.full_name} updated.", "member": user.to_public()}


@router.patch("/members/{user_id}/permissions")
async def update_member_permissions(user_id: str, payload: UpdatePermissionsRequest, tenant_id: Optional[str] = None,
                                    ctx: AuthContext = Depends(require_permission("team_manage"))):
    user = await _load_member(ctx, user_id, tenant_id)
    if user.role == "company_admin":
        raise HTTPException(status_code=400, detail="Company Admins always have full access.")
    if str(user.id) == ctx.user_id:
        raise HTTPException(status_code=400, detail="You cannot change your own permissions.")
    if not _can_manage_user(ctx, user):
        raise HTTPException(status_code=403, detail="You are not allowed to modify this user.")

    updates = _filter_grantable(ctx, payload.permissions)
    user.permissions = {**(user.permissions or {}), **updates}
    user.updated_at = datetime.utcnow()
    await user.save()
    await audit("team.permissions_updated", ctx=ctx, tenant_id=user.tenant_id, entity_type="user", entity_id=str(user.id),
                details={"changed": ", ".join(f"{k}={v}" for k, v in sorted(updates.items()))})
    return {"status": "success", "message": f"Permissions updated for {user.full_name}",
            "permissions": user.to_public()["permissions"]}


@router.post("/members/{user_id}/reset-password")
async def reset_member_password(user_id: str, tenant_id: Optional[str] = None,
                                ctx: AuthContext = Depends(require_permission("team_manage"))):
    user = await _load_member(ctx, user_id, tenant_id)
    if str(user.id) == ctx.user_id:
        raise HTTPException(status_code=400, detail="Use 'Change password' to update your own password.")
    if not _can_manage_user(ctx, user):
        raise HTTPException(status_code=403, detail="You are not allowed to reset this user's password.")
    temp_password = generate_temp_password()
    user.hashed_password = hash_password(temp_password)
    user.must_change_password = True
    user.temp_password_expires_at = temp_password_expiry()
    user.failed_login_attempts = 0
    user.locked_until = None
    user.token_version = (user.token_version or 0) + 1
    user.updated_at = datetime.utcnow()
    await user.save()
    await auth_service.revoke_all_sessions(str(user.id), "password_reset_by_admin")
    await audit("team.password_reset", ctx=ctx, tenant_id=user.tenant_id, entity_type="user", entity_id=str(user.id))
    return {"status": "success", "temp_password": temp_password,
            "message": f"Temporary password generated for {user.full_name}. Share it securely; it must be changed at next sign-in."}


@router.post("/members/{user_id}/reset-mfa")
async def reset_member_mfa(user_id: str, tenant_id: Optional[str] = None,
                           ctx: AuthContext = Depends(require_permission("team_manage"))):
    user = await _load_member(ctx, user_id, tenant_id)
    if str(user.id) == ctx.user_id:
        raise HTTPException(status_code=400, detail="You cannot reset your own two-factor authentication here.")
    if not _can_manage_user(ctx, user):
        raise HTTPException(status_code=403, detail="You are not allowed to modify this user.")
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_pending_secret = None
    user.mfa_recovery_codes = []
    user.mfa_last_used_step = None
    user.token_version = (user.token_version or 0) + 1
    await user.save()
    await auth_service.revoke_all_sessions(str(user.id), "mfa_reset_by_admin")
    await audit("team.mfa_reset", ctx=ctx, tenant_id=user.tenant_id, entity_type="user", entity_id=str(user.id))
    return {"status": "success", "message": f"Two-factor authentication reset for {user.full_name}."}


@router.delete("/members/{user_id}")
async def remove_team_member(user_id: str, tenant_id: Optional[str] = None,
                             ctx: AuthContext = Depends(require_permission("team_manage"))):
    """Deactivates the account (frees the seat, revokes every session). History is retained for audit."""
    user = await _load_member(ctx, user_id, tenant_id)
    if str(user.id) == ctx.user_id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    if not _can_manage_user(ctx, user):
        raise HTTPException(status_code=403, detail="You are not allowed to remove this user.")
    if user.role == "company_admin" and user.is_active and await _active_admin_count(user.tenant_id) <= 1:
        raise HTTPException(status_code=400, detail="A company must keep at least one active Company Admin.")
    user.is_active = False
    user.deactivated_at = datetime.utcnow()
    user.token_version = (user.token_version or 0) + 1
    user.updated_at = datetime.utcnow()
    await user.save()
    await auth_service.revoke_all_sessions(str(user.id), "removed")
    await audit("team.member_deactivated", ctx=ctx, tenant_id=user.tenant_id, entity_type="user", entity_id=str(user.id))
    return {"status": "success", "message": f"{user.full_name} has been deactivated and signed out."}

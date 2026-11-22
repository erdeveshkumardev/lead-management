"""Session issuing, refresh-token rotation (with reuse detection) and cookie handling."""
import logging
import uuid
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException, Request, Response, status

from app.core.audit import audit
from app.core.config import settings
from app.core.database import get_document_by_id
from app.core.deps import INACTIVE_TENANT_STATUSES, get_client_ip, pending_actions_for
from app.core.security import create_access_token, new_opaque_token, refresh_expiry, sha256_hex, utcnow
from app.models.session import RefreshSession
from app.models.tenant import Tenant
from app.models.user import User

logger = logging.getLogger("app.auth")
_ROTATION_GRACE_SECONDS = 15


def _cookie_path() -> str:
    return f"{settings.API_V1_STR}/auth"


def set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.COOKIE_SAMESITE.lower(),
        domain=settings.COOKIE_DOMAIN or None,
        path=_cookie_path(),
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN or None,
        path=_cookie_path(),
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.COOKIE_SAMESITE.lower(),
    )


async def tenant_info_for(user: User) -> Optional[Dict[str, Any]]:
    if user.role == "super_admin" or user.tenant_id == "system":
        return None
    tenant = await get_document_by_id(Tenant, user.tenant_id)
    if not tenant:
        return None
    return {
        "id": str(tenant.id),
        "company_name": tenant.company_name,
        "company_type": tenant.company_type,
        "plan_name": tenant.plan_name,
        "max_users_limit": tenant.max_users_limit,
        "gstin": tenant.gstin,
        "status": tenant.status,
    }


async def session_payload(user: User, mfa: bool) -> Dict[str, Any]:
    pending = pending_actions_for(user, mfa)
    return {
        "user": user.to_public(),
        "tenant": await tenant_info_for(user),
        "must_change_password": bool(pending.get("must_change_password")),
        "mfa_enrollment_required": bool(pending.get("mfa_enrollment_required")),
        "features": {"lead_simulator": settings.lead_simulator_enabled, "email_enabled": settings.smtp_enabled},
    }


async def assert_tenant_active(user: User) -> None:
    if user.role == "super_admin":
        return
    tenant = await get_document_by_id(Tenant, user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company account not found.")
    if (tenant.status or "ACTIVE").upper() in INACTIVE_TENANT_STATUSES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your company account is suspended. Contact the platform administrator.")


async def issue_session(
    response: Response, request: Request, user: User, *, mfa: bool, family_id: Optional[str] = None
) -> Dict[str, Any]:
    raw = new_opaque_token()
    family = family_id or uuid.uuid4().hex
    session = RefreshSession(
        user_id=str(user.id),
        tenant_id=user.tenant_id,
        token_hash=sha256_hex(raw),
        family_id=family,
        mfa=mfa,
        ip=get_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        expires_at=refresh_expiry(),
    )
    await session.insert()
    set_refresh_cookie(response, raw)
    access_token, expires_in = create_access_token(
        user_id=str(user.id),
        tenant_id=user.tenant_id,
        role=user.role,
        token_version=user.token_version or 0,
        amr=["pwd", "otp"] if mfa else ["pwd"],
        session_family=family,
    )
    payload = await session_payload(user, mfa)
    payload.update({"access_token": access_token, "token_type": "bearer", "expires_in": expires_in, "session_id": str(session.id)})
    return payload


async def revoke_all_sessions(user_id: str, reason: str) -> int:
    now = utcnow()
    result = await RefreshSession.find(
        {"user_id": user_id, "revoked_at": None}
    ).update({"$set": {"revoked_at": now, "revoked_reason": reason}})
    return getattr(result, "modified_count", 0) if result is not None else 0


async def revoke_session_by_raw(raw_token: Optional[str], reason: str) -> None:
    if not raw_token:
        return
    session = await RefreshSession.find_one({"token_hash": sha256_hex(raw_token)})
    if session and not session.revoked_at:
        session.revoked_at = utcnow()
        session.revoked_reason = reason
        await session.save()


async def rotate_refresh_token(request: Request, response: Response) -> Tuple[User, Dict[str, Any]]:
    raw = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No active session")
    session = await RefreshSession.find_one({"token_hash": sha256_hex(raw)})
    now = utcnow()
    if not session:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")

    if session.revoked_at:
        benign_race = (
            session.revoked_reason == "rotated"
            and (now - session.revoked_at) <= timedelta(seconds=_ROTATION_GRACE_SECONDS)
        )
        if not benign_race:
            # A rotated refresh token was replayed -> assume theft, kill the whole session family
            await RefreshSession.find({"family_id": session.family_id, "revoked_at": None}).update(
                {"$set": {"revoked_at": now, "revoked_reason": "reuse_detected"}}
            )
            await audit("auth.refresh_token_reuse", request=request, tenant_id=session.tenant_id,
                        actor_id=session.user_id, status="failure", details={"family_id": session.family_id})
            clear_refresh_cookie(response)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")

    if session.expires_at <= now:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = await get_document_by_id(User, session.user_id)
    if not user or not user.is_active:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is not active")
    await assert_tenant_active(user)

    # issue the replacement first so the session family never appears empty to concurrent requests
    payload = await issue_session(response, request, user, mfa=session.mfa, family_id=session.family_id)
    if not session.revoked_at:
        session.revoked_at = now
        session.revoked_reason = "rotated"
        session.last_used_at = now
        session.replaced_by = payload.get("session_id")
        await session.save()
    return user, payload

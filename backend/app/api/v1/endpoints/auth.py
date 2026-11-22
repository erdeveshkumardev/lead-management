"""
Authentication: Argon2id passwords, short-lived JWT access tokens, rotating refresh tokens in an
HttpOnly cookie, TOTP two-factor authentication, account lockout and password reset.
"""
import base64
import io
import logging
from datetime import timedelta
from urllib.parse import urlparse

import jwt
import segno
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.core import rate_limiter
from app.core.audit import audit
from app.core.config import settings
from app.core.crypto import decrypt_str, encrypt_str
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_client_ip, get_current_user_allow_pending
from app.core.security import (
    create_mfa_pending_token, decode_token, dummy_verify, generate_recovery_codes, hash_password,
    hash_recovery_code, new_opaque_token, new_totp_secret, password_needs_rehash, password_policy_errors,
    sha256_hex, totp_provisioning_uri, utcnow, verify_password, verify_totp,
)
from app.models.session import RefreshSession
from app.models.user import User
from app.services import auth_service
from app.services.email_service import send_email

logger = logging.getLogger("app.auth")
router = APIRouter(prefix="/auth", tags=["Authentication"])

GENERIC_LOGIN_ERROR = (
    "Invalid email or password. Accounts are temporarily locked after repeated failed attempts."
)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class MfaVerifyRequest(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=2000)
    code: str = Field(min_length=6, max_length=20)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=1, max_length=128)


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class MfaDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=20)


def require_browser_request(request: Request) -> None:
    """
    CSRF defence for the cookie-authenticated endpoints (refresh / logout):
    a custom header forces a CORS pre-flight, and the Origin must be an allowed front-end.
    """
    if request.headers.get("x-requested-with") != "XMLHttpRequest":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing required request header.")
    origin = request.headers.get("origin")
    if origin:
        allowed = {o.rstrip("/") for o in settings.cors_origins}
        host = request.headers.get("host", "")
        same_host = urlparse(origin).netloc == host
        if origin.rstrip("/") not in allowed and not same_host:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin not allowed.")


async def _register_failed_login(user: User, request: Request, reason: str) -> None:
    collection = User.get_motor_collection()
    doc = await collection.find_one_and_update(
        {"_id": user.id}, {"$inc": {"failed_login_attempts": 1}}, return_document=ReturnDocument.AFTER
    )
    attempts = int((doc or {}).get("failed_login_attempts", 0))
    locked = attempts >= settings.MAX_FAILED_LOGINS
    if locked:
        await collection.update_one(
            {"_id": user.id},
            {"$set": {"locked_until": utcnow() + timedelta(minutes=settings.LOCKOUT_MINUTES), "failed_login_attempts": 0}},
        )
    await audit("auth.login_failed", request=request, tenant_id=user.tenant_id if user.tenant_id != "system" else None,
                actor_id=str(user.id), actor_email=str(user.email), actor_role=user.role, status="failure",
                details={"reason": reason, "locked": locked})


async def _complete_login(user: User, request: Request, response: Response, mfa: bool) -> dict:
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    user.last_login_ip = get_client_ip(request)
    await user.save()
    payload = await auth_service.issue_session(response, request, user, mfa=mfa)
    await audit("auth.login", request=request, tenant_id=user.tenant_id if user.tenant_id != "system" else None,
                actor_id=str(user.id), actor_email=str(user.email), actor_role=user.role,
                details={"mfa": mfa})
    return payload


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response):
    ip = get_client_ip(request)
    email = payload.email.strip().lower()
    # per address: a coarse brake against password spraying (an office shares one address, so it is generous);
    # per account: the tight limit, together with the lock after MAX_FAILED_LOGINS wrong passwords
    await rate_limiter.enforce(f"login:ip:{ip}", settings.LOGIN_RATE_LIMIT_PER_IP_PER_MINUTE, 60,
                               "Too many login attempts. Please wait a minute and try again.")
    await rate_limiter.enforce(f"login:acct:{email}", settings.LOGIN_RATE_LIMIT_PER_MINUTE, 60,
                               "Too many login attempts. Please wait a minute and try again.")

    user = await User.find_one({"email": email})
    if not user:
        dummy_verify()
        await audit("auth.login_failed", request=request, status="failure", details={"reason": "unknown_account"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_ERROR)

    if user.locked_until and user.locked_until > utcnow():
        dummy_verify()
        await audit("auth.login_blocked", request=request, actor_id=str(user.id), actor_email=email,
                    status="failure", details={"reason": "locked"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_ERROR)

    if not verify_password(payload.password, user.hashed_password):
        await _register_failed_login(user, request, "bad_password")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_ERROR)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated. Contact your administrator.")
    if user.must_change_password and user.temp_password_expires_at and user.temp_password_expires_at < utcnow():
        await audit("auth.login_failed", request=request, actor_id=str(user.id), actor_email=email, status="failure",
                    tenant_id=user.tenant_id if user.tenant_id != "system" else None, details={"reason": "temp_password_expired"})
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Your temporary password has expired. Ask your administrator to issue a new one.")
    await auth_service.assert_tenant_active(user)

    if password_needs_rehash(user.hashed_password):
        user.hashed_password = hash_password(payload.password)

    if user.mfa_enabled:
        await user.save()
        return {"mfa_required": True, "mfa_token": create_mfa_pending_token(str(user.id), user.token_version or 0)}

    return await _complete_login(user, request, response, mfa=False)


@router.post("/mfa/verify")
async def mfa_verify(payload: MfaVerifyRequest, request: Request, response: Response):
    try:
        claims = decode_token(payload.mfa_token, "mfa_pending")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Verification expired. Please sign in again.")
    user = await get_document_by_id(User, claims.get("sub"))
    if not user or not user.is_active or not user.mfa_enabled or int(claims.get("ver", -1)) != int(user.token_version or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Verification expired. Please sign in again.")
    await rate_limiter.enforce(f"mfa:{user.id}", 6, 60, "Too many verification attempts. Please wait a minute.")
    if user.locked_until and user.locked_until > utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_ERROR)

    secret = decrypt_str(user.mfa_secret)
    step = verify_totp(secret, payload.code, user.mfa_last_used_step) if secret else None
    if step is not None:
        user.mfa_last_used_step = step
    else:
        code_hash = hash_recovery_code(payload.code)
        if code_hash in (user.mfa_recovery_codes or []):
            user.mfa_recovery_codes = [c for c in user.mfa_recovery_codes if c != code_hash]
            await audit("auth.mfa_recovery_code_used", request=request, actor_id=str(user.id),
                        actor_email=str(user.email), tenant_id=user.tenant_id if user.tenant_id != "system" else None,
                        details={"remaining": len(user.mfa_recovery_codes)})
        else:
            await _register_failed_login(user, request, "bad_mfa_code")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification code.")
    await auth_service.assert_tenant_active(user)
    return await _complete_login(user, request, response, mfa=True)


@router.post("/refresh", dependencies=[Depends(require_browser_request)])
async def refresh(request: Request, response: Response):
    await rate_limiter.enforce(f"refresh:ip:{get_client_ip(request)}", settings.REFRESH_RATE_LIMIT_PER_IP_PER_MINUTE, 60)
    _, payload = await auth_service.rotate_refresh_token(request, response)
    return payload


@router.post("/logout", dependencies=[Depends(require_browser_request)])
async def logout(request: Request, response: Response):
    raw = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if raw:
        session = await RefreshSession.find_one({"token_hash": sha256_hex(raw)})
        if session:
            await RefreshSession.find({"family_id": session.family_id, "revoked_at": None}).update(
                {"$set": {"revoked_at": utcnow(), "revoked_reason": "logout"}}
            )
            await audit("auth.logout", request=request, actor_id=session.user_id,
                        tenant_id=session.tenant_id if session.tenant_id != "system" else None)
    auth_service.clear_refresh_cookie(response)
    return {"status": "success"}


@router.post("/logout-all")
async def logout_all(response: Response, ctx: AuthContext = Depends(get_current_user_allow_pending)):
    ctx.user.token_version = (ctx.user.token_version or 0) + 1
    await ctx.user.save()
    await auth_service.revoke_all_sessions(ctx.user_id, "logout_all")
    auth_service.clear_refresh_cookie(response)
    await audit("auth.logout_all", ctx=ctx)
    return {"status": "success", "message": "Signed out from all devices."}


@router.get("/me")
async def me(ctx: AuthContext = Depends(get_current_user_allow_pending)):
    return await auth_service.session_payload(ctx.user, ctx.mfa_authenticated)


@router.post("/change-password")
async def change_password(payload: ChangePasswordRequest, request: Request, response: Response,
                          ctx: AuthContext = Depends(get_current_user_allow_pending)):
    await rate_limiter.enforce(f"chpw:{ctx.user_id}", 5, 60)
    user = ctx.user
    if not verify_password(payload.current_password, user.hashed_password):
        await audit("auth.password_change_failed", ctx=ctx, status="failure")
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current password.")
    errors = password_policy_errors(payload.new_password, str(user.email), user.full_name)
    if errors:
        raise HTTPException(status_code=400, detail=" ".join(errors))

    user.hashed_password = hash_password(payload.new_password)
    user.must_change_password = False
    user.temp_password_expires_at = None
    user.password_changed_at = utcnow()
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    user.token_version = (user.token_version or 0) + 1
    user.updated_at = utcnow()
    await user.save()
    await auth_service.revoke_all_sessions(ctx.user_id, "password_changed")
    await audit("auth.password_changed", ctx=ctx)
    return await auth_service.issue_session(response, request, user, mfa=ctx.mfa_authenticated)


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    ip = get_client_ip(request)
    email = payload.email.strip().lower()
    await rate_limiter.enforce(f"forgot:ip:{ip}", 20, 300)
    await rate_limiter.enforce(f"forgot:acct:{email}", 3, 900)
    generic = {"status": "success", "message": "If the account exists, password reset instructions have been sent."}
    user = await User.find_one({"email": email})
    if not user or not user.is_active:
        return generic
    if not settings.smtp_enabled:
        logger.warning("Password reset requested but e-mail delivery is not configured; ask an administrator to reset it.")
        await audit("auth.password_reset_requested", request=request, actor_id=str(user.id), actor_email=email,
                    status="failure", details={"reason": "email_not_configured"})
        return generic
    token = new_opaque_token(32)
    user.password_reset_token_hash = sha256_hex(token)
    user.password_reset_expires_at = utcnow() + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_MINUTES)
    await user.save()
    link = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/#/reset-password?token={token}"
    await send_email(
        email,
        f"{settings.PROJECT_NAME}: password reset",
        f"Hello {user.full_name},\n\nUse the link below to set a new password. It expires in "
        f"{settings.PASSWORD_RESET_TOKEN_MINUTES} minutes and can be used once.\n\n{link}\n\n"
        "If you did not request this, you can ignore this e-mail.\n",
    )
    await audit("auth.password_reset_requested", request=request, actor_id=str(user.id), actor_email=email,
                tenant_id=user.tenant_id if user.tenant_id != "system" else None)
    return generic


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, request: Request):
    await rate_limiter.enforce(f"reset:ip:{get_client_ip(request)}", 10, 300)
    user = await User.find_one({"password_reset_token_hash": sha256_hex(payload.token)})
    if not user or not user.password_reset_expires_at or user.password_reset_expires_at < utcnow() or not user.is_active:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")
    errors = password_policy_errors(payload.new_password, str(user.email), user.full_name)
    if errors:
        raise HTTPException(status_code=400, detail=" ".join(errors))
    user.hashed_password = hash_password(payload.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    user.must_change_password = False
    user.temp_password_expires_at = None
    user.password_changed_at = utcnow()
    user.failed_login_attempts = 0
    user.locked_until = None
    user.token_version = (user.token_version or 0) + 1
    await user.save()
    await auth_service.revoke_all_sessions(str(user.id), "password_reset")
    await audit("auth.password_reset", request=request, actor_id=str(user.id), actor_email=str(user.email),
                tenant_id=user.tenant_id if user.tenant_id != "system" else None)
    return {"status": "success", "message": "Password updated. Please sign in with your new password."}


# ----------------------------------------------------------------- two-factor authentication
@router.post("/mfa/setup")
async def mfa_setup(ctx: AuthContext = Depends(get_current_user_allow_pending)):
    if ctx.user.mfa_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled.")
    secret = new_totp_secret()
    ctx.user.mfa_pending_secret = encrypt_str(secret)
    await ctx.user.save()
    uri = totp_provisioning_uri(secret, ctx.email)
    buffer = io.BytesIO()
    segno.make(uri, error="m").save(buffer, kind="svg", scale=5, border=2, xmldecl=False)
    qr = "data:image/svg+xml;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    return {"secret": secret, "otpauth_uri": uri, "qr_code": qr}


@router.post("/mfa/enable")
async def mfa_enable(payload: MfaCodeRequest, request: Request, response: Response,
                     ctx: AuthContext = Depends(get_current_user_allow_pending)):
    await rate_limiter.enforce(f"mfa:{ctx.user_id}", 6, 60, "Too many verification attempts. Please wait a minute.")
    user = ctx.user
    secret = decrypt_str(user.mfa_pending_secret)
    if user.mfa_enabled or not secret:
        raise HTTPException(status_code=400, detail="Start two-factor setup first.")
    step = verify_totp(secret, payload.code, None)
    if step is None:
        raise HTTPException(status_code=400, detail="Invalid verification code. Check your authenticator app and try again.")
    codes = generate_recovery_codes()
    user.mfa_secret = encrypt_str(secret)
    user.mfa_pending_secret = None
    user.mfa_enabled = True
    user.mfa_last_used_step = step
    user.mfa_recovery_codes = [hash_recovery_code(c) for c in codes]
    user.token_version = (user.token_version or 0) + 1
    await user.save()
    await auth_service.revoke_all_sessions(ctx.user_id, "mfa_enabled")
    await audit("auth.mfa_enabled", ctx=ctx)
    session = await auth_service.issue_session(response, request, user, mfa=True)
    session["recovery_codes"] = codes
    return session


@router.post("/mfa/disable")
async def mfa_disable(payload: MfaDisableRequest, request: Request, response: Response,
                      ctx: AuthContext = Depends(get_current_user_allow_pending)):
    await rate_limiter.enforce(f"mfa:{ctx.user_id}", 6, 60)
    user = ctx.user
    if not user.mfa_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled.")
    secret = decrypt_str(user.mfa_secret)
    code_ok = bool(secret) and verify_totp(secret, payload.code, user.mfa_last_used_step) is not None
    if not verify_password(payload.password, user.hashed_password) or not code_ok:
        await audit("auth.mfa_disable_failed", ctx=ctx, status="failure")
        raise HTTPException(status_code=400, detail="Password or verification code is incorrect.")
    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_pending_secret = None
    user.mfa_recovery_codes = []
    user.mfa_last_used_step = None
    user.token_version = (user.token_version or 0) + 1
    await user.save()
    await auth_service.revoke_all_sessions(ctx.user_id, "mfa_disabled")
    await audit("auth.mfa_disabled", ctx=ctx)
    return await auth_service.issue_session(response, request, user, mfa=False)


# ----------------------------------------------------------------- session management
@router.get("/sessions")
async def list_sessions(request: Request, ctx: AuthContext = Depends(get_current_user_allow_pending)):
    current_hash = sha256_hex(request.cookies.get(settings.REFRESH_COOKIE_NAME) or "-")
    sessions = await RefreshSession.find(
        {"user_id": ctx.user_id, "revoked_at": None, "expires_at": {"$gt": utcnow()}}
    ).sort("-created_at").to_list()
    return [{
        "id": str(s.id), "ip": s.ip, "user_agent": s.user_agent, "created_at": s.created_at,
        "expires_at": s.expires_at, "current": s.token_hash == current_hash,
    } for s in sessions]


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, ctx: AuthContext = Depends(get_current_user_allow_pending)):
    session = await get_document_by_id(RefreshSession, session_id)
    if not session or session.user_id != ctx.user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    await RefreshSession.find({"family_id": session.family_id, "revoked_at": None}).update(
        {"$set": {"revoked_at": utcnow(), "revoked_reason": "revoked_by_user"}}
    )
    await audit("auth.session_revoked", ctx=ctx, entity_type="session", entity_id=session_id)
    return {"status": "success"}

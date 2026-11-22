"""
Authentication & authorisation dependencies.

Every protected endpoint receives an AuthContext derived ONLY from a verified access token.
Tenant identity is never trusted from query parameters.
"""
import ipaddress
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional, Tuple

import jwt
from fastapi import Depends, HTTPException, Request, status

from app.core.config import settings
from app.core.database import get_document_by_id
from app.core.security import decode_token, utcnow
from app.models.session import RefreshSession
from app.models.tenant import Tenant
from app.models.user import ROLE_RANK, User, effective_permissions

logger = logging.getLogger("app.deps")

_TENANT_CACHE: Dict[str, Tuple[str, float]] = {}
_TENANT_CACHE_TTL = 20.0
INACTIVE_TENANT_STATUSES = {"SUSPENDED", "INACTIVE", "CANCELLED"}


_hidden_address_reported = False
# addresses that only exist inside a private network / cluster - a real visitor never has one
_INTERNAL_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "::1/128", "fc00::/7", "fe80::/10",
))


def _report_hidden_visitor_address(ip: str) -> None:
    """
    Production only, once per process: a visitor that appears to come from a private network address means
    the proxy in front of the API does not pass the real address on (the K3s default does this). Limits per
    address are then shared by everybody and the audit trail cannot tell visitors apart - worth one loud line.
    """
    global _hidden_address_reported
    if _hidden_address_reported or not settings.is_production:
        return
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if any(address.version == network.version and address in network for network in _INTERNAL_NETWORKS):
        _hidden_address_reported = True
        logger.warning(
            "Visitors reach the API with the private address %s: the ingress / load balancer is not passing the real "
            "visitor address. Per-address limits are shared by all visitors and the audit log shows this address "
            "for everyone. See SECURITY.md, section 'Real visitor addresses'.", ip)


def get_client_ip(request: Request) -> str:
    """Client IP honouring only the configured number of trusted proxies (X-Forwarded-For can be spoofed)."""
    hops = max(0, settings.FORWARDED_ALLOW_HOPS)
    forwarded = request.headers.get("x-forwarded-for")
    ip = request.client.host if request.client else "unknown"
    if hops and forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            ip = parts[max(0, len(parts) - hops)][:64]
    _report_hidden_visitor_address(ip)
    return ip


@dataclass
class AuthContext:
    user: User
    user_id: str
    email: str
    tenant_id: str
    role: str
    permissions: Dict[str, bool]
    ip: str
    user_agent: str
    mfa_authenticated: bool = False
    pending_actions: Dict[str, bool] = field(default_factory=dict)

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"

    @property
    def rank(self) -> int:
        return ROLE_RANK.get(self.role, 0)

    @property
    def display_name(self) -> str:
        return self.user.full_name

    def has(self, permission: str) -> bool:
        if self.role in ("super_admin", "company_admin"):
            return permission != "companies_manage" or self.is_super_admin
        return bool(self.permissions.get(permission))


async def _tenant_status(tenant_id: str) -> Optional[str]:
    cached = _TENANT_CACHE.get(tenant_id)
    if cached and time.monotonic() - cached[1] < _TENANT_CACHE_TTL:
        return cached[0]
    tenant = await get_document_by_id(Tenant, tenant_id)
    value = (tenant.status or "ACTIVE").upper() if tenant else None
    _TENANT_CACHE[tenant_id] = (value or "MISSING", time.monotonic())
    return value


def invalidate_tenant_cache(tenant_id: str) -> None:
    _TENANT_CACHE.pop(tenant_id, None)


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def pending_actions_for(user: User, mfa_authenticated: bool) -> Dict[str, bool]:
    actions: Dict[str, bool] = {}
    if user.must_change_password:
        actions["must_change_password"] = True
    if user.role in settings.mfa_required_roles and not user.mfa_enabled:
        actions["mfa_enrollment_required"] = True
    return actions


async def _authenticate(request: Request) -> AuthContext:
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized()
    try:
        claims = decode_token(token.strip(), "access")
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Session expired")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid token")

    user = await get_document_by_id(User, claims.get("sub"))
    if not user or not user.is_active:
        raise _unauthorized("Account is not active")
    if int(claims.get("ver", -1)) != int(user.token_version or 0):
        raise _unauthorized("Session has been revoked")
    if claims.get("tid") != user.tenant_id or claims.get("role") != user.role:
        raise _unauthorized("Session no longer valid")

    # the access token is bound to its refresh-session family: logout / revocation is effective immediately
    family = claims.get("sid")
    alive = family and await RefreshSession.find_one(
        {"family_id": family, "user_id": str(user.id), "revoked_at": None, "expires_at": {"$gt": utcnow()}}
    )
    if not alive:
        raise _unauthorized("Session ended")

    if user.role != "super_admin":
        tenant_state = await _tenant_status(user.tenant_id)
        if tenant_state is None:
            raise _unauthorized("Company account not found")
        if tenant_state in INACTIVE_TENANT_STATUSES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your company account is suspended. Contact the platform administrator.")

    mfa_ok = "otp" in (claims.get("amr") or [])
    if user.mfa_enabled and not mfa_ok:
        raise _unauthorized("Two-factor verification required")
    return AuthContext(
        user=user,
        user_id=str(user.id),
        email=str(user.email),
        tenant_id=user.tenant_id,
        role=user.role,
        permissions=effective_permissions(user.role, user.permissions),
        ip=get_client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        mfa_authenticated=mfa_ok,
        pending_actions=pending_actions_for(user, mfa_ok),
    )


async def get_current_user_allow_pending(request: Request) -> AuthContext:
    """Authenticated user who may still have to change password / enrol 2FA (account endpoints only)."""
    ctx = await _authenticate(request)
    request.state.auth = ctx
    return ctx


async def get_current_user(ctx: AuthContext = Depends(get_current_user_allow_pending)) -> AuthContext:
    if ctx.pending_actions.get("must_change_password"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password change required before continuing.")
    if ctx.pending_actions.get("mfa_enrollment_required"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Two-factor authentication must be enabled for your role before continuing.")
    return ctx


def require_permission(*permissions: str, any_of: bool = False) -> Callable:
    async def _checker(ctx: AuthContext = Depends(get_current_user)) -> AuthContext:
        checks = [ctx.has(p) for p in permissions]
        allowed = any(checks) if any_of else all(checks)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to perform this action.")
        return ctx

    return _checker


def require_roles(*roles: str) -> Callable:
    async def _checker(ctx: AuthContext = Depends(get_current_user)) -> AuthContext:
        if ctx.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this resource.")
        return ctx

    return _checker


async def resolve_tenant_id(ctx: AuthContext, requested: Optional[str] = None) -> str:
    """
    Returns the tenant the request operates on - always the caller's own company.
    The tenant is taken from the verified session, never from client input. A mismatching
    tenant_id in the request is rejected and recorded as a cross-tenant access attempt.
    Platform administrators have no access to company business data (least privilege);
    they use the dedicated /super-admin endpoints.
    """
    if ctx.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Platform administrators do not have access to company business data.")
    if requested and requested != ctx.tenant_id:
        from app.core.audit import audit

        await audit("security.cross_tenant_attempt", ctx=ctx, status="failure", details={"requested_tenant": requested[:64]})
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to another company's data is not allowed.")
    return ctx.tenant_id


def scoped_assignee(ctx: AuthContext, requested: Optional[str]) -> Optional[str]:
    """Users without 'leads_view_all' only ever see their own leads."""
    if ctx.has("leads_view_all"):
        return requested if requested and requested != "all" else None
    return ctx.user_id

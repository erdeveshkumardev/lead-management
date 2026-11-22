import logging
from typing import Any, Dict, Optional

from fastapi import Request

from app.core.request_context import get_request_id
from app.models.audit_log import AuditLog

logger = logging.getLogger("app.audit")

_SENSITIVE = ("password", "secret", "token", "key", "otp", "code")


def _scrub(details: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for k, v in (details or {}).items():
        if any(s in k.lower() for s in _SENSITIVE):
            clean[k] = "[redacted]"
        elif isinstance(v, (str, int, float, bool)) or v is None:
            clean[k] = v if not isinstance(v, str) else v[:500]
        else:
            clean[k] = str(v)[:500]
    return clean


async def audit(
    action: str,
    *,
    ctx: Any = None,
    request: Optional[Request] = None,
    tenant_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    status: str = "success",
    details: Optional[Dict[str, Any]] = None,
    actor_id: Optional[str] = None,
    actor_email: Optional[str] = None,
    actor_role: Optional[str] = None,
) -> None:
    """Writes an audit event. Never raises (auditing must not break the business operation)."""
    try:
        ip = user_agent = None
        if ctx is not None:
            actor_id = actor_id or ctx.user_id
            actor_email = actor_email or ctx.email
            actor_role = actor_role or ctx.role
            tenant_id = tenant_id or (ctx.tenant_id if ctx.tenant_id != "system" else None)
            ip, user_agent = ctx.ip, ctx.user_agent
        if request is not None:
            from app.core.deps import get_client_ip  # local import to avoid a cycle

            ip = ip or get_client_ip(request)
            user_agent = user_agent or (request.headers.get("user-agent") or "")[:300]
        await AuditLog(
            tenant_id=tenant_id,
            actor_id=actor_id,
            actor_email=actor_email,
            actor_role=actor_role,
            action=action,
            status=status,
            entity_type=entity_type,
            entity_id=entity_id,
            ip=ip,
            user_agent=user_agent,
            request_id=get_request_id(),
            details=_scrub(details),
        ).insert()
        logger.info("audit action=%s status=%s tenant=%s actor=%s entity=%s:%s",
                    action, status, tenant_id, actor_id, entity_type, entity_id)
    except Exception:  # pragma: no cover
        logger.exception("Failed to write audit log for action=%s", action)

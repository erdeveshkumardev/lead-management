from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

from app.core.deps import AuthContext, require_permission, resolve_tenant_id
from app.core.validators import safe_regex
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/audit", tags=["Audit Trail"])


@router.get("/logs")
async def company_audit_logs(
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    ctx: AuthContext = Depends(require_permission("audit_view")),
):
    """Security & activity trail of the caller's own company (who did what, when and from where)."""
    tid = await resolve_tenant_id(ctx)
    query: Dict[str, Any] = {"tenant_id": tid}
    if action:
        query["action"] = {"$regex": "^" + safe_regex(action, 60)}
    if actor_id:
        query["actor_id"] = actor_id
    if status in ("success", "failure"):
        query["status"] = status
    items = await AuditLog.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
    return {"total": await AuditLog.find(query).count(), "items": items}

from datetime import datetime
from typing import Any, Dict, Optional

from beanie import Document
from pydantic import Field


class AuditLog(Document):
    """Append-only security & business audit trail."""
    tenant_id: Optional[str] = None
    actor_id: Optional[str] = None
    actor_email: Optional[str] = None
    actor_role: Optional[str] = None
    action: str
    status: str = "success"  # success | failure
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    request_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "audit_logs"
        indexes = [
            [("tenant_id", 1), ("created_at", -1)],
            [("action", 1), ("created_at", -1)],
            [("actor_id", 1), ("created_at", -1)],
        ]

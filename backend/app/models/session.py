from datetime import datetime
from typing import Optional

from beanie import Document, Indexed
from pydantic import Field


class RefreshSession(Document):
    """Server-side record of a refresh token (only the SHA-256 hash is stored). Rotated on every use."""
    user_id: Indexed(str)
    tenant_id: str
    token_hash: Indexed(str, unique=True)
    family_id: Indexed(str)
    mfa: bool = False
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: Optional[datetime] = None
    expires_at: datetime
    revoked_at: Optional[datetime] = None
    revoked_reason: Optional[str] = None
    replaced_by: Optional[str] = None

    class Settings:
        name = "refresh_sessions"

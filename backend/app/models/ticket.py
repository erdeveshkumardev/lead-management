from datetime import datetime
from typing import List, Optional
from beanie import Document, Indexed
from pydantic import BaseModel, Field


class TicketMessage(BaseModel):
    message_id: str
    sender_id: str
    sender_name: str
    sender_role: str  # "client", "super_admin", "support"
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SupportTicket(Document):
    ticket_number: Indexed(str)  # e.g. "TCK-2026-00001"
    tenant_id: Indexed(str)
    company_name: str  # Auto-captured from Company / Tenant
    user_id: str
    user_name: str
    user_email: Optional[str] = None
    user_phone: Optional[str] = None
    user_role: str  # "company_admin", "staff", "manager", "super_admin"

    category: str = "general_bug"  # "webhooks", "billing", "whatsapp_sms", "leads", "team_access", "general_bug"
    priority: str = "MEDIUM"  # "LOW", "MEDIUM", "HIGH", "URGENT"
    status: str = "OPEN"  # "OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED", "CLOSED"

    subject: str
    description: str
    context_page: Optional[str] = None  # e.g. "/settings", "/invoices", "/leads"

    messages: List[TicketMessage] = Field(default_factory=list)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
    resolved_by_name: Optional[str] = None
    resolution_notes: Optional[str] = None

    class Settings:
        name = "support_tickets"
        indexes = [
            [("tenant_id", 1), ("status", 1)],
            [("created_at", -1)],
            [("ticket_number", 1)]
        ]

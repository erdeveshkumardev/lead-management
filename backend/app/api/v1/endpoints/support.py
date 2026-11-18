from datetime import datetime
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.database import get_document_by_id
from app.models.ticket import SupportTicket, TicketMessage
from app.models.tenant import Tenant
from app.models.counter import SequenceCounter

router = APIRouter(prefix="/support", tags=["Support & Helpdesk"])


class CreateTicketRequest(BaseModel):
    tenant_id: str
    user_id: str
    user_name: str
    user_email: Optional[str] = None
    user_phone: Optional[str] = None
    user_role: str = "staff"
    category: str = "general_bug"
    priority: str = "MEDIUM"
    subject: str
    description: str
    context_page: Optional[str] = None
    attachments: List[str] = Field(default_factory=list)


class TicketReplyRequest(BaseModel):
    sender_id: str
    sender_name: str
    sender_role: str  # "client", "super_admin", "support"
    message: str
    attachments: List[str] = Field(default_factory=list)


class UpdateTicketStatusRequest(BaseModel):
    status: str  # "OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED", "CLOSED"
    resolved_by_name: Optional[str] = None
    resolution_notes: Optional[str] = None


async def get_next_ticket_number() -> str:
    """
    Generates atomic sequential ticket number: TCK-YYYY-00001
    """
    year_str = str(datetime.utcnow().year)
    counter_id = f"ticket_seq_{year_str}"

    counter = await SequenceCounter.find_one(SequenceCounter.id == counter_id)
    if not counter:
        counter = SequenceCounter(
            id=counter_id,
            tenant_id="global",
            counter_type="support_ticket",
            financial_year=year_str,
            seq=1
        )
        await counter.insert()
        seq = 1
    else:
        counter.seq += 1
        await counter.save()
        seq = counter.seq

    return f"TCK-{year_str}-{seq:05d}"


@router.post("/tickets", status_code=status.HTTP_201_CREATED)
async def create_support_ticket(payload: CreateTicketRequest):
    """
    Creates a new support ticket with AUTOMATIC company name & user metadata tagging.
    """
    # 1. Automatic Company Name lookup
    company_name = "Client Company"
    tenant = await get_document_by_id(Tenant, payload.tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": payload.tenant_id}, {"company_name": payload.tenant_id}]})
    if tenant and tenant.company_name:
        company_name = tenant.company_name

    ticket_number = await get_next_ticket_number()

    # 2. First message in conversation thread
    initial_msg = TicketMessage(
        message_id=f"MSG_{int(datetime.utcnow().timestamp())}",
        sender_id=payload.user_id,
        sender_name=payload.user_name,
        sender_role="client",
        message=payload.description,
        attachments=payload.attachments,
        created_at=datetime.utcnow()
    )

    ticket = SupportTicket(
        ticket_number=ticket_number,
        tenant_id=str(tenant.id) if tenant else payload.tenant_id,
        company_name=company_name,
        user_id=payload.user_id,
        user_name=payload.user_name,
        user_email=payload.user_email,
        user_phone=payload.user_phone,
        user_role=payload.user_role,
        category=payload.category,
        priority=payload.priority.upper(),
        status="OPEN",
        subject=payload.subject.strip(),
        description=payload.description.strip(),
        context_page=payload.context_page,
        attachments=payload.attachments,
        messages=[initial_msg],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    await ticket.insert()

    # Convert to response dictionary containing top-level fields & _id for frontend compatibility
    ticket_dict = ticket.dict()
    ticket_dict["_id"] = str(ticket.id)

    return {
        "status": "success",
        "message": f"Support ticket {ticket.ticket_number} created successfully",
        **ticket_dict,
        "ticket": ticket
    }


@router.get("/tickets")
async def list_support_tickets(
    tenant_id: Optional[str] = None,
    user_role: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50
):
    """
    Returns list of support tickets.
    - If user is Company Admin / Staff: returns only tickets for that company.
    - If Super Admin: returns platform-wide tickets across all companies.
    """
    query: Dict[str, Any] = {}

    # Super Admin can see all companies' tickets, or filter by specific tenant_id
    if user_role != "super_admin" or tenant_id:
        if tenant_id and tenant_id != "all":
            # Match tenant ID or mongo string
            tenant = await get_document_by_id(Tenant, tenant_id)
            if not tenant:
                tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
            allowed_tenant_ids = [tenant_id]
            if tenant:
                allowed_tenant_ids.append(str(tenant.id))
            query["tenant_id"] = {"$in": allowed_tenant_ids}

    if status and status != "all":
        query["status"] = status.upper()

    if priority and priority != "all":
        query["priority"] = priority.upper()

    if category and category != "all":
        query["category"] = category

    if search:
        search_regex = {"$regex": search, "$options": "i"}
        query["$or"] = [
            {"subject": search_regex},
            {"description": search_regex},
            {"ticket_number": search_regex},
            {"company_name": search_regex},
            {"user_name": search_regex}
        ]

    total = await SupportTicket.find(query).count()
    raw_tickets = await SupportTicket.find(query).sort("-updated_at").skip(skip).limit(limit).to_list()

    items = []
    for t in raw_tickets:
        td = t.dict()
        td["_id"] = str(t.id)
        items.append(td)

    return items


@router.get("/tickets/{ticket_id}")
async def get_support_ticket_detail(ticket_id: str, tenant_id: Optional[str] = None):
    """
    Fetches single ticket with full message thread.
    """
    ticket = await get_document_by_id(SupportTicket, ticket_id)
    if not ticket:
        ticket = await SupportTicket.find_one(SupportTicket.ticket_number == ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Support ticket not found")

    td = ticket.dict()
    td["_id"] = str(ticket.id)
    return td


@router.post("/tickets/{ticket_id}/reply")
async def reply_to_ticket(
    ticket_id: str,
    payload: TicketReplyRequest,
    tenant_id: Optional[str] = None
):
    """
    Adds a message to the ticket conversation thread.
    Automatically transitions OPEN tickets to IN_PROGRESS when Super Admin replies.
    """
    ticket = await get_document_by_id(SupportTicket, ticket_id)
    if not ticket:
        ticket = await SupportTicket.find_one(SupportTicket.ticket_number == ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Support ticket not found")

    new_msg = TicketMessage(
        message_id=f"MSG_{int(datetime.utcnow().timestamp())}_{len(ticket.messages) + 1}",
        sender_id=payload.sender_id,
        sender_name=payload.sender_name,
        sender_role=payload.sender_role,
        message=payload.message.strip(),
        attachments=payload.attachments,
        created_at=datetime.utcnow()
    )

    ticket.messages.append(new_msg)
    ticket.updated_at = datetime.utcnow()

    # If support admin replied, transition OPEN -> IN_PROGRESS
    if payload.sender_role in ["super_admin", "support"] and ticket.status == "OPEN":
        ticket.status = "IN_PROGRESS"

    # If client replied and ticket was waiting for client, mark IN_PROGRESS
    if payload.sender_role == "client" and ticket.status in ["WAITING_FOR_CLIENT", "RESOLVED"]:
        ticket.status = "IN_PROGRESS"

    await ticket.save()

    ticket_dict = ticket.dict()
    ticket_dict["_id"] = str(ticket.id)

    return {
        "status": "success",
        "message": "Reply posted successfully",
        **ticket_dict,
        "ticket": ticket
    }


@router.patch("/tickets/{ticket_id}/status")
async def update_ticket_status(ticket_id: str, payload: UpdateTicketStatusRequest):
    """
    Updates the lifecycle status of a ticket (e.g. IN_PROGRESS, RESOLVED, CLOSED).
    """
    ticket = await get_document_by_id(SupportTicket, ticket_id)
    if not ticket:
        ticket = await SupportTicket.find_one(SupportTicket.ticket_number == ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Support ticket not found")

    new_status = payload.status.upper()
    ticket.status = new_status
    ticket.updated_at = datetime.utcnow()

    if new_status in ["RESOLVED", "CLOSED"]:
        ticket.resolved_at = datetime.utcnow()
        if payload.resolved_by_name:
            ticket.resolved_by_name = payload.resolved_by_name
        if payload.resolution_notes:
            ticket.resolution_notes = payload.resolution_notes
    else:
        ticket.resolved_at = None

    await ticket.save()
    ticket_dict = ticket.dict()
    ticket_dict["_id"] = str(ticket.id)

    return {
        "status": "success",
        "message": f"Ticket status updated to {new_status}",
        **ticket_dict,
        "ticket": ticket
    }


@router.get("/stats")
async def get_support_stats(tenant_id: Optional[str] = None, user_role: Optional[str] = None):
    """
    Returns high-level statistics for support dashboard:
    Total, Open, In Progress, Urgent, and Resolved.
    """
    query: Dict[str, Any] = {}
    if user_role != "super_admin" or tenant_id:
        if tenant_id and tenant_id != "all":
            tenant = await get_document_by_id(Tenant, tenant_id)
            if not tenant:
                tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})
            allowed_tenant_ids = [tenant_id]
            if tenant:
                allowed_tenant_ids.append(str(tenant.id))
            query["tenant_id"] = {"$in": allowed_tenant_ids}

    total = await SupportTicket.find(query).count()
    open_count = await SupportTicket.find({**query, "status": "OPEN"}).count()
    in_progress = await SupportTicket.find({**query, "status": "IN_PROGRESS"}).count()
    urgent_count = await SupportTicket.find({**query, "priority": "URGENT", "status": {"$nin": ["RESOLVED", "CLOSED"]}}).count()
    resolved_count = await SupportTicket.find({**query, "status": {"$in": ["RESOLVED", "CLOSED"]}}).count()

    return {
        "total_tickets": total,
        "open_tickets": open_count,
        "in_progress_tickets": in_progress,
        "urgent_tickets": urgent_count,
        "resolved_tickets": resolved_count
    }

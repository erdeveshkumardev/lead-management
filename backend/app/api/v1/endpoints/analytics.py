from typing import Optional, List, Dict, Any
from fastapi import APIRouter
from app.core.database import get_document_by_id
from app.models.tenant import Tenant
from app.models.lead import Lead
from app.models.invoice import Invoice
from app.models.user import User

router = APIRouter(prefix="/analytics", tags=["Dashboard Analytics"])


@router.get("/dashboard")
async def get_dashboard_metrics(tenant_id: str):
    """
    Returns real-time analytics for the specific company dashboard:
    - Total leads, converted leads, win rate %
    - Channel breakdown & pipeline stage summary
    - Sales staff performance & lead status breakdown
    - Recent 10 inquiries list
    - Financial billing metrics
    """
    tenant = await get_document_by_id(Tenant, tenant_id)
    if not tenant:
        tenant = await Tenant.find_one({"$or": [{"slug": tenant_id}, {"company_name": tenant_id}]})

    allowed_ids = [tenant_id]
    if tenant:
        allowed_ids.append(str(tenant.id))
        if tenant.slug in ["apex-machineries", "demo_tenant_01", None] or tenant.company_name == "Apex Machineries Pvt Ltd":
            allowed_ids.append("demo_tenant_01")

    query = {"tenant_id": {"$in": allowed_ids}}

    # Total Leads
    total_leads = await Lead.find(query).count()

    # Leads by Stage & Source
    leads = await Lead.find(query).sort("-created_at").to_list()
    stage_breakdown = {}
    source_breakdown = {}
    converted_count = 0

    for l in leads:
        st = l.stage or "NEW"
        stage_breakdown[st] = stage_breakdown.get(st, 0) + 1

        src = l.source or "manual"
        source_breakdown[src] = source_breakdown.get(src, 0) + 1

        if l.conversion_info and l.conversion_info.is_converted:
            converted_count += 1

    conversion_rate = (
        round((converted_count / total_leads) * 100, 1) if total_leads > 0 else 0.0
    )

    # Sales Staff-wise Lead Summary
    users = await User.find({"tenant_id": {"$in": allowed_ids}}).to_list()
    staff_dict: Dict[str, Dict[str, Any]] = {}

    for u in users:
        staff_dict[str(u.id)] = {
            "staff_id": str(u.id),
            "staff_name": u.full_name,
            "role": u.role,
            "designation": getattr(u, "designation", None) or u.role.replace("_", " ").title(),
            "department": getattr(u, "department", None) or "Sales & Business Development",
            "total_leads": 0,
            "stages": {},
            "categories": {},
            "converted_count": 0,
            "total_deal_value": 0.0,
        }

    unassigned_key = "unassigned"
    staff_dict[unassigned_key] = {
        "staff_id": "unassigned",
        "staff_name": "Unassigned (Open Pool)",
        "role": "pool",
        "designation": "Unallocated Leads",
        "department": "Inbound Queue",
        "total_leads": 0,
        "stages": {},
        "categories": {},
        "converted_count": 0,
        "total_deal_value": 0.0,
    }

    for l in leads:
        assigned_id = l.assigned_to_user_id or unassigned_key
        if assigned_id not in staff_dict:
            staff_dict[assigned_id] = {
                "staff_id": assigned_id,
                "staff_name": l.assigned_to_user_name or "Staff Member",
                "role": "staff",
                "designation": "Sales Executive",
                "department": "Sales",
                "total_leads": 0,
                "stages": {},
                "categories": {},
                "converted_count": 0,
                "total_deal_value": 0.0,
            }

        s_entry = staff_dict[assigned_id]
        s_entry["total_leads"] += 1
        s_entry["total_deal_value"] += (l.deal_value or 0.0)

        st = l.stage or "NEW"
        s_entry["stages"][st] = s_entry["stages"].get(st, 0) + 1

        cat = (l.category or "WARM").upper()
        s_entry["categories"][cat] = s_entry["categories"].get(cat, 0) + 1

        if l.conversion_info and l.conversion_info.is_converted:
            s_entry["converted_count"] += 1

    staff_summary_list = sorted(
        staff_dict.values(),
        key=lambda x: (x["staff_id"] == "unassigned", -x["total_leads"])
    )

    # Recent Leads (Top 10)
    recent_leads = leads[:10]

    # Billing Financials
    invoices = await Invoice.find(
        {"tenant_id": {"$in": allowed_ids}, "document_type": "TAX_INVOICE"}
    ).to_list()

    total_billed = 0.0
    total_paid = 0.0
    total_pending = 0.0

    for inv in invoices:
        total_billed += inv.financials.grand_total
        total_paid += inv.financials.paid_amount
        total_pending += inv.financials.balance_due

    return {
        "leads_metrics": {
            "total_leads": total_leads,
            "converted_leads": converted_count,
            "conversion_rate_percentage": conversion_rate,
            "stage_breakdown": stage_breakdown,
            "source_breakdown": source_breakdown,
        },
        "staff_summary": staff_summary_list,
        "recent_leads": recent_leads,
        "financial_metrics": {
            "total_invoices_count": len(invoices),
            "total_billed_amount": float(total_billed),
            "total_collected_amount": float(total_paid),
            "total_pending_amount": float(total_pending),
        }
    }

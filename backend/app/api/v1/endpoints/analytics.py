from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from app.core.deps import AuthContext, get_current_user, resolve_tenant_id, scoped_assignee
from app.core.gst import to_decimal
from app.models.invoice import Invoice
from app.models.lead import Lead
from app.models.user import User
from app.services.lead_service import lead_base_query, serialize_leads

router = APIRouter(prefix="/analytics", tags=["Dashboard Analytics"])

LIST_PROJECTION_EXCLUDE = {"raw_payload": 0, "timeline": 0, "follow_ups": 0}


def _f(value: Any) -> float:
    return float(to_decimal(value))


async def _group(collection, match: Dict[str, Any], group_id: Any, extra: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    stage = {"_id": group_id, "count": {"$sum": 1}}
    stage.update(extra or {})
    return [row async for row in collection.aggregate([{"$match": match}, {"$group": stage}])]


@router.get("/dashboard")
async def get_dashboard_metrics(tenant_id: Optional[str] = None, assigned_to: Optional[str] = None,
                                ctx: AuthContext = Depends(get_current_user)):
    """
    Company dashboard computed with database aggregations (no full collection scans in Python).
    Users without 'leads_view_all' only ever see their own numbers.
    """
    tid = await resolve_tenant_id(ctx, tenant_id)
    assignee = scoped_assignee(ctx, assigned_to)
    match = lead_base_query(tid)
    if assignee == "unassigned":
        match["assigned_to_user_id"] = {"$in": [None, ""]}
    elif assignee:
        match["assigned_to_user_id"] = assignee

    leads = Lead.get_motor_collection()
    converted_expr = {"$sum": {"$cond": [{"$eq": ["$conversion_info.is_converted", True]}, 1, 0]}}

    stage_rows = await _group(leads, match, "$stage")
    source_rows = await _group(leads, match, "$source")
    staff_rows = await _group(
        leads, match, {"staff": "$assigned_to_user_id", "stage": "$stage", "category": "$category"},
        {"converted": converted_expr, "deal_value": {"$sum": "$deal_value"}},
    )
    total_leads = sum(r["count"] for r in stage_rows)
    converted = sum(r.get("converted", 0) for r in staff_rows)

    users = await User.find({"tenant_id": tid}).to_list()
    staff: Dict[str, Dict[str, Any]] = {}

    def entry(staff_id: str, name: str, role: str, designation: str, department: str) -> Dict[str, Any]:
        return {"staff_id": staff_id, "staff_name": name, "role": role, "designation": designation,
                "department": department, "total_leads": 0, "stages": {}, "categories": {},
                "converted_count": 0, "total_deal_value": 0.0}

    for u in users:
        if not u.is_active:
            continue
        staff[str(u.id)] = entry(str(u.id), u.full_name, u.role,
                                 u.designation or u.role.replace("_", " ").title(),
                                 u.department or "Sales & Business Development")
    staff["unassigned"] = entry("unassigned", "Unassigned (Open Pool)", "pool", "Unallocated Leads", "Inbound Queue")
    names = {str(u.id): u.full_name for u in users}

    for row in staff_rows:
        key = row["_id"] or {}
        sid = key.get("staff") or "unassigned"
        if sid not in staff:
            staff[sid] = entry(sid, names.get(sid, "Former Team Member"), "staff", "Sales Executive", "Sales")
        item = staff[sid]
        item["total_leads"] += row["count"]
        item["converted_count"] += row.get("converted", 0)
        item["total_deal_value"] += _f(row.get("deal_value"))
        stage = key.get("stage") or "NEW"
        item["stages"][stage] = item["stages"].get(stage, 0) + row["count"]
        category = (key.get("category") or "WARM").upper()
        item["categories"][category] = item["categories"].get(category, 0) + row["count"]

    if assignee:
        staff_summary = [s for s in staff.values() if s["staff_id"] == assignee]
    else:
        staff_summary = sorted(staff.values(), key=lambda s: (s["staff_id"] == "unassigned", -s["total_leads"]))

    recent = await Lead.find(match).sort("-created_at").limit(10).to_list()

    financial = {"total_invoices_count": 0, "total_billed_amount": 0.0, "total_collected_amount": 0.0, "total_pending_amount": 0.0}
    if ctx.has("billing_view"):
        inv_match: Dict[str, Any] = {"tenant_id": tid, "document_type": "TAX_INVOICE", "payment_status": {"$ne": "CANCELLED"}}
        if not ctx.has("leads_view_all"):
            inv_match["created_by_id"] = ctx.user_id
        rows = await _group(Invoice.get_motor_collection(), inv_match, None, {
            "billed": {"$sum": "$financials.grand_total"},
            "paid": {"$sum": "$financials.paid_amount"},
            "pending": {"$sum": "$financials.balance_due"},
        })
        if rows:
            financial = {
                "total_invoices_count": rows[0]["count"],
                "total_billed_amount": _f(rows[0].get("billed")),
                "total_collected_amount": _f(rows[0].get("paid")),
                "total_pending_amount": _f(rows[0].get("pending")),
            }

    return {
        "leads_metrics": {
            "total_leads": total_leads,
            "converted_leads": converted,
            "conversion_rate_percentage": round(converted / total_leads * 100, 1) if total_leads else 0.0,
            "stage_breakdown": {(r["_id"] or "NEW"): r["count"] for r in stage_rows},
            "source_breakdown": {(r["_id"] or "manual"): r["count"] for r in source_rows},
        },
        "staff_summary": staff_summary,
        "recent_leads": serialize_leads(recent, summary=True),
        "financial_metrics": financial,
    }

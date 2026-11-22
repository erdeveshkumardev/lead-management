from datetime import datetime
from typing import Any, Dict, List
from beanie import Document, Indexed
from pydantic import BaseModel, Field


class GlobalMasterItem(Document):
    """
    Super Admin Level Masters:
    - "country": Country List (India, etc.)
    - "state": Indian States with 2-digit GST State Codes (Gujarat 24, Maharashtra 27, etc.)
    - "city": Major commercial and industrial cities
    - "industry": Business sector templates (Manufacturing, Real Estate, Education, etc.)
    """
    master_type: Indexed(str)  # "country", "state", "city", "industry"
    code: str  # e.g. "IN", "24", "AMD", "manufacturing"
    name: str  # e.g. "India", "Gujarat", "Ahmedabad", "B2B Manufacturing"
    extra_data: Dict[str, Any] = Field(default_factory=dict)  # e.g. {"gst_code": "24", "country": "India"}
    is_active: bool = True
    display_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "global_masters"


class CategoryItem(BaseModel):
    id: str  # "HOT", "WARM", "COLD"
    label: str  # "Hot (Urgent Closing)", "Warm", "Cold"
    color: str = "rose"  # rose, amber, blue
    sla_hours: int = 24


class FollowUpItem(BaseModel):
    id: str  # "call", "whatsapp", "email", "meeting", "site_visit"
    label: str  # "Phone Call", "WhatsApp Message", "Site Visit"
    icon: str = "phone"


class CompanyMasters(BaseModel):
    """
    Company Level Masters:
    Managed by Company Admin for their sales team operations.
    """
    lead_categories: List[CategoryItem] = Field(default_factory=lambda: [
        CategoryItem(id="HOT", label="Hot (High Priority / Immediate Close)", color="rose", sla_hours=4),
        CategoryItem(id="WARM", label="Warm (Interested / In Discussion)", color="amber", sla_hours=24),
        CategoryItem(id="COLD", label="Cold (Future Follow-up / Nurture)", color="blue", sla_hours=72),
    ])
    lost_reasons: List[str] = Field(default_factory=lambda: [
        "Budget Issue / Price Too High",
        "Competitor Chosen",
        "Invalid Inquiry / Wrong Number",
        "Not Interested / Project Canceled",
        "Delivery Timeline Mismatch",
        "Product Specifications Differ",
        "Out of Service Area"
    ])
    follow_up_types: List[FollowUpItem] = Field(default_factory=lambda: [
        FollowUpItem(id="call", label="Phone Call", icon="phone"),
        FollowUpItem(id="whatsapp", label="WhatsApp Message", icon="message"),
        FollowUpItem(id="email", label="Email Quotation / Spec", icon="mail"),
        FollowUpItem(id="meeting", label="In-Person Meeting", icon="users"),
        FollowUpItem(id="site_visit", label="Site / Factory Visit", icon="building"),
    ])
    campaigns: List[str] = Field(default_factory=lambda: [
        "IndiaMART BuyLeads",
        "TradeIndia Inquiries",
        "Meta Lead Ads Campaign",
        "Google Search Ads",
        "Website Organic Inquiries",
        "Trade Fair / Exhibition"
    ])
    departments: List[str] = Field(default_factory=lambda: [
        "Sales & Business Development",
        "Presales & Estimation",
        "Accounts & Billing",
        "Technical Support",
        "Management"
    ])
    designations: List[str] = Field(default_factory=lambda: [
        "Sales Executive",
        "Senior BDA",
        "Team Leader",
        "Sales Manager",
        "General Manager"
    ])

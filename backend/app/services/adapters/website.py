from typing import Dict, Any
from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO


class WebsiteAdapter(BaseLeadAdapter):
    """
    Adapter for Website Forms, Landing Pages, and custom Contact Us forms.
    """
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        name = raw_data.get("name") or raw_data.get("full_name") or "Website Visitor"
        phone = raw_data.get("phone") or raw_data.get("mobile") or raw_data.get("contact_number") or ""
        email = raw_data.get("email")
        company = raw_data.get("company") or raw_data.get("company_name")
        city = raw_data.get("city")
        state = raw_data.get("state")
        product = raw_data.get("product") or raw_data.get("service") or raw_data.get("subject")
        message = raw_data.get("message") or raw_data.get("inquiry")
        custom_fields = raw_data.get("custom_fields") or {}

        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="website",
            source_lead_id=str(raw_data.get("form_id") or raw_data.get("submission_id") or ""),
            full_name=str(name).strip(),
            phone=str(phone).strip(),
            email=str(email).strip() if email else None,
            company_name=str(company).strip() if company else None,
            city=str(city).strip() if city else None,
            state=str(state).strip() if state else None,
            product_inquired=str(product).strip() if product else None,
            inquiry_message=str(message).strip() if message else None,
            custom_fields=custom_fields,
            raw_payload=raw_data
        )

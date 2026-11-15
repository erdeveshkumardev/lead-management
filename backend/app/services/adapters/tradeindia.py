from typing import Dict, Any
from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO


class TradeIndiaAdapter(BaseLeadAdapter):
    """
    Adapter for TradeIndia Lead Ingestion API / Webhook.
    """
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        name = raw_data.get("sender_name") or raw_data.get("sender") or raw_data.get("buyer_name") or "TradeIndia Buyer"
        phone = raw_data.get("sender_mobile") or raw_data.get("mobile_no") or raw_data.get("phone") or ""
        email = raw_data.get("sender_email") or raw_data.get("email")
        company = raw_data.get("sender_co") or raw_data.get("sender_company") or raw_data.get("company_name")
        city = raw_data.get("sender_city") or raw_data.get("city")
        state = raw_data.get("sender_state") or raw_data.get("state")
        product = raw_data.get("product_name") or raw_data.get("subject")
        message = raw_data.get("message_details") or raw_data.get("inquiry_message")
        lead_id = str(raw_data.get("inquiry_id") or raw_data.get("lead_id") or "")

        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="tradeindia",
            source_lead_id=lead_id if lead_id else None,
            full_name=name.strip(),
            phone=phone.strip(),
            email=email.strip() if email else None,
            company_name=company.strip() if company else None,
            city=city.strip() if city else None,
            state=state.strip() if state else None,
            product_inquired=product.strip() if product else None,
            inquiry_message=message.strip() if message else None,
            raw_payload=raw_data
        )

from typing import Any, Dict

from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO, first_value


class TradeIndiaAdapter(BaseLeadAdapter):
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        d = raw_data
        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="tradeindia",
            source_lead_id=first_value(d, "rfi_id", "inquiry_id", "lead_id"),
            full_name=first_value(d, "sender_name", "sender", "buyer_name") or "TradeIndia Buyer",
            phone=first_value(d, "sender_mobile", "mobile_no", "phone") or "",
            email=first_value(d, "sender_email", "email"),
            company_name=first_value(d, "sender_co", "sender_company", "company_name"),
            city=first_value(d, "sender_city", "city"),
            state=first_value(d, "sender_state", "state"),
            product_inquired=first_value(d, "product_name", "subject"),
            inquiry_message=first_value(d, "message_details", "message", "inquiry_message"),
            raw_payload=raw_data,
        )

from typing import Any, Dict

from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO, first_value


class JustdialAdapter(BaseLeadAdapter):
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        d = raw_data
        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="justdial",
            source_lead_id=first_value(d, "leadid", "lead_id", "id"),
            full_name=first_value(d, "name", "lead_name") or "Justdial Buyer",
            phone=first_value(d, "mobile", "phone") or "",
            email=first_value(d, "email"),
            company_name=first_value(d, "company", "business_name"),
            city=first_value(d, "city", "area"),
            product_inquired=first_value(d, "category", "service", "product"),
            inquiry_message=first_value(d, "requirement", "notes") or "Lead received from Justdial portal",
            raw_payload=raw_data,
        )

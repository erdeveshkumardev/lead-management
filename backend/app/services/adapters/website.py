from typing import Any, Dict

from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO, first_value

_CONTROL_FIELDS = {"token", "webhook_token", "_render_time", "_timestamp", "_form_loaded_at", "custom_fields"}


class WebsiteAdapter(BaseLeadAdapter):
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        d = {k: v for k, v in raw_data.items() if k not in {"token", "webhook_token"}}
        custom = d.get("custom_fields") if isinstance(d.get("custom_fields"), dict) else {}
        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="website",
            # only a per-submission id is usable for idempotency (a form_id is shared by all submissions)
            source_lead_id=first_value(d, "submission_id", "entry_id"),
            full_name=first_value(d, "name", "full_name", "your-name") or "Website Visitor",
            phone=first_value(d, "phone", "mobile", "contact_number", "your-phone") or "",
            email=first_value(d, "email", "your-email"),
            company_name=first_value(d, "company", "company_name"),
            city=first_value(d, "city"),
            state=first_value(d, "state"),
            gstin=first_value(d, "gstin"),
            product_inquired=first_value(d, "product", "product_inquired", "service", "subject"),
            inquiry_message=first_value(d, "message", "inquiry_message", "inquiry", "your-message"),
            custom_fields=custom,
            raw_payload={k: v for k, v in d.items() if k not in _CONTROL_FIELDS},
        )

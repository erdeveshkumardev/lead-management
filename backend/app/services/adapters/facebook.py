from typing import Dict, Any, List
from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO


class FacebookAdapter(BaseLeadAdapter):
    """
    Adapter for Meta / Facebook Lead Generation Ads.
    Handles both Graph API field_data array format and direct webhook payloads.
    """
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        extracted = {}

        # Meta Graph API field_data format: [{"name": "full_name", "values": ["..."]}]
        if "field_data" in raw_data and isinstance(raw_data["field_data"], list):
            for field in raw_data["field_data"]:
                fname = field.get("name", "").lower()
                fvalues = field.get("values", [])
                if fvalues:
                    extracted[fname] = fvalues[0]
        else:
            extracted = {k.lower(): v for k, v in raw_data.items()}

        name = (
            extracted.get("full_name")
            or extracted.get("name")
            or f"{extracted.get('first_name', '')} {extracted.get('last_name', '')}".strip()
            or "Facebook Lead"
        )
        phone = extracted.get("phone_number") or extracted.get("phone") or extracted.get("mobile") or ""
        email = extracted.get("email")
        company = extracted.get("company_name") or extracted.get("company")
        city = extracted.get("city")
        state = extracted.get("state")
        ad_id = str(raw_data.get("leadgen_id") or raw_data.get("id") or "")

        # Any extra questions asked on the Facebook form become custom_fields
        custom_fields = {}
        standard_keys = {"full_name", "name", "first_name", "last_name", "phone_number", "phone", "mobile", "email", "company_name", "company", "city", "state"}
        for k, v in extracted.items():
            if k not in standard_keys:
                custom_fields[k] = v

        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="facebook",
            source_lead_id=ad_id if ad_id else None,
            full_name=name.strip(),
            phone=str(phone).strip(),
            email=email.strip() if email else None,
            company_name=company.strip() if company else None,
            city=city.strip() if city else None,
            state=state.strip() if state else None,
            inquiry_message=extracted.get("message") or f"Facebook Lead Ad form submission",
            custom_fields=custom_fields,
            raw_payload=raw_data
        )

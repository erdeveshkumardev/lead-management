from typing import Any, Dict, List

from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO

_STANDARD_KEYS = {"full_name", "name", "first_name", "last_name", "phone_number", "phone", "mobile",
                  "email", "company_name", "company", "city", "state", "message", "id", "created_time",
                  "field_data", "leadgen_id", "form_id", "page_id", "ad_id"}


def extract_leadgen_events(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Meta webhook format: {"object":"page","entry":[{"changes":[{"field":"leadgen","value":{...}}]}]}"""
    events: List[Dict[str, Any]] = []
    if not isinstance(payload, dict) or payload.get("object") != "page":
        return events
    for entry in payload.get("entry") or []:
        for change in (entry or {}).get("changes") or []:
            if change.get("field") == "leadgen" and isinstance(change.get("value"), dict):
                events.append(change["value"])
    return events


class FacebookAdapter(BaseLeadAdapter):
    """Parses a Graph API lead object ({"id":..., "field_data":[{"name":..,"values":[..]}]}) or a flat payload."""

    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        extracted: Dict[str, Any] = {}
        if isinstance(raw_data.get("field_data"), list):
            for field in raw_data["field_data"]:
                if not isinstance(field, dict):
                    continue
                name = str(field.get("name", "")).strip().lower()
                values = field.get("values") or []
                if name and values:
                    extracted[name] = values[0] if len(values) == 1 else ", ".join(str(v) for v in values)
        else:
            extracted = {str(k).lower(): v for k, v in raw_data.items()}

        def get(*keys: str) -> str:
            for key in keys:
                value = extracted.get(key)
                if value not in (None, "") and not isinstance(value, (dict, list)):
                    return str(value).strip()
            return ""

        name = get("full_name", "name") or f"{get('first_name')} {get('last_name')}".strip() or "Facebook Lead"
        custom = {k: v for k, v in extracted.items() if k not in _STANDARD_KEYS and not isinstance(v, (dict, list))}
        if raw_data.get("form_id"):
            custom["facebook_form_id"] = str(raw_data.get("form_id"))
        if raw_data.get("ad_id"):
            custom["facebook_ad_id"] = str(raw_data.get("ad_id"))
        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="facebook",
            source_lead_id=str(raw_data.get("id") or raw_data.get("leadgen_id") or "") or None,
            full_name=name,
            phone=get("phone_number", "phone", "mobile"),
            email=get("email") or None,
            company_name=get("company_name", "company") or None,
            city=get("city") or None,
            state=get("state") or None,
            inquiry_message=get("message") or "Facebook Lead Ad form submission",
            custom_fields=custom,
            raw_payload=raw_data,
        )

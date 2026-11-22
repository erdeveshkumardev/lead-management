from typing import Any, Dict, List

from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO, first_value


def extract_indiamart_records(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    IndiaMART Push/Pull APIs wrap leads as {"CODE":200,"STATUS":"SUCCESS","RESPONSE":{...} or [...]}.
    Flat payloads (older integrations / Zapier) are supported as well.
    """
    if not isinstance(payload, dict):
        return []
    # some relays forward IndiaMART's whole request envelope ({"method":..,"url":..,"body":{...}})
    if isinstance(payload.get("body"), dict) and ("RESPONSE" in payload["body"] or "UNIQUE_QUERY_ID" in payload["body"]):
        payload = payload["body"]
    response = payload.get("RESPONSE") or payload.get("response")
    if isinstance(response, dict):
        return [response]
    if isinstance(response, list):
        return [r for r in response if isinstance(r, dict)]
    return [payload]


class IndiaMARTAdapter(BaseLeadAdapter):
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        d = raw_data
        message = first_value(d, "QUERY_MESSAGE", "ENQ_MESSAGE", "message")
        query_type = first_value(d, "QUERY_TYPE")
        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="indiamart",
            source_lead_id=first_value(d, "UNIQUE_QUERY_ID", "QUERY_ID", "query_id"),
            full_name=first_value(d, "SENDER_NAME", "SENDERNAME", "sender_name", "name", "full_name") or "IndiaMART Buyer",
            phone=first_value(d, "SENDER_MOBILE", "MOB", "mobile", "phone", "phone_number", "SENDER_MOBILE_ALT") or "",
            email=first_value(d, "SENDER_EMAIL", "EMAIL", "email", "SENDER_EMAIL_ALT"),
            company_name=first_value(d, "SENDER_COMPANY", "GLUSR_USR_COMPANYNAME", "company", "company_name"),
            city=first_value(d, "SENDER_CITY", "GLUSR_USR_CITY", "city"),
            state=first_value(d, "SENDER_STATE", "GLUSR_USR_STATE", "state"),
            pincode=first_value(d, "SENDER_PINCODE", "pincode"),
            address=first_value(d, "SENDER_ADDRESS", "address"),
            product_inquired=first_value(d, "QUERY_PRODUCT_NAME", "PRODUCT_NAME", "SUBJECT", "product_name", "product"),
            inquiry_message=message,
            custom_fields={k: v for k, v in {
                "indiamart_query_type": query_type,
                "indiamart_query_time": first_value(d, "QUERY_TIME"),
                "indiamart_mcat": first_value(d, "QUERY_MCAT_NAME"),
            }.items() if v},
            raw_payload=raw_data,
        )

from typing import Dict, Any
from app.services.adapters.base import BaseLeadAdapter, StandardLeadDTO


class IndiaMARTAdapter(BaseLeadAdapter):
    """
    Adapter for IndiaMART Push API / Webhook & Pull API CRM listings.
    Standard IndiaMART payload fields:
    - SENDER_NAME / SENDERNAME
    - SENDER_MOBILE / MOB
    - SENDER_EMAIL / EMAIL
    - SENDER_COMPANY / GLUSR_USR_COMPANYNAME
    - SENDER_CITY / SENDER_STATE
    - PRODUCT_NAME / SUBJECT
    - QUERY_MESSAGE / ENQ_MESSAGE
    - UNIQUE_QUERY_ID / QUERY_ID
    """
    def parse_payload(self, raw_data: Dict[str, Any], tenant_id: str) -> StandardLeadDTO:
        # Check standard IndiaMART push/pull fields or generic webhook fields (case-insensitive fallback)
        name = (
            raw_data.get("SENDER_NAME")
            or raw_data.get("SENDERNAME")
            or raw_data.get("sender_name")
            or raw_data.get("name")
            or raw_data.get("full_name")
            or "IndiaMART Buyer"
        )
        raw_phone = (
            raw_data.get("SENDER_MOBILE")
            or raw_data.get("MOB")
            or raw_data.get("mobile")
            or raw_data.get("phone")
            or raw_data.get("phone_number")
            or ""
        )
        phone = str(raw_phone).strip() if raw_phone is not None else ""

        raw_email = raw_data.get("SENDER_EMAIL") or raw_data.get("EMAIL") or raw_data.get("email")
        email = str(raw_email).strip() if raw_email else None

        company = raw_data.get("SENDER_COMPANY") or raw_data.get("GLUSR_USR_COMPANYNAME") or raw_data.get("company") or raw_data.get("company_name")
        city = raw_data.get("SENDER_CITY") or raw_data.get("GLUSR_USR_CITY") or raw_data.get("city")
        state = raw_data.get("SENDER_STATE") or raw_data.get("GLUSR_USR_STATE") or raw_data.get("state")
        product = raw_data.get("PRODUCT_NAME") or raw_data.get("SUBJECT") or raw_data.get("product_name") or raw_data.get("product")
        message = raw_data.get("QUERY_MESSAGE") or raw_data.get("ENQ_MESSAGE") or raw_data.get("message")
        query_id = str(raw_data.get("UNIQUE_QUERY_ID") or raw_data.get("QUERY_ID") or raw_data.get("query_id") or "")

        return StandardLeadDTO(
            tenant_id=tenant_id,
            source="indiamart",
            source_lead_id=query_id if query_id else None,
            full_name=str(name).strip(),
            phone=phone,
            email=email,
            company_name=str(company).strip() if company else None,
            city=str(city).strip() if city else None,
            state=str(state).strip() if state else None,
            product_inquired=str(product).strip() if product else None,
            inquiry_message=str(message).strip() if message else None,
            raw_payload=raw_data
        )

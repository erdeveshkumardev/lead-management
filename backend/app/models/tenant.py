import secrets
from datetime import datetime
from typing import Optional, Dict, Any, List
from beanie import Document, Indexed
from pydantic import BaseModel, Field


def generate_webhook_token() -> str:
    return f"wh_pub_{secrets.token_hex(24)}"


def generate_secret_key() -> str:
    return f"whsec_{secrets.token_hex(32)}"


def generate_verify_token() -> str:
    return f"vt_{secrets.token_hex(16)}"


class BankDetails(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    branch_name: Optional[str] = None
    upi_id: Optional[str] = None


class PipelineStage(BaseModel):
    id: str  # e.g. "NEW", "SITE_VISIT", "SPEC_SHARED"
    label: str  # e.g. "Site Visit Scheduled"
    color: str = "blue"  # blue, amber, indigo, purple, orange, emerald, rose, slate
    order: int = 0


def get_default_pipeline_stages() -> List[PipelineStage]:
    return [
        PipelineStage(id="NEW", label="New Inquiries", color="blue", order=0),
        PipelineStage(id="CONTACTED", label="Contacted", color="amber", order=1),
        PipelineStage(id="DEMO_SCHEDULED", label="Demo / Spec Sent", color="indigo", order=2),
        PipelineStage(id="PROPOSAL_SENT", label="Quotation Sent", color="purple", order=3),
        PipelineStage(id="NEGOTIATION", label="Negotiation", color="orange", order=4),
        PipelineStage(id="WON", label="Won (Invoiced)", color="emerald", order=5),
        PipelineStage(id="LOST", label="Lost", color="slate", order=6),
    ]


class IntegrationConfig(BaseModel):
    """
    Secret fields (api_key, crm_key, secret_key, webhook_token, verify_token) are stored ENCRYPTED
    (see app.core.crypto) and are never returned in clear text except to authorised admins.
    """
    is_enabled: bool = False
    api_key: Optional[str] = None  # e.g. Meta Page Access Token / TradeIndia key
    crm_key: Optional[str] = None  # IndiaMART Pull API key (glusr_crm_key)
    secret_key: Optional[str] = None  # Meta App Secret / website HMAC secret
    account_id: Optional[str] = None
    webhook_token: Optional[str] = None  # inbound webhook authentication token
    verify_token: Optional[str] = None  # Meta webhook verification token
    allowed_domains: List[str] = Field(default_factory=list)
    auto_sync: bool = True
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    status: str = "Not Configured"  # "Connected", "Configured", "Error", "Not Configured"


def get_default_website_integration() -> IntegrationConfig:
    """Website lead capture is ready out of the box; its credentials are generated encrypted."""
    from app.core.crypto import encrypt_str

    return IntegrationConfig(
        is_enabled=True,
        status="Configured",
        webhook_token=encrypt_str(generate_webhook_token()),
        secret_key=encrypt_str(generate_secret_key()),
    )


class TenantIntegrations(BaseModel):
    indiamart: IntegrationConfig = Field(default_factory=IntegrationConfig)
    facebook: IntegrationConfig = Field(default_factory=IntegrationConfig)
    tradeindia: IntegrationConfig = Field(default_factory=IntegrationConfig)
    justdial: IntegrationConfig = Field(default_factory=IntegrationConfig)
    website: IntegrationConfig = Field(default_factory=get_default_website_integration)


# ---- Outbound communication gateways. Secret fields are stored ENCRYPTED (app.core.crypto). ----
class SmsConfig(BaseModel):
    is_enabled: bool = False
    provider: str = "custom_http"  # "fast2sms", "custom_http"
    api_key: Optional[str] = None  # encrypted
    sender_id: Optional[str] = None
    route: Optional[str] = "dlt"
    template_id: Optional[str] = None
    custom_url: Optional[str] = None  # https://api.example.com/send?apikey={API_KEY}&to={TO}&msg={MESSAGE}
    status: str = "Not Configured"


class WhatsAppConfig(BaseModel):
    is_enabled: bool = False
    provider: str = "cloud_api"  # "cloud_api", "twilio", "custom_webhook"
    phone_number_id: Optional[str] = None
    waba_id: Optional[str] = None
    access_token: Optional[str] = None  # encrypted
    account_sid: Optional[str] = None
    auth_token: Optional[str] = None  # encrypted
    from_phone_number: Optional[str] = None
    custom_webhook_url: Optional[str] = None
    pending_followup_template: Optional[str] = (
        "Hello {staff_name}, you have {pending_count} pending follow-up(s) waiting in LeadCRM today. "
        "Please review: {crm_url}"
    )
    status: str = "Not Configured"


class EmailConfig(BaseModel):
    is_enabled: bool = False
    mode: str = "smtp"  # "smtp" or "api"
    smtp_host: Optional[str] = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None  # encrypted
    smtp_use_tls: bool = True
    from_name: Optional[str] = "LeadCRM"
    from_email: Optional[str] = None
    api_provider: Optional[str] = "sendgrid"  # "sendgrid", "resend"
    api_key: Optional[str] = None  # encrypted
    status: str = "Not Configured"


class TenantCommunicationSettings(BaseModel):
    sms: SmsConfig = Field(default_factory=SmsConfig)
    whatsapp: WhatsAppConfig = Field(default_factory=WhatsAppConfig)
    email: EmailConfig = Field(default_factory=EmailConfig)


COMMUNICATION_SECRET_FIELDS = {
    "sms": ("api_key",),
    "whatsapp": ("access_token", "auth_token"),
    "email": ("smtp_password", "api_key"),
}


class Tenant(Document):
    """
    Tenant / Company Profile.
    Managed by Super Admin with user limits, subscription plan, and permissions.
    Supports company-customizable sales pipeline stages & lead source API integrations.
    """
    company_name: Indexed(str)
    slug: Optional[str] = None  # e.g. "apex-machineries"
    company_type: str = "manufacturing"  # manufacturing, trading, services, real_estate, agency
    
    # Super Admin Licensing & Limits
    max_users_limit: int = 5  # Set by Super Admin
    plan_name: str = "Professional"  # "Starter", "Professional", "Enterprise"
    status: str = "ACTIVE"  # "ACTIVE", "SUSPENDED", "TRIAL"
    company_admin_email: Optional[str] = None

    # Customizable Pipeline Stages per Company
    pipeline_stages: List[PipelineStage] = Field(default_factory=get_default_pipeline_stages)

    # Lead Marketplace API Settings per Company (IndiaMART, Facebook, TradeIndia, Justdial, Website)
    integrations: TenantIntegrations = Field(default_factory=TenantIntegrations)

    # Communication Settings (SMS, WhatsApp, Email SMTP/API)
    communication_settings: TenantCommunicationSettings = Field(default_factory=TenantCommunicationSettings)

    # Company Level Masters (Categories, Lost Reasons, Follow-up Types, Campaigns, Departments, Designations)
    company_masters: Dict[str, Any] = Field(default_factory=dict)

    # GST & Invoicing Profile
    gstin: Optional[str] = None
    pan_number: Optional[str] = None
    state_code: Optional[str] = None  # e.g. "24" for Gujarat
    state_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    logo_url: Optional[str] = None
    bank_details: BankDetails = Field(default_factory=BankDetails)
    default_invoice_terms: Optional[str] = "1. Goods once sold will not be taken back.\n2. Payment due within 15 days."
    is_active: bool = True

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "tenants"
        indexes = [[("slug", 1)]]

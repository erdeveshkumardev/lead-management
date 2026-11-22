from beanie import Document
from pydantic import Field


class SequenceCounter(Document):
    """
    Atomic sequential counter for invoices, quotations, and leads per tenant and financial year.
    Used with MongoDB find_one_and_update and $inc to guarantee zero duplicate numbers.
    """
    id: str = Field(alias="_id")  # e.g. "inv_TENANT1_2026-27"
    tenant_id: str
    counter_type: str  # "invoice", "quotation", "lead"
    financial_year: str  # "2026-27"
    seq: int = 0

    class Settings:
        name = "sequence_counters"

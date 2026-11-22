from datetime import datetime
from typing import List
from beanie import Document, Indexed
from pydantic import Field


class CustomFieldDefinition(Document):
    """
    Allows each company type to define their own custom attributes without code changes.
    E.g.
    - Real Estate: property_type, BHK, carpet_area
    - B2B Manufacturing: machine_capacity, voltage, raw_material
    - IT Services: tech_stack, budget_range, expected_start_date
    """
    tenant_id: Indexed(str)
    entity_type: str = "lead"  # "lead", "product", "invoice"
    field_key: str  # e.g. "machine_capacity"
    field_label: str  # e.g. "Machine Capacity (kW)"
    field_type: str = "text"  # "text", "number", "select", "date", "boolean"
    options: List[str] = Field(default_factory=list)  # for select dropdowns
    is_required: bool = False
    display_order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "custom_field_definitions"
        indexes = [
            [("tenant_id", 1), ("entity_type", 1), ("field_key", 1)]
        ]

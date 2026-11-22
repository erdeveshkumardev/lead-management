from typing import Annotated, Any
from pydantic import BeforeValidator


def parse_float_from_db(v: Any) -> float:
    """
    Safely converts MongoDB BSON Decimal128, int, str, or float into a Python float.
    Solves Pydantic v2 ValidationError when reading BSON Decimal128 from MongoDB.
    """
    if v is None:
        return 0.0
    if hasattr(v, "to_decimal"):
        return float(v.to_decimal())
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


Currency = Annotated[float, BeforeValidator(parse_float_from_db)]

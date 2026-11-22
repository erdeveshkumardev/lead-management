"""CSV export/import for leads with spreadsheet formula-injection protection."""
import csv
import io
from typing import Any, Dict, Iterable, List, Tuple

EXPORT_COLUMNS = [
    ("full_name", "Name"), ("phone", "Phone"), ("email", "Email"), ("company_name", "Company"),
    ("city", "City"), ("state", "State"), ("gstin", "GSTIN"), ("source", "Source"), ("stage", "Stage"),
    ("category", "Category"), ("product_inquired", "Product"), ("deal_value", "Deal Value"),
    ("assigned_to_user_name", "Assigned To"), ("created_at", "Created At"),
]
IMPORT_ALIASES = {
    "name": "full_name", "full name": "full_name", "full_name": "full_name", "customer": "full_name",
    "phone": "phone", "mobile": "phone", "phone number": "phone", "contact": "phone",
    "email": "email", "e-mail": "email", "company": "company_name", "company name": "company_name",
    "city": "city", "state": "state", "gstin": "gstin", "product": "product_inquired",
    "requirement": "inquiry_message", "message": "inquiry_message", "notes": "inquiry_message",
    "deal value": "deal_value", "value": "deal_value", "category": "category", "pincode": "pincode",
    "address": "address",
}
MAX_IMPORT_ROWS = 5000
_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "|", "%")


def neutralize(value: Any) -> str:
    text = "" if value is None else str(value)
    if text and text[0] in _DANGEROUS_PREFIXES:
        return "'" + text
    return text


def leads_to_csv_rows(leads: Iterable[Dict[str, Any]]) -> Iterable[str]:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([label for _, label in EXPORT_COLUMNS])
    yield "﻿" + buffer.getvalue()
    for lead in leads:
        buffer.seek(0)
        buffer.truncate(0)
        writer.writerow([neutralize(lead.get(key)) for key, _ in EXPORT_COLUMNS])
        yield buffer.getvalue()


def parse_import_csv(content: bytes) -> Tuple[List[Dict[str, str]], List[str]]:
    errors: List[str] = []
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], ["The file has no header row."]
    mapping = {h: IMPORT_ALIASES.get((h or "").strip().lower()) for h in reader.fieldnames}
    if "full_name" not in mapping.values() or not ({"phone", "email"} & set(mapping.values())):
        return [], ["CSV must contain a Name column and a Phone or Email column."]
    rows: List[Dict[str, str]] = []
    for idx, raw in enumerate(reader, start=2):
        if len(rows) >= MAX_IMPORT_ROWS:
            errors.append(f"Only the first {MAX_IMPORT_ROWS} rows were processed.")
            break
        row = {}
        for header, value in raw.items():
            field = mapping.get(header)
            if field and value is not None:
                cleaned = str(value).strip()
                if cleaned.startswith("'") and len(cleaned) > 1 and cleaned[1] in _DANGEROUS_PREFIXES:
                    cleaned = cleaned[1:]
                row[field] = cleaned[:2000]
        row["_line"] = str(idx)
        rows.append(row)
    return rows, errors

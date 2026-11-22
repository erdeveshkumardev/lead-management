"""Reusable input sanitisation helpers (NoSQL-injection safe keys, regex escaping, sizes)."""
import json
import re
from typing import Any, Dict, Optional

_SAFE_KEY_RE = re.compile(r"[^A-Za-z0-9_\- ]")
OBJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
MAX_TEXT = 5000


def safe_regex(term: str, max_len: int = 100) -> str:
    """Escapes user search input so it can never act as a regex/operator."""
    return re.escape((term or "").strip()[:max_len])


def clean_text(value: Any, max_len: int = MAX_TEXT) -> Optional[str]:
    if value is None:
        return None
    text = str(value).replace("\x00", "").strip()
    return text[:max_len] if text else None


def safe_key(key: Any, max_len: int = 64) -> str:
    """Mongo-safe dictionary key: no '$' prefix, no dots, limited charset."""
    k = _SAFE_KEY_RE.sub("_", str(key)).strip().lstrip("$")[:max_len]
    return k or "field"


def sanitize_flat_dict(data: Any, max_items: int = 100, max_value_len: int = 2000) -> Dict[str, Any]:
    """Flattens user supplied dictionaries (custom fields etc.) into safe scalar values."""
    if not isinstance(data, dict):
        return {}
    out: Dict[str, Any] = {}
    for idx, (k, v) in enumerate(data.items()):
        if idx >= max_items:
            break
        key = safe_key(k)
        if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
            out[key] = v
        elif isinstance(v, (list, tuple)):
            out[key] = ", ".join(str(i) for i in v)[:max_value_len]
        elif isinstance(v, dict):
            out[key] = json.dumps(v, default=str)[:max_value_len]
        else:
            out[key] = str(v)[:max_value_len]
    return out


def sanitize_nested(data: Any, depth: int = 0, max_depth: int = 6) -> Any:
    """Removes '$'-prefixed / dotted keys from arbitrary JSON before it is persisted (raw payload audit copy)."""
    if depth > max_depth:
        return str(data)[:500]
    if isinstance(data, dict):
        return {safe_key(k, 100): sanitize_nested(v, depth + 1) for k, v in list(data.items())[:200]}
    if isinstance(data, list):
        return [sanitize_nested(v, depth + 1) for v in data[:200]]
    if isinstance(data, str):
        return data[:5000]
    return data


def cap_json_size(data: Dict[str, Any], max_bytes: int = 16_000) -> Dict[str, Any]:
    try:
        encoded = json.dumps(data, default=str)
    except (TypeError, ValueError):
        return {"_truncated": True}
    if len(encoded) <= max_bytes:
        return data
    return {"_truncated": True, "_preview": encoded[: max_bytes // 2]}


def is_object_id(value: Optional[str]) -> bool:
    return bool(value) and bool(OBJECT_ID_RE.match(str(value)))

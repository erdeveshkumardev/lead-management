"""
Indian GST helpers: state codes, GSTIN/PAN/HSN validation, place-of-supply resolution,
Decimal money maths and amount-in-words (Indian numbering).
"""
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

STATE_CODES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
    "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory", "96": "Outside India (Export)",
}

_ALIASES = {
    "j&k": "01", "jammu & kashmir": "01", "jammu kashmir": "01", "uttaranchal": "05",
    "new delhi": "07", "nct of delhi": "07", "delhi ncr": "07", "up": "09", "orissa": "21",
    "chattisgarh": "22", "mp": "23", "daman and diu": "26", "daman & diu": "26",
    "dadra and nagar haveli": "26", "dnh": "26", "tamilnadu": "33", "pondicherry": "34",
    "andaman & nicobar": "35", "andaman and nicobar": "35", "telengana": "36", "andhra": "37",
    "ap": "37", "tn": "33", "wb": "19", "gj": "24", "mh": "27", "ka": "29", "kl": "32", "rj": "08",
    "hr": "06", "pb": "03", "dl": "07", "export": "96", "outside india": "96",
}
_NAME_TO_CODE = {name.lower(): code for code, name in STATE_CODES.items()}

GSTIN_RE = re.compile(r"^[0-9]{2}[0-9A-Z]{13}$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
HSN_RE = re.compile(r"^[0-9]{4,8}$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PINCODE_RE = re.compile(r"^[1-9][0-9]{5}$")
VALID_GST_RATES = {Decimal(x) for x in ("0", "0.1", "0.25", "1", "1.5", "3", "5", "6", "7.5", "12", "18", "28", "40")}

_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_checksum_char(first14: str) -> str:
    total = 0
    for idx, ch in enumerate(first14):
        value = _GSTIN_CHARS.index(ch)
        product = value * (2 if idx % 2 else 1)
        total += product // 36 + product % 36
    return _GSTIN_CHARS[(36 - total % 36) % 36]


def normalize_gstin(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return re.sub(r"\s", "", str(value)).upper() or None


def gstin_error(value: Optional[str]) -> Optional[str]:
    """Returns a human readable error or None if the GSTIN is valid."""
    gstin = normalize_gstin(value)
    if not gstin:
        return "GSTIN is empty."
    if not GSTIN_RE.match(gstin):
        return "GSTIN must be 15 characters: 2-digit state code followed by 13 letters/digits."
    if gstin[:2] not in STATE_CODES and gstin[:2] != "99":
        return f"GSTIN state code '{gstin[:2]}' is not a valid Indian state code."
    if gstin_checksum_char(gstin[:14]) != gstin[14]:
        return "GSTIN checksum is invalid - please re-check the number."
    return None


def is_valid_gstin(value: Optional[str]) -> bool:
    return gstin_error(value) is None


def resolve_state_code(value: Optional[str]) -> Optional[str]:
    """Accepts a 2-digit code, state name, alias, or a GSTIN and returns the GST state code."""
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{1,2}", raw):
        code = raw.zfill(2)
        return code if code in STATE_CODES else None
    gstin = normalize_gstin(raw)
    if gstin and len(gstin) == 15 and gstin[:2].isdigit() and gstin[:2] in STATE_CODES:
        return gstin[:2]
    key = re.sub(r"\s+", " ", raw.lower().replace(".", "")).strip()
    return _NAME_TO_CODE.get(key) or _ALIASES.get(key)


def state_name(code: Optional[str]) -> Optional[str]:
    return STATE_CODES.get(code or "")


# ---------------------------------------------------------------- money
TWO_PLACES = Decimal("0.01")


def to_decimal(value) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    if hasattr(value, "to_decimal"):
        return value.to_decimal()
    return Decimal(str(value))


def q2(value) -> Decimal:
    return to_decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def format_inr(value) -> str:
    """Amount with Indian digit grouping (lakh / crore): 1234567.5 -> '12,34,567.50'."""
    amount = q2(value)
    sign = "-" if amount < 0 else ""
    whole, _, fraction = f"{abs(amount):.2f}".partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}{whole}.{fraction}"


def round_rupee(value) -> Decimal:
    return to_decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------- amount in words
_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
         "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two_digits(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")).strip()


def _three_digits(n: int) -> str:
    hundred, rest = divmod(n, 100)
    parts = []
    if hundred:
        parts.append(_ONES[hundred] + " Hundred")
    if rest:
        parts.append(_two_digits(rest))
    return " ".join(parts)


def number_to_indian_words(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1000)
    if crore:
        parts.append(number_to_indian_words(crore) + " Crore")
    if lakh:
        parts.append(_two_digits(lakh) + " Lakh")
    if thousand:
        parts.append(_two_digits(thousand) + " Thousand")
    if n:
        parts.append(_three_digits(n))
    return " ".join(p for p in parts if p).strip()


def amount_in_words(amount) -> str:
    value = q2(amount)
    rupees = int(value)
    paise = int((value - rupees) * 100)
    words = f"Rupees {number_to_indian_words(rupees)}"
    if paise:
        words += f" and {_two_digits(paise)} Paise"
    return words + " Only"

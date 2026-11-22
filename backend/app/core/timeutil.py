"""Timezone helpers. Data is stored as naive UTC; business days are evaluated in the configured zone."""
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

from app.core.config import settings


def _zone():
    if ZoneInfo is not None:
        try:
            return ZoneInfo(settings.TIMEZONE)
        except Exception:
            pass
    return timezone(timedelta(hours=5, minutes=30))


def local_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(_zone())


def local_today() -> date:
    return local_now().date()


def local_day_bounds_utc(day: Optional[date] = None) -> Tuple[datetime, datetime]:
    """Start/end of a local calendar day expressed as naive UTC datetimes."""
    day = day or local_today()
    start_local = datetime(day.year, day.month, day.day, tzinfo=_zone())
    end_local = start_local + timedelta(days=1)
    to_utc = lambda d: d.astimezone(timezone.utc).replace(tzinfo=None)  # noqa: E731
    return to_utc(start_local), to_utc(end_local) - timedelta(microseconds=1)


def parse_client_datetime(raw: str) -> datetime:
    """Parses ISO strings; naive values are interpreted in the business timezone. Returns naive UTC."""
    value = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=_zone())
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def parse_client_date(raw: str) -> date:
    return datetime.fromisoformat(raw.strip()[:10]).date()


def financial_year_label(day: Optional[date] = None) -> str:
    day = day or local_today()
    start = day.year if day.month >= 4 else day.year - 1
    return f"{str(start)[-2:]}-{str(start + 1)[-2:]}"

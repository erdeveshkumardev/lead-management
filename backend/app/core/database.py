import asyncio
import logging
from typing import Optional, Type, TypeVar

from beanie import Document, init_beanie
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.counter import SequenceCounter
from app.models.custom_field import CustomFieldDefinition
from app.models.invoice import Invoice
from app.models.lead import Lead
from app.models.masters import GlobalMasterItem
from app.models.product import Product
from app.models.session import RefreshSession
from app.models.tenant import Tenant
from app.models.user import User

logger = logging.getLogger("app.database")

DOCUMENT_MODELS = [
    SequenceCounter,
    Tenant,
    User,
    CustomFieldDefinition,
    Lead,
    Product,
    Invoice,
    GlobalMasterItem,
    RefreshSession,
    AuditLog,
]

db_client: Optional[AsyncIOMotorClient] = None
_is_db_initialized: bool = False

T = TypeVar("T", bound=Document)


async def init_db(max_retries: int = 5, retry_delay: float = 2.0, client: Optional[AsyncIOMotorClient] = None) -> None:
    global db_client, _is_db_initialized
    if _is_db_initialized:
        return
    for attempt in range(1, max_retries + 1):
        try:
            db_client = client or AsyncIOMotorClient(
                settings.MONGODB_URL,
                serverSelectionTimeoutMS=10000,
                connectTimeoutMS=10000,
                tz_aware=False,
                uuidRepresentation="standard",
            )
            if client is None:
                await db_client.admin.command("ping")
            await init_beanie(database=db_client[settings.DATABASE_NAME], document_models=DOCUMENT_MODELS)
            _is_db_initialized = True
            logger.info("MongoDB connected and Beanie initialised (database=%s)", settings.DATABASE_NAME)
            return
        except Exception as exc:  # pragma: no cover - network failures
            # never log the connection string: it contains credentials
            logger.warning("MongoDB connection attempt %s/%s failed: %s", attempt, max_retries, type(exc).__name__)
            if attempt >= max_retries:
                raise
            await asyncio.sleep(retry_delay)


async def close_db() -> None:
    global db_client, _is_db_initialized
    if db_client is not None:
        db_client.close()
        logger.info("MongoDB connection closed.")
    db_client = None
    _is_db_initialized = False


def get_db():
    if db_client is None:
        raise RuntimeError("Database not initialised")
    return db_client[settings.DATABASE_NAME]


async def ping_db() -> bool:
    try:
        await get_db().command("ping")
        return True
    except Exception:
        return False


async def get_document_by_id(model_cls: Type[T], doc_id: Optional[str]) -> Optional[T]:
    """Strict lookup by ObjectId. Never falls back to another document (prevents cross-tenant leaks)."""
    if not doc_id:
        return None
    value = str(doc_id).strip()
    if not ObjectId.is_valid(value):
        return None
    return await model_cls.get(ObjectId(value))

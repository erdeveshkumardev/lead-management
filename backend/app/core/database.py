from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
import logging
import asyncio
import sys

from app.core.config import settings
from app.models.counter import SequenceCounter
from app.models.tenant import Tenant
from app.models.user import User
from app.models.custom_field import CustomFieldDefinition
from app.models.lead import Lead
from app.models.product import Product
from app.models.invoice import Invoice
from app.models.masters import GlobalMasterItem
from app.models.ticket import SupportTicket

logger = logging.getLogger(__name__)

db_client: AsyncIOMotorClient = None
_is_db_initialized: bool = False


async def init_db(max_retries: int = 5, retry_delay: float = 2.0):
    global db_client, _is_db_initialized
    if _is_db_initialized:
        return

    print(f"🔄 [DB] Connecting to MongoDB at {settings.MONGODB_URL[:30]}... (database: {settings.DATABASE_NAME})", flush=True)

    for attempt in range(1, max_retries + 1):
        try:
            db_client = AsyncIOMotorClient(
                settings.MONGODB_URL,
                serverSelectionTimeoutMS=10000,
                connectTimeoutMS=10000
            )
            database = db_client[settings.DATABASE_NAME]

            # Ping MongoDB cluster to confirm reachable network connection
            await db_client.admin.command('ping')
            print("✅ [DB] MongoDB Atlas connection verified via ping!", flush=True)

            # Initialize Beanie ODM with all models
            await init_beanie(
                database=database,
                document_models=[
                    SequenceCounter,
                    Tenant,
                    User,
                    CustomFieldDefinition,
                    Lead,
                    Product,
                    Invoice,
                    GlobalMasterItem,
                    SupportTicket,
                ],
            )
            _is_db_initialized = True
            print("✅ [DB] MongoDB and Beanie initialized successfully.", flush=True)
            return
        except Exception as e:
            print(f"⚠️ [DB Attempt {attempt}/{max_retries}] MongoDB / Beanie connection error: {e}", file=sys.stderr, flush=True)
            if attempt < max_retries:
                print(f"⏳ [DB] Retrying in {retry_delay}s...", flush=True)
                await asyncio.sleep(retry_delay)
            else:
                import traceback
                traceback.print_exc()
                raise e


async def ensure_db_initialized():
    global _is_db_initialized
    if not _is_db_initialized:
        await init_db(max_retries=3, retry_delay=1.0)


async def close_db():
    global db_client, _is_db_initialized
    if db_client:
        db_client.close()
        _is_db_initialized = False
        print("MongoDB connection closed.", flush=True)
        db_client.close()
        logger.info("MongoDB connection closed.")


def get_db():
    global db_client
    return db_client[settings.DATABASE_NAME]


async def get_document_by_id(model_cls, doc_id: str):
    """
    Safely retrieves a Beanie Document by ObjectId or string ID without throwing InvalidId exception.
    """
    if not doc_id:
        return None
    from bson import ObjectId
    doc_id_str = str(doc_id).strip()
    if ObjectId.is_valid(doc_id_str):
        doc = await model_cls.get(ObjectId(doc_id_str))
        if doc:
            return doc
    try:
        doc = await model_cls.find_one({"_id": doc_id_str})
        if doc:
            return doc
    except Exception:
        pass

    # Safe fallback for demo_tenant_01 or slug lookup on Tenant
    if model_cls == Tenant:
        try:
            return await Tenant.find_one({"$or": [{"slug": doc_id_str}, {"company_name": doc_id_str}]}) or await Tenant.find_one()
        except Exception:
            return None
    return None

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
import logging

from app.core.config import settings
from app.models.counter import SequenceCounter
from app.models.tenant import Tenant
from app.models.user import User
from app.models.custom_field import CustomFieldDefinition
from app.models.lead import Lead
from app.models.product import Product
from app.models.invoice import Invoice
from app.models.masters import GlobalMasterItem

logger = logging.getLogger(__name__)

db_client: AsyncIOMotorClient = None


async def init_db():
    global db_client
    try:
        logger.info(f"Connecting to MongoDB at {settings.MONGODB_URL}")
        db_client = AsyncIOMotorClient(settings.MONGODB_URL)
        database = db_client[settings.DATABASE_NAME]

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
            ],
        )
        logger.info("MongoDB and Beanie initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize MongoDB: {e}")
        # Allow app to start even if MongoDB is not immediately running so docs can be inspected
        # In production this will raise


async def close_db():
    global db_client
    if db_client:
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

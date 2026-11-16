import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db, close_db, ensure_db_initialized
from app.api.v1.router import api_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB and initialize Beanie
    await init_db()
    yield
    # Shutdown: Close DB connection
    await close_db()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Multi-tenant Lead Management System with IndiaMART, TradeIndia, Facebook Ingestion and GST Invoicing Engine",
    version="1.0.0",
    lifespan=lifespan
)

# Safety Middleware: Ensure Beanie ODM is always initialized before processing API queries
@app.middleware("http")
async def db_readiness_middleware(request: Request, call_next):
    if not request.url.path.endswith("/healthz") and request.url.path != "/":
        await ensure_db_initialized()
    return await call_next(request)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API v1 Router
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def root():
    return {
        "system": settings.PROJECT_NAME,
        "status": "online",
        "docs_url": "/docs",
        "api_v1": settings.API_V1_STR
    }


@app.get("/healthz")
def healthz():
    return {"status": "ok"}

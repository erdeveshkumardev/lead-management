import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import close_db, init_db, ping_db
from app.core.errors import register_exception_handlers
from app.core.logging_config import configure_logging
from app.core.middleware import (
    BodySizeLimitMiddleware, ProbeAwareTrustedHostMiddleware, PublicWebhookCORSMiddleware, SecurityHeadersMiddleware,
)

configure_logging(json_logs=settings.is_production)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_runtime()  # refuse to start with weak / missing secrets
    await init_db()
    from app.services.bootstrap import run_startup_tasks

    await run_startup_tasks()

    stop = asyncio.Event()
    scheduler_task = None
    if settings.ENABLE_SCHEDULER and not settings.is_test:
        from app.services.scheduler import scheduler_loop

        scheduler_task = asyncio.create_task(scheduler_loop(stop))
    upgrade_task = None
    if not settings.is_test:
        from app.services.bootstrap import run_background_upgrades

        upgrade_task = asyncio.create_task(run_background_upgrades())  # repairs of old data; never delays start-up
    logger.info("%s started (environment=%s)", settings.PROJECT_NAME, settings.ENVIRONMENT)
    try:
        yield
    finally:
        stop.set()
        for task in (scheduler_task, upgrade_task):
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await task
        await close_db()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Multi-tenant Lead Management System with marketplace lead ingestion and GST invoicing",
    version="2.0.0",
    lifespan=lifespan,
    # interactive API documentation is switched off in production
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

register_exception_handlers(app)

# Middleware order: the LAST one added is the OUTERMOST (runs first on a request).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # explicit allow-list, never "*"
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Idempotency-Key", "X-Request-ID"],
    expose_headers=["Content-Disposition", "X-Request-ID", "Retry-After"],
    max_age=600,
)
app.add_middleware(PublicWebhookCORSMiddleware, path_prefix=f"{settings.API_V1_STR}/webhooks/website/")
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.MAX_REQUEST_BODY_BYTES)
app.add_middleware(ProbeAwareTrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/", include_in_schema=False)
def root():
    return {"status": "online"}


@app.get("/healthz", include_in_schema=False)
def healthz():
    """Liveness probe: the process is running."""
    return {"status": "ok"}


@app.get("/readyz", include_in_schema=False)
async def readyz():
    """Readiness probe: the database is reachable."""
    if await ping_db():
        return {"status": "ready"}
    return JSONResponse(status_code=503, content={"status": "database unavailable"})

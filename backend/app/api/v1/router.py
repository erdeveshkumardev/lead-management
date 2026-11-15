from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth,
    super_admin,
    team,
    webhooks,
    leads,
    invoices,
    products,
    analytics,
    tenants,
    masters,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(super_admin.router)
api_router.include_router(team.router)
api_router.include_router(webhooks.router)
api_router.include_router(leads.router)
api_router.include_router(invoices.router)
api_router.include_router(products.router)
api_router.include_router(analytics.router)
api_router.include_router(tenants.router)
api_router.include_router(masters.router)

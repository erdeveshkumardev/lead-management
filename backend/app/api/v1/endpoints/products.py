from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from app.core.audit import audit
from app.core.database import get_document_by_id
from app.core.deps import AuthContext, get_current_user, require_permission, resolve_tenant_id
from app.core.validators import clean_text
from app.models.product import Product
from app.schemas.product import ProductCreateRequest, ProductUpdateRequest

router = APIRouter(prefix="/products", tags=["Products & Services Master"])


async def _load(ctx: AuthContext, product_id: str, tenant_id: Optional[str]) -> Product:
    tid = await resolve_tenant_id(ctx, tenant_id)
    product = await get_document_by_id(Product, product_id)
    if not product or product.tenant_id != tid:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/")
async def list_products(tenant_id: Optional[str] = None, is_active: Optional[bool] = None,
                        ctx: AuthContext = Depends(get_current_user)):
    tid = await resolve_tenant_id(ctx, tenant_id)
    query: Dict[str, Any] = {"tenant_id": tid}
    if is_active is not None:
        query["is_active"] = is_active
    return await Product.find(query).sort("name").limit(2000).to_list()


@router.post("/", status_code=201)
async def create_product(payload: ProductCreateRequest, tenant_id: Optional[str] = None,
                         ctx: AuthContext = Depends(require_permission("products_manage"))):
    tid = await resolve_tenant_id(ctx, tenant_id)
    sku = clean_text(payload.sku, 60)
    if sku and await Product.find_one({"tenant_id": tid, "sku": sku}):
        raise HTTPException(status_code=409, detail="A product with this SKU already exists.")
    product = Product(
        tenant_id=tid, name=clean_text(payload.name, 200), sku=sku, item_type=payload.item_type,
        hsn_sac_code=payload.hsn_sac_code, description=clean_text(payload.description, 1000),
        unit=clean_text(payload.unit, 20) or "Nos", unit_price=payload.unit_price, gst_rate=payload.gst_rate,
    )
    await product.insert()
    await audit("product.created", ctx=ctx, tenant_id=tid, entity_type="product", entity_id=str(product.id),
                details={"name": product.name})
    return product


@router.patch("/{product_id}")
async def update_product(product_id: str, payload: ProductUpdateRequest, tenant_id: Optional[str] = None,
                         ctx: AuthContext = Depends(require_permission("products_manage"))):
    product = await _load(ctx, product_id, tenant_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key in ("name", "sku", "description", "unit") and value is not None:
            value = clean_text(value, {"name": 200, "sku": 60, "description": 1000, "unit": 20}[key])
        if key in ("name", "unit", "item_type", "unit_price", "gst_rate", "is_active") and value is None:
            continue
        setattr(product, key, value)
    product.updated_at = datetime.utcnow()
    await product.save()
    await audit("product.updated", ctx=ctx, tenant_id=product.tenant_id, entity_type="product", entity_id=str(product.id),
                details={"fields": ", ".join(sorted(data.keys()))})
    return product


@router.delete("/{product_id}")
async def delete_product(product_id: str, tenant_id: Optional[str] = None,
                         ctx: AuthContext = Depends(require_permission("products_manage"))):
    product = await _load(ctx, product_id, tenant_id)
    await product.delete()
    await audit("product.deleted", ctx=ctx, tenant_id=product.tenant_id, entity_type="product", entity_id=product_id,
                details={"name": product.name})
    return {"status": "success", "message": "Product deleted successfully"}

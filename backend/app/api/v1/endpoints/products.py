from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.core.database import get_document_by_id
from app.models.product import Product
from app.schemas.product import ProductCreateRequest, ProductUpdateRequest

router = APIRouter(prefix="/products", tags=["Products & Services Master"])


@router.get("/")
async def list_products(tenant_id: str, is_active: Optional[bool] = None):
    query = {"tenant_id": tenant_id}
    if is_active is not None:
        query["is_active"] = is_active
    products = await Product.find(query).sort("name").to_list()
    return products


@router.post("/")
async def create_product(tenant_id: str, payload: ProductCreateRequest):
    product = Product(
        tenant_id=tenant_id,
        name=payload.name,
        sku=payload.sku,
        item_type=payload.item_type,
        hsn_sac_code=payload.hsn_sac_code,
        description=payload.description,
        unit=payload.unit,
        unit_price=payload.unit_price,
        gst_rate=payload.gst_rate
    )
    await product.insert()
    return product


@router.patch("/{product_id}")
async def update_product(product_id: str, tenant_id: str, payload: ProductUpdateRequest):
    product = await get_document_by_id(Product, product_id)
    if not product or product.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Product not found")

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(product, k, v)
    
    product.updated_at = datetime.utcnow()
    await product.save()
    return product


@router.delete("/{product_id}")
async def delete_product(product_id: str, tenant_id: str):
    product = await get_document_by_id(Product, product_id)
    if not product or product.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Product not found")
    await product.delete()
    return {"status": "success", "message": "Product deleted successfully"}

import re
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.models.user import User, get_default_permissions_for_role
from app.models.tenant import Tenant
from app.core.database import get_document_by_id

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])


class LoginRequest(BaseModel):
    email: Optional[str] = None
    username: Optional[str] = None
    password: str = "password123"


class RegisterUserRequest(BaseModel):
    tenant_id: str
    full_name: str
    email: str
    password: str = "password123"
    role: str = "staff"
    phone: Optional[str] = None


@router.post("/seed-initial")
async def seed_initial_accounts():
    """
    Creates default Super Admin, Demo Company, and Staff for quick testing.
    """
    # 1. Super Admin
    super_admin = await User.find_one(User.role == "super_admin")
    if not super_admin:
        super_admin = User(
            tenant_id="system",
            full_name="Platform Super Admin",
            email="superadmin@leadcash.com",
            hashed_password="password123",
            role="super_admin",
            permissions=get_default_permissions_for_role("super_admin")
        )
        await super_admin.insert()

    # 2. Default Company
    tenant = await Tenant.find_one(Tenant.company_name == "Apex Machineries Pvt Ltd")
    if not tenant:
        tenant = Tenant(
            company_name="Apex Machineries Pvt Ltd",
            slug="apex-machineries",
            company_type="manufacturing",
            max_users_limit=5,
            plan_name="Professional",
            status="ACTIVE",
            gstin="24ABCDE1234F1Z5",
            state_code="24",
            state_name="Gujarat",
            address="Plot 42, GIDC Industrial Estate, Vatva",
            city="Ahmedabad",
            phone="+919876543210",
            email="admin@apexmachineries.com"
        )
        await tenant.insert()

    tenant_id = str(tenant.id)

    # 3. Company Admin
    comp_admin = await User.find_one(User.email == "admin@apexmachineries.com")
    if not comp_admin:
        comp_admin = User(
            tenant_id=tenant_id,
            full_name="Vikram Patel (Company Admin)",
            email="admin@apexmachineries.com",
            hashed_password="password123",
            phone="9876543211",
            role="company_admin",
            permissions=get_default_permissions_for_role("company_admin")
        )
        await comp_admin.insert()

    # 4. Sales Staff
    staff_user = await User.find_one(User.email == "rajesh@apexmachineries.com")
    if not staff_user:
        staff_user = User(
            tenant_id=tenant_id,
            full_name="Rajesh Sharma (Sales Rep)",
            email="rajesh@apexmachineries.com",
            hashed_password="password123",
            phone="9876543212",
            role="staff",
            permissions=get_default_permissions_for_role("staff")
        )
        await staff_user.insert()

    return {
        "status": "success",
        "message": "Initial accounts ready",
        "accounts": [
            {"role": "super_admin", "email": "superadmin@leadcash.com", "password": "password123"},
            {"role": "company_admin", "email": "admin@apexmachineries.com", "password": "password123"},
            {"role": "staff", "email": "rajesh@apexmachineries.com", "password": "password123"}
        ]
    }


@router.post("/login")
async def login(payload: LoginRequest):
    # Ensure seed accounts exist
    await seed_initial_accounts()

    clean_email = (payload.email or payload.username or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=400, detail="Email or username is required.")

    # Case-insensitive lookup by email or slug
    user = await User.find_one({"email": {"$regex": f"^{re.escape(clean_email)}$", "$options": "i"}})
    if not user:
        # Fallback check by name or demo shortcut
        user = await User.find_one({"$or": [
            {"email": clean_email},
            {"full_name": {"$regex": f"^{re.escape(clean_email)}$", "$options": "i"}}
        ]})

    if not user:
        raise HTTPException(status_code=401, detail=f"No account found matching '{clean_email}'. Please check your email.")

    # Simple password check for rapid local setup (in production bcrypt verify)
    if user.hashed_password != payload.password and payload.password != "password123":
        raise HTTPException(status_code=401, detail="Invalid password. Default demo password is 'password123'.")

    # Get Tenant Info
    tenant_info = None
    if user.role != "super_admin" and user.tenant_id != "system":
        tenant = await get_document_by_id(Tenant, user.tenant_id)
        if tenant:
            if tenant.status == "SUSPENDED":
                raise HTTPException(status_code=403, detail="Your company account is suspended by Super Admin.")
            tenant_info = {
                "id": str(tenant.id),
                "company_name": tenant.company_name,
                "company_type": tenant.company_type,
                "plan_name": tenant.plan_name,
                "max_users_limit": tenant.max_users_limit,
                "gstin": tenant.gstin
            }

    return {
        "user": {
            "id": str(user.id),
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "permissions": user.permissions or get_default_permissions_for_role(user.role)
        },
        "tenant": tenant_info
    }


@router.get("/demo-accounts")
async def get_demo_accounts():
    await seed_initial_accounts()
    return [
        {
            "role": "super_admin",
            "title": "Super Administrator",
            "desc": "Platform owner. Creates companies, sets user quotas, manages all tenants.",
            "email": "superadmin@leadcash.com",
            "password": "password123"
        },
        {
            "role": "company_admin",
            "title": "Company Admin",
            "desc": "Apex Machineries admin. Manages team, permissions, leads, products, and bills.",
            "email": "admin@apexmachineries.com",
            "password": "password123"
        },
        {
            "role": "staff",
            "title": "Sales Staff / Agent",
            "desc": "Sales executive. Manages pipeline, calls, and generates quotes.",
            "email": "rajesh@apexmachineries.com",
            "password": "password123"
        }
    ]

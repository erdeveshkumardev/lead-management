"""
Test harness: the real FastAPI application running against an in-memory MongoDB (mongomock).
No network access and no real database are needed.
"""
import os

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-for-automated-tests-only-0123456789abcdef"
os.environ["BACKEND_CORS_ORIGINS"] = "http://localhost:5173"
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["MFA_REQUIRED_ROLES"] = "super_admin"
os.environ.pop("ENCRYPTION_KEYS", None)

from datetime import datetime  # noqa: E402
from typing import Any, Dict  # noqa: E402

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from app.core import database, deps  # noqa: E402
from app.core.gst import gstin_checksum_char  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models.tenant import Tenant  # noqa: E402
from app.models.user import User, get_default_permissions_for_role  # noqa: E402

PASSWORD = "Str0ng!Passw-rd#2026"
BROWSER = {"X-Requested-With": "XMLHttpRequest"}


def valid_gstin(state_code: str = "24", pan: str = "AAACA1234F") -> str:
    base = f"{state_code}{pan}1Z"
    return base + gstin_checksum_char(base)


@pytest_asyncio.fixture(autouse=True)
async def db():
    await database.close_db()
    deps._TENANT_CACHE.clear()
    client = AsyncMongoMockClient()
    await database.init_db(client=client)
    from app.services.bootstrap import run_startup_tasks

    await run_startup_tasks()
    yield client
    await database.close_db()


async def reset_rate_limits() -> None:
    """Lets one test exercise several rate-limited steps (as if time had passed between them)."""
    await database.get_db()["rate_limits"].delete_many({})


def new_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


@pytest_asyncio.fixture
async def client():
    async with new_client() as c:
        yield c


async def make_tenant(name: str = "Alpha Industries", state_code: str = "24", **extra: Any) -> Tenant:
    tenant = Tenant(
        company_name=name, slug=name.lower().replace(" ", "-"), gstin=valid_gstin(state_code), state_code=state_code,
        state_name={"24": "Gujarat", "27": "Maharashtra"}.get(state_code, "Gujarat"), address="1 Industrial Estate",
        city="Ahmedabad", phone="+919800000001", email=f"info@{name.lower().replace(' ', '')}.example", **extra,
    )
    await tenant.insert()
    return tenant


async def make_user(tenant_id: str, role: str, email: str, password: str = PASSWORD, **extra: Any) -> User:
    extra.setdefault("password_changed_at", datetime.utcnow())
    user = User(
        tenant_id=tenant_id, full_name=extra.pop("full_name", email.split("@")[0].title()), email=email,
        hashed_password=hash_password(password), role=role, permissions=get_default_permissions_for_role(role), **extra,
    )
    await user.insert()
    return user


async def login(client: AsyncClient, email: str, password: str = PASSWORD) -> Dict[str, Any]:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def bearer(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class Session:
    """A signed-in browser: its own cookie jar plus the bearer token."""

    def __init__(self, client: AsyncClient, token: str, user: Dict[str, Any]):
        self.client, self.token, self.user = client, token, user

    @property
    def headers(self) -> Dict[str, str]:
        return bearer(self.token)

    async def get(self, url: str, **kw):
        return await self.client.get(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    async def post(self, url: str, **kw):
        return await self.client.post(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    async def put(self, url: str, **kw):
        return await self.client.put(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    async def patch(self, url: str, **kw):
        return await self.client.patch(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    async def delete(self, url: str, **kw):
        return await self.client.delete(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    async def close(self):
        await self.client.aclose()


async def sign_in(email: str, password: str = PASSWORD) -> Session:
    client = new_client()
    data = await login(client, email, password)
    return Session(client, data["access_token"], data["user"])


class World:
    """Two companies with an administrator, a manager and two sales users each."""

    tenant_a: Tenant
    tenant_b: Tenant
    admin_a: Session
    manager_a: Session
    staff_a: Session
    staff_a2: Session
    admin_b: Session
    sessions: list


@pytest_asyncio.fixture
async def world():
    w = World()
    w.tenant_a = await make_tenant("Alpha Industries", "24")
    w.tenant_b = await make_tenant("Beta Traders", "27")
    ta, tb = str(w.tenant_a.id), str(w.tenant_b.id)
    await make_user(ta, "company_admin", "admin@alpha.example", full_name="Asha Admin")
    await make_user(ta, "manager", "manager@alpha.example", full_name="Mohan Manager")
    await make_user(ta, "staff", "staff1@alpha.example", full_name="Sana Sales")
    await make_user(ta, "staff", "staff2@alpha.example", full_name="Ravi Rep")
    await make_user(tb, "company_admin", "admin@beta.example", full_name="Bina Boss")
    w.admin_a = await sign_in("admin@alpha.example")
    w.manager_a = await sign_in("manager@alpha.example")
    w.staff_a = await sign_in("staff1@alpha.example")
    w.staff_a2 = await sign_in("staff2@alpha.example")
    w.admin_b = await sign_in("admin@beta.example")
    w.sessions = [w.admin_a, w.manager_a, w.staff_a, w.staff_a2, w.admin_b]
    yield w
    for s in w.sessions:
        await s.close()


async def create_lead(session: Session, **overrides: Any) -> Dict[str, Any]:
    payload = {"full_name": "Kiran Buyer", "phone": "9825011111", "company_name": "Kiran Tools", "state": "Gujarat",
               "product_inquired": "CNC Machine", "deal_value": 150000}
    payload.update(overrides)
    resp = await session.post("/api/v1/leads/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["lead"]


ITEM = {"name": "CNC Lathe", "hsn_sac_code": "8458", "quantity": 2, "unit": "Nos", "unit_price": 50000, "gst_rate": 18}

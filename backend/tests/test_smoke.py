from tests.conftest import create_lead


async def test_world_boots_and_basic_flow(world):
    lead = await create_lead(world.admin_a)
    assert lead["assigned_to_user_id"] is None
    resp = await world.admin_a.get("/api/v1/leads/")
    assert resp.status_code == 200 and resp.json()["total"] == 1
    kanban = await world.admin_a.get("/api/v1/leads/kanban")
    assert kanban.status_code == 200 and len(kanban.json()["NEW"]) == 1
    dash = await world.admin_a.get("/api/v1/analytics/dashboard")
    assert dash.status_code == 200, dash.text
    assert dash.json()["leads_metrics"]["total_leads"] == 1

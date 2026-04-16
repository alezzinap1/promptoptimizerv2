"""Tier catalog, health snapshot and router fallback behaviour."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from core.model_catalog import CATALOG, MAX_COMPLETION_PER_M, all_catalog_model_ids, candidates
from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password


def test_catalog_structure_and_ids_unique():
    modes = set(CATALOG.keys())
    assert {"text", "image", "skill"} <= modes
    for tiers in CATALOG.values():
        assert {"fast", "mid", "advanced", "helper"} <= set(tiers.keys())
    ids = all_catalog_model_ids()
    assert len(ids) == len(set(ids)), "catalog model ids must be unique"
    assert candidates("text", "fast")


def test_budget_cap_is_enforced_by_health_evaluate(monkeypatch):
    from services import model_health

    expensive = "super/expensive"
    ok_model = candidates("text", "fast")[0]

    fake_models = {
        ok_model: {"id": ok_model, "pricing": {"prompt": 0.00000005, "completion": 0.0000003}},
        expensive: {
            "id": expensive,
            "pricing": {"prompt": 0.000005, "completion": 0.00001},
        },
    }

    def _fake_index():
        return fake_models

    monkeypatch.setattr(model_health, "_index_openrouter_models", _fake_index)

    ok = model_health._evaluate(ok_model, "text", "fast", fake_models)
    assert ok["available"] is True

    bad = model_health._evaluate(expensive, "text", "advanced", fake_models)
    assert bad["available"] is False
    assert "over_budget" in bad["reason"]
    assert MAX_COMPLETION_PER_M > 0


def test_model_router_resolves_first_available(monkeypatch):
    from services import model_health, model_router

    with tempfile.TemporaryDirectory() as tmp:
        db = DBManager(str(Path(tmp) / "t.db"))
        db.init()

        ok_model = candidates("text", "fast")[0]
        fake_index = {
            ok_model: {"id": ok_model, "pricing": {"prompt": 0.00000005, "completion": 0.0000003}},
        }

        monkeypatch.setattr(model_health, "_index_openrouter_models", lambda: fake_index)
        model_health.run_health_check(db)

        picked, reasoning = model_router.resolve(db, "fast", "text", trial=False)
        assert picked == ok_model
        assert "picked=" in reasoning

        picked_advanced, _ = model_router.resolve(db, "advanced", "text", trial=False)
        assert picked_advanced, "should fall back to an available tier"


def test_admin_metrics_and_model_health_endpoints(monkeypatch):
    from services import model_health

    ok_model = candidates("text", "fast")[0]
    fake_index = {
        ok_model: {"id": ok_model, "pricing": {"prompt": 0.00000005, "completion": 0.0000003}},
    }
    monkeypatch.setattr(model_health, "_index_openrouter_models", lambda: fake_index)

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        admin_id = db.create_user("admn", hash_password("password12345"))
        with db._conn() as conn:  # noqa: SLF001
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (admin_id,))
        sid = generate_session_id()
        db.bind_session_to_user(sid, int(admin_id))

        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.get("/api/admin/metrics", headers={"X-Session-Id": sid})
            assert r.status_code == 200
            body = r.json()
            assert "users" in body and "usage" in body and "events" in body

            r2 = client.post("/api/admin/model-health/run", headers={"X-Session-Id": sid})
            assert r2.status_code == 200
            summary = r2.json()["summary"]
            assert summary["checked"] > 0

            r3 = client.get("/api/admin/model-health", headers={"X-Session-Id": sid})
            assert r3.status_code == 200
            data = r3.json()
            assert isinstance(data["items"], list)
            assert any(it["model_id"] == ok_model for it in data["items"])

            r4 = client.get("/api/model-tiers", headers={"X-Session-Id": sid})
            assert r4.status_code == 200
            tiers = r4.json()["tiers"]
            assert isinstance(tiers, list) and len(tiers) >= 4
            tier_ids = {t["id"] for t in tiers}
            assert {"auto", "fast", "mid", "advanced"} <= tier_ids


def test_generate_request_accepts_tier_field():
    """Backend must accept `tier` in GenerateRequest without validation error."""
    from backend.api.generate import GenerateRequest

    req = GenerateRequest(task_input="hi", tier="mid")
    assert req.tier == "mid"

    req2 = GenerateRequest(task_input="hi", tier=None)
    assert req2.tier is None

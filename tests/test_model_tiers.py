"""Tier catalog, health snapshot and router fallback behaviour."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
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


def test_tier_override_is_used_when_available(monkeypatch):
    """Админский override для (mode,tier) должен иметь приоритет над авто-каталогом."""
    from services import model_health, model_router

    with tempfile.TemporaryDirectory() as tmp:
        db = DBManager(str(Path(tmp) / "t.db"))
        db.init()

        fast_candidates = candidates("text", "fast")
        assert len(fast_candidates) >= 2, "need ≥2 candidates to test override"
        first, second = fast_candidates[0], fast_candidates[1]
        fake_index = {
            first: {"id": first, "pricing": {"prompt": 0.00000005, "completion": 0.0000003}},
            second: {"id": second, "pricing": {"prompt": 0.00000005, "completion": 0.0000003}},
        }
        monkeypatch.setattr(model_health, "_index_openrouter_models", lambda: fake_index)
        model_health.run_health_check(db)

        db.set_tier_override("text", "fast", second)
        picked, reasoning = model_router.resolve(db, "fast", "text", trial=False)
        assert picked == second
        assert "override_picked=" in reasoning

        db.set_tier_override("text", "fast", None)
        picked2, _ = model_router.resolve(db, "fast", "text", trial=False)
        assert picked2 == first


def test_translator_protects_code_blocks_and_placeholders():
    """services.translator не должен переводить code-fences / inline `...` / {placeholders}."""
    from services import translator

    def _fake_chunk(text: str, direction: str) -> str:  # type: ignore[override]
        # эмулируем перевод: просто помечаем текст
        return "TR:" + text

    # Подменяем провайдеров на один искусственный.
    translator._PROVIDERS = [("fake", _fake_chunk)]  # type: ignore[attr-defined]
    translator._CACHE.clear()  # type: ignore[attr-defined]

    src = (
        "Привет, мир! Это обычный текст.\n\n"
        "```python\nprint('hello')\n```\n\n"
        "Используй {user_name} и значение [SLOT_A]."
    )
    r = translator.translate(src, "ru->en")
    out = r["translated"]
    assert "```python\nprint('hello')\n```" in out
    assert "{user_name}" in out
    assert "[SLOT_A]" in out
    assert out.startswith("TR:")


def test_mymemory_invalid_email_response_raises_for_fallback(monkeypatch):
    """Раньше MyMemory возвращал INVALID EMAIL PROVIDED в translatedText при невалидном de=."""
    from services import translator

    monkeypatch.setattr(
        translator,
        "_http_get_json",
        lambda url: {"responseData": {"translatedText": "INVALID EMAIL PROVIDED"}},
    )
    with pytest.raises(RuntimeError, match="MyMemory rejected"):
        translator._mymemory_translate_chunk("hello", "ru->en")


def test_library_translate_endpoint(monkeypatch):
    from services import model_health, translator as translator_mod

    ok_model = candidates("text", "fast")[0]
    monkeypatch.setattr(
        model_health,
        "_index_openrouter_models",
        lambda: {ok_model: {"id": ok_model, "pricing": {"prompt": 0.0, "completion": 0.0}}},
    )
    # Заменяем провайдеров перевода на sync-мок, чтобы тест не выходил в интернет.
    monkeypatch.setattr(
        translator_mod,
        "_PROVIDERS",
        [("fake", lambda text, direction: "[EN] " + text)],
    )
    translator_mod._CACHE.clear()  # type: ignore[attr-defined]

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        uid = db.create_user("alice", hash_password("password12345"))
        sid = generate_session_id()
        db.bind_session_to_user(sid, int(uid))
        item_id = db.save_to_library(
            title="Тест", prompt="Привет, это тестовый промпт.", user_id=int(uid)
        )
        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.post(f"/api/library/{item_id}/translate", headers={"X-Session-Id": sid})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["prompt_lang"] == "ru"
            assert data["prompt_alt_lang"] == "en"
            assert data["prompt_alt"].startswith("[EN] ")

            # Проверяем, что admin override endpoints работают.
            admin_id = db.create_user("bob", hash_password("password12345"))
            with db._conn() as conn:  # noqa: SLF001
                conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (admin_id,))
            admin_sid = generate_session_id()
            db.bind_session_to_user(admin_sid, int(admin_id))

            r2 = client.get("/api/admin/tier-overrides", headers={"X-Session-Id": admin_sid})
            assert r2.status_code == 200, r2.text
            rows = r2.json()["rows"]
            assert any(row["mode"] == "text" and row["tier"] == "fast" for row in rows)

            r3 = client.put(
                "/api/admin/tier-overrides",
                json={"mode": "text", "tier": "fast", "model_id": ok_model},
                headers={"X-Session-Id": admin_sid},
            )
            assert r3.status_code == 200, r3.text
            assert r3.json()["model_id"] == ok_model

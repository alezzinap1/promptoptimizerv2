from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet

from db.manager import DBManager
from services.api_key_crypto import decrypt_stored_user_api_key, encrypt_user_api_key_for_storage


class DBManagerTests(unittest.TestCase):
    def test_library_and_events_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            db = DBManager(str(db_path))
            db.init()

            item_id = db.save_to_library(
                title="JSON extractor",
                prompt="Ты — аналитик. Верни JSON.",
                tags=["json", "analysis"],
                target_model="gpt4o",
                task_type="analysis",
                techniques=["role_prompting", "structured_output"],
                notes="demo",
            )
            db.update_library_item(item_id, rating=5)
            items = db.get_library(search="JSON")

            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["rating"], 5)

            db.log_event("generate_requested", session_id="session-1", payload={"questions_mode": True})
            db.log_event(
                "generation_result",
                session_id="session-1",
                payload={"latency_ms": 1234, "completeness_score": 80.0, "outcome": "prompt"},
            )
            db.log_event("generate_prompt_success", session_id="session-1", payload={"target_model": "gpt4o"})
            db.log_event("prompt_saved_to_library", session_id="session-1", payload={"item_id": item_id})

            summary = db.get_product_metrics_summary()

            self.assertEqual(summary["generate_requests"], 1)
            self.assertEqual(summary["generated_prompts"], 1)
            self.assertEqual(summary["saved_prompts"], 1)
            self.assertEqual(summary["prompt_acceptance_rate"], 100.0)
            self.assertGreater(summary["avg_generation_latency_ms"], 0)

    def test_workspace_and_prompt_spec_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            db = DBManager(str(db_path))
            db.init()

            workspace_id = db.create_workspace(
                name="Code Review",
                description="Workspace for Python review prompts",
                config={"default_constraints": ["Не придумывать баги"]},
            )
            workspaces = db.list_workspaces()
            self.assertEqual(len(workspaces), 1)
            self.assertEqual(workspaces[0]["id"], workspace_id)

            spec_id = db.save_prompt_spec(
                session_id="session-42",
                workspace_id=workspace_id,
                raw_input="Проверь Python код",
                spec={"goal": "Проверить Python код", "output_format": "markdown"},
                evidence={"goal": {"source_type": "user"}},
                issues=[{"severity": "medium", "category": "missing_constraints"}],
            )
            latest = db.get_latest_prompt_spec("session-42")

            self.assertIsNotNone(latest)
            assert latest is not None
            self.assertEqual(latest["id"], spec_id)
            self.assertEqual(latest["workspace_id"], workspace_id)
            self.assertEqual(latest["spec"]["output_format"], "markdown")

    def test_users_and_session_binding(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            db = DBManager(str(db_path))
            db.init()

            user_id = db.create_user("alice", "hash")
            user = db.get_user_by_username("alice")
            self.assertIsNotNone(user)
            assert user is not None
            self.assertEqual(user["id"], user_id)

            db.bind_session_to_user("s-1", user_id)
            bound = db.get_session_user("s-1")
            self.assertIsNotNone(bound)
            assert bound is not None
            self.assertEqual(bound["username"], "alice")

            db.clear_session_binding("s-1")
            self.assertIsNone(db.get_session_user("s-1"))

    def test_session_rejected_when_expired(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            db = DBManager(str(db_path))
            db.init()
            user_id = db.create_user("bob", "hash")
            db.bind_session_to_user("s-exp", user_id)
            with db._conn() as conn:
                conn.execute(
                    "UPDATE user_sessions SET expires_at = ? WHERE session_id = ?",
                    (int(time.time()) - 60, "s-exp"),
                )
            self.assertIsNone(db.get_session_user("s-exp"))

    def test_openrouter_key_fernet_roundtrip(self) -> None:
        secret = Fernet.generate_key().decode()
        with patch.dict(os.environ, {"USER_API_KEY_FERNET_SECRET": secret}):
            raw = "sk-or-v1-demo-key-abcdef"
            stored = encrypt_user_api_key_for_storage(raw)
            self.assertTrue(stored.startswith("enc:v1:"))
            self.assertEqual(decrypt_stored_user_api_key(stored), raw)

    def test_multitenancy_isolation_for_library_and_workspaces(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            db = DBManager(str(db_path))
            db.init()

            user_a = db.create_user("user_a", "hash_a")
            user_b = db.create_user("user_b", "hash_b")

            db.create_workspace(name="A ws", config={}, user_id=user_a)
            db.create_workspace(name="B ws", config={}, user_id=user_b)

            db.save_to_library(title="A", prompt="a", user_id=user_a)
            db.save_to_library(title="B", prompt="b", user_id=user_b)

            ws_a = db.list_workspaces(user_id=user_a)
            ws_b = db.list_workspaces(user_id=user_b)
            lib_a = db.get_library(user_id=user_a)
            lib_b = db.get_library(user_id=user_b)

            self.assertEqual(len(ws_a), 1)
            self.assertEqual(len(ws_b), 1)
            self.assertEqual(ws_a[0]["name"], "A ws")
            self.assertEqual(ws_b[0]["name"], "B ws")
            self.assertEqual(len(lib_a), 1)
            self.assertEqual(len(lib_b), 1)
            self.assertEqual(lib_a[0]["title"], "A")
            self.assertEqual(lib_b[0]["title"], "B")


if __name__ == "__main__":
    unittest.main()

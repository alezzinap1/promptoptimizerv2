from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from db.manager import DBManager


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


if __name__ == "__main__":
    unittest.main()

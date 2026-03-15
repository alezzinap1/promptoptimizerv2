from __future__ import annotations

import unittest

from core.technique_registry import TechniqueRegistry


class TechniqueRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = TechniqueRegistry()

    def test_loads_known_techniques(self) -> None:
        ids = self.registry.get_all_ids()

        self.assertIn("role_prompting", ids)
        self.assertIn("structured_output", ids)

    def test_selects_small_model_safe_subset(self) -> None:
        selected = self.registry.select_techniques(
            task_types=["analysis"],
            complexity="high",
            max_techniques=5,
            target_model="small_model",
        )
        selected_ids = {tech["id"] for tech in selected}

        self.assertNotIn("chain_of_thought", selected_ids)

    def test_builds_technique_context(self) -> None:
        context = self.registry.build_technique_context(["role_prompting", "structured_output"])

        self.assertIn("Техника", context)
        self.assertIn("Role", context)

    def test_fallback_for_general_task_type(self) -> None:
        selected = self.registry.select_techniques(
            task_types=["general"],
            complexity="medium",
            max_techniques=3,
            target_model="unknown",
        )
        self.assertGreater(len(selected), 0)
        self.assertIn(selected[0]["id"], ["role_prompting", "structured_output", "constraints_prompting"])


if __name__ == "__main__":
    unittest.main()

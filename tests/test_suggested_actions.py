from __future__ import annotations

import unittest

from core.suggested_actions import build_suggested_actions


class SuggestedActionsTests(unittest.TestCase):
    def test_empty_when_no_prompt(self) -> None:
        self.assertEqual(
            build_suggested_actions(
                has_prompt=False,
                prompt_type="text",
                current_prompt="x",
                metrics=None,
            ),
            [],
        )

    def test_includes_iterate_hints_and_save(self) -> None:
        actions = build_suggested_actions(
            has_prompt=True,
            prompt_type="text",
            current_prompt="short",
            metrics={"completeness_score": 80, "token_estimate": 100},
        )
        ids = [a["id"] for a in actions]
        self.assertIn("creative", ids)
        self.assertIn("deep_improve", ids)
        self.assertNotIn("evaluate", ids)
        self.assertIn("save_library", ids)
        self.assertIn("compare", ids)

    def test_long_prompt_suggests_shorten(self) -> None:
        long = "x" * 2000
        actions = build_suggested_actions(
            has_prompt=True,
            prompt_type="skill",
            current_prompt=long,
            metrics={"completeness_score": 90},
        )
        ids = [a["id"] for a in actions]
        self.assertIn("shorten", ids)
        self.assertNotIn("compare", ids)

    def test_low_completeness_suggests_structure(self) -> None:
        actions = build_suggested_actions(
            has_prompt=True,
            prompt_type="text",
            current_prompt="hi",
            metrics={"completeness_score": 40},
        )
        ids = [a["id"] for a in actions]
        self.assertIn("structure", ids)


if __name__ == "__main__":
    unittest.main()

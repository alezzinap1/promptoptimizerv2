"""Tests for abuse protection module."""
from __future__ import annotations

import unittest

from app.abuse import check_input_size, check_session_budget
from app.config import MAX_INPUT_CHARS


class AbuseTests(unittest.TestCase):
    def test_input_size_ok(self) -> None:
        ok, _ = check_input_size("short text")
        self.assertTrue(ok)

    def test_input_size_exceeds_limit(self) -> None:
        ok, err = check_input_size("x" * (MAX_INPUT_CHARS + 1))
        self.assertFalse(ok)
        self.assertIn(str(MAX_INPUT_CHARS), err)

    def test_session_budget_ok(self) -> None:
        ok, _ = check_session_budget(10)
        self.assertTrue(ok)

    def test_session_budget_exceeded(self) -> None:
        from app.config import BUDGET_GENERATIONS_PER_SESSION

        ok, err = check_session_budget(BUDGET_GENERATIONS_PER_SESSION)
        self.assertFalse(ok)
        self.assertIn(str(BUDGET_GENERATIONS_PER_SESSION), err)

    def test_session_budget_with_additional(self) -> None:
        from app.config import BUDGET_GENERATIONS_PER_SESSION

        ok, _ = check_session_budget(BUDGET_GENERATIONS_PER_SESSION - 2, additional=2)
        self.assertTrue(ok)
        ok, _ = check_session_budget(BUDGET_GENERATIONS_PER_SESSION - 1, additional=2)
        self.assertFalse(ok)

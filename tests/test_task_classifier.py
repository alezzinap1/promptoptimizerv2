from __future__ import annotations

import unittest

from core.task_classifier import classify_task


class TaskClassifierTests(unittest.TestCase):
    def test_detects_code_and_debugging(self) -> None:
        result = classify_task(
            "Помоги сделать code review Python API: почему не работает обработчик, где баг, "
            "как исправить логику и какие тесты стоит добавить после фикса."
        )

        self.assertIn("code", result["task_types"])
        self.assertIn("debugging", result["task_types"])
        self.assertEqual(result["complexity"], "medium")

    def test_marks_short_request_as_low_complexity(self) -> None:
        result = classify_task("Коротко объясни JSON")

        self.assertEqual(result["complexity"], "low")
        self.assertIn("structured_output", result["task_types"])

    def test_marks_large_request_as_high_complexity(self) -> None:
        prompt = " ".join(["Сделай подробный production-ready анализ архитектуры"] * 30)
        result = classify_task(prompt)

        self.assertEqual(result["complexity"], "high")


if __name__ == "__main__":
    unittest.main()

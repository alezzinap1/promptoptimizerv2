from __future__ import annotations

import unittest

from core.quality_metrics import analyze_prompt


class QualityMetricsTests(unittest.TestCase):
    def test_scores_prompt_with_role_context_and_format(self) -> None:
        prompt = """
Ты — senior data analyst.
Контекст: работаешь с финансовыми отчётами.
Сделай следующее:
1. Извлеки ключевые метрики.
2. Укажи риски.
Верни результат в JSON.
Не придумывай данные.
""".strip()

        metrics = analyze_prompt(prompt)

        self.assertTrue(metrics["has_role"])
        self.assertTrue(metrics["has_context"])
        self.assertTrue(metrics["has_output_format"])
        self.assertGreaterEqual(metrics["completeness_score"], 60)

    def test_empty_prompt_returns_zeroed_metrics(self) -> None:
        metrics = analyze_prompt("   ")

        self.assertEqual(metrics["token_estimate"], 0)
        self.assertEqual(metrics["completeness_score"], 0.0)


if __name__ == "__main__":
    unittest.main()

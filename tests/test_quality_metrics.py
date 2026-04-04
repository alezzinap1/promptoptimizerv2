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

    def test_image_prompt_uses_visual_rubric(self) -> None:
        prompt = """
**Subject:** Clay cavemen hunting a woolly mammoth on a tundra.
**Style:** Claymation, cartoon, soft studio lighting.
**Composition:** Wide shot, low horizon.
**Lighting & palette:** Golden hour, warm earth tones.
**Negative:** Avoid realistic skin, extra fingers, watermark.
**Technical:** Aspect ratio 16:9, high detail.
""".strip()

        metrics = analyze_prompt(prompt, prompt_type="image", task_input="сгенерировать картинку")

        self.assertEqual(metrics.get("prompt_analysis_mode"), "image")
        self.assertGreaterEqual(metrics["completeness_score"], 55.0)
        self.assertIsInstance(metrics.get("improvement_tips"), list)


if __name__ == "__main__":
    unittest.main()

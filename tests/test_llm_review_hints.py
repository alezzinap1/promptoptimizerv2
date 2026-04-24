import unittest

from services.llm_review_hints import extract_llm_review_hints


class TestExtractLlmReviewHints(unittest.TestCase):
    def test_bullets_until_итог(self) -> None:
        text = """- первая мысль
- вторая длиннее чуть-чуть
* третья с звёздочкой
Итог: всё ок."""
        h = extract_llm_review_hints(text)
        self.assertEqual(len(h), 3)
        self.assertIn("первая мысль", h[0])

    def test_stops_at_итог(self) -> None:
        text = "- до\nИтог: после не берём\n- после"
        h = extract_llm_review_hints(text)
        self.assertEqual(h, ["до"])


if __name__ == "__main__":
    unittest.main()

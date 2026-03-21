from __future__ import annotations

import unittest

from core.parsing import (
    diagnose_generation_response,
    parse_questions,
    parse_reply,
    questions_have_weak_options,
)


class ParsingTests(unittest.TestCase):
    def test_parse_reply_extracts_reasoning_prompt_and_questions(self) -> None:
        reply = """
[REASONING]
Выбраны role prompting и structured output.
[/REASONING]

[PROMPT]
Ты — аналитик. Верни JSON.
[/PROMPT]

[QUESTIONS]
1. Для кого результат?
- Команда
- Клиент
[/QUESTIONS]
""".strip()

        parsed = parse_reply(reply)

        self.assertTrue(parsed["has_prompt"])
        self.assertTrue(parsed["has_questions"])
        self.assertIn("structured output", parsed["reasoning"].lower())
        self.assertIn("Верни JSON", parsed["prompt_block"])

    def test_parse_reply_normalizes_lowercase_markers(self) -> None:
        reply = """
[reasoning]
Кратко.
[/reasoning]

[prompt]
Текст промпта.
[/prompt]
""".strip()
        parsed = parse_reply(reply)
        self.assertTrue(parsed["has_prompt"])
        self.assertIn("Текст промпта", parsed["prompt_block"])

    def test_questions_have_weak_options_detects_skip_only(self) -> None:
        weak = [{"question": "Q1?", "options": ["Пропустить", "Пропустить"]}]
        strong = [{"question": "Q1?", "options": ["Кратко", "Подробно", "Пропустить"]}]
        self.assertTrue(questions_have_weak_options(weak))
        self.assertFalse(questions_have_weak_options(strong))

    def test_diagnose_generation_response(self) -> None:
        parsed_ok = {"has_prompt": True, "has_questions": False}
        self.assertFalse(diagnose_generation_response(parsed_ok, [])["format_failure"])
        parsed_bad = {"has_prompt": False, "has_questions": False}
        flags = diagnose_generation_response(parsed_bad, [])
        self.assertTrue(flags["format_failure"])
        parsed_qblock = {"has_prompt": False, "has_questions": True}
        self.assertTrue(diagnose_generation_response(parsed_qblock, [])["questions_unparsed"])

    def test_parse_questions_normalizes_options(self) -> None:
        raw = """
1. Какой язык нужен?
- Python

2. Нужен ли JSON?
- Да
- Нет
""".strip()

        questions = parse_questions(raw)

        self.assertIsNotNone(questions)
        assert questions is not None
        self.assertEqual(len(questions), 2)
        self.assertGreaterEqual(len(questions[0]["options"]), 2)
        self.assertIn("Пропустить", questions[0]["options"])


if __name__ == "__main__":
    unittest.main()

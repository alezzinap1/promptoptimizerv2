from __future__ import annotations

import unittest

from core.parsing import parse_questions, parse_reply


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

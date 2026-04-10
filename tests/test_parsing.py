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

    def test_parse_reply_extracts_test_cases_json(self) -> None:
        reply = """
[REASONING]
ok
[/REASONING]

[PROMPT]
Skill body
[/PROMPT]

[TEST_CASES]
[{"user": "hi", "expect_substring": "hello"}]
[/TEST_CASES]
""".strip()
        parsed = parse_reply(reply)
        self.assertTrue(parsed["has_prompt"])
        tc = parsed.get("test_cases") or []
        self.assertEqual(len(tc), 1)
        self.assertEqual(tc[0]["user"], "hi")
        self.assertEqual(tc[0]["expect_substring"], "hello")

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

    def test_parse_questions_implicit_header_before_bullets(self) -> None:
        """Модель часто пишет вопрос без «1.», сразу список «- …»."""
        raw = """
Какую задачу нужно оформить промптом?
- Ответ на вопрос
- Объяснение темы
- Составление текста
""".strip()

        questions = parse_questions(raw)
        self.assertIsNotNone(questions)
        assert questions is not None
        self.assertEqual(len(questions), 1)
        self.assertIn("оформить промптом", questions[0]["question"])
        self.assertGreaterEqual(len(questions[0]["options"]), 2)
        parsed_block = {"has_prompt": False, "has_questions": True}
        self.assertFalse(diagnose_generation_response(parsed_block, questions)["questions_unparsed"])

    def test_parse_reply_prompt_without_closing_tag(self) -> None:
        """Модель часто не пишет [/PROMPT] — блок всё равно извлекается."""
        reply = """
[REASONING]
Кратко.
[/REASONING]

[PROMPT]
Ты — эксперт. Верни JSON.
""".strip()
        parsed = parse_reply(reply)
        self.assertTrue(parsed["has_prompt"])
        self.assertIn("эксперт", parsed["prompt_block"])
        self.assertFalse(diagnose_generation_response(parsed, [])["format_failure"])

    def test_parse_reply_unclosed_prompt_strips_trailing_questions_block(self) -> None:
        """Хвост без [/PROMPT] не должен дублировать [QUESTIONS] в prompt_block."""
        reply = """
[REASONING]
r
[/REASONING]

[PROMPT]
Основной текст промпта.

[QUESTIONS]
1. Вопрос?
- А
- Б
[/QUESTIONS]
""".strip()
        parsed = parse_reply(reply)
        self.assertTrue(parsed["has_prompt"])
        self.assertIn("Основной текст", parsed["prompt_block"])
        self.assertNotIn("1. Вопрос", parsed["prompt_block"])
        self.assertTrue(parsed["has_questions"])

    def test_parse_reply_last_closing_prompt_tag_wins(self) -> None:
        """Литеральное [/PROMPT] в середине текста не обрезает промпт до мусора."""
        reply = """
[PROMPT]
Пиши слово [/PROMPT] только в конце ответа.
Реальный промпт продолжается.
[/PROMPT]
""".strip()
        parsed = parse_reply(reply)
        self.assertTrue(parsed["has_prompt"])
        self.assertIn("Реальный промпт", parsed["prompt_block"])
        self.assertIn("[/PROMPT]", parsed["prompt_block"])

    def test_parse_reply_reasoning_literal_close_inside_then_real_close(self) -> None:
        """В reasoning может встретиться текст «[/REASONING]» — берём последний закрывающий тег."""
        reply = """
[REASONING]
Упомянем тег [/REASONING] в примере.
Дальше настоящее рассуждение.
[/REASONING]

[PROMPT]
OK
[/PROMPT]
""".strip()
        parsed = parse_reply(reply)
        self.assertIn("настоящее", parsed["reasoning"].lower())
        self.assertIn("пример", parsed["reasoning"].lower())
        self.assertEqual(parsed["prompt_block"].strip(), "OK")

    def test_parse_reply_questions_without_close(self) -> None:
        raw = """
[PROMPT]
P
[/PROMPT]

[QUESTIONS]
1. Один?
- Да
""".strip()
        parsed = parse_reply(raw)
        self.assertTrue(parsed["has_questions"])
        self.assertIn("Один", parsed["questions_raw"])

    def test_trim_does_not_strip_json_line_with_questions_marker(self) -> None:
        """[QUESTIONS] внутри строки (не с начала строки) не отрезает промпт."""
        reply = """
[PROMPT]
Пример ключа "[QUESTIONS]" в JSON-строке.
Ещё строка.
""".strip()
        parsed = parse_reply(reply)
        self.assertTrue(parsed["has_prompt"])
        self.assertIn("[QUESTIONS]", parsed["prompt_block"])

    def test_parse_reply_rejects_unclosed_prompt_closed_with_reasoning_tag(self) -> None:
        """Модель открыла [PROMPT] и закрыла [/REASONING] — не считаем это готовым промптом."""
        reply = """
[REASONING]
Кратко.
[/REASONING]

[PROMPT]: Role Prompting, CoT. Техники.[/REASONING]
""".strip()
        parsed = parse_reply(reply)
        self.assertFalse(parsed["has_prompt"])
        self.assertEqual(parsed["prompt_block"].strip(), "")
        self.assertTrue(diagnose_generation_response(parsed, [])["format_failure"])


if __name__ == "__main__":
    unittest.main()

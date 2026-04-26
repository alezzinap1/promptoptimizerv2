from __future__ import annotations

import unittest

from core.agent_followup_rules import (
    AGENT_PRODUCT_HELP_TEXT,
    classify_agent_follow_up_api_response,
    looks_like_apply_tip_directive,
    looks_like_strong_edit,
    normalize_agent_user_message,
    parse_tags_from_text,
    parse_title_hint,
    resolve_has_prompt_action,
    semantic_chat_should_be_iterate,
)


class AgentFollowupRulesTests(unittest.TestCase):
    def test_normalize_strips_bom_and_zwsp(self) -> None:
        s = "\ufeff\u200bhello\u3000world"
        self.assertEqual(normalize_agent_user_message(s), "hello world")

    def test_apply_tip_variants(self) -> None:
        self.assertTrue(looks_like_apply_tip_directive("Примени совет: добавь ограничения"))
        self.assertTrue(looks_like_apply_tip_directive("apply tip: foo"))
        self.assertTrue(
            looks_like_apply_tip_directive("Учти по очереди советы судьи:\n1. добавь пример вывода")
        )
        self.assertTrue(
            looks_like_apply_tip_directive("Учти и примени советы по очереди:\n1. сократи вступление")
        )
        self.assertTrue(looks_like_apply_tip_directive("Учти совет судьи: укажи язык ответа"))
        self.assertFalse(looks_like_apply_tip_directive("как работает библиотека"))

    def test_strong_edit_commands(self) -> None:
        self.assertTrue(looks_like_strong_edit("убери третий пункт"))
        self.assertTrue(looks_like_strong_edit("сделай короче"))
        self.assertFalse(looks_like_strong_edit("сохрани в библиотеку"))

    def test_parse_tags(self) -> None:
        self.assertEqual(parse_tags_from_text('сохрани с тегами marketing, v2'), ["marketing", "v2"])

    def test_parse_title_hint(self) -> None:
        self.assertEqual(parse_title_hint('сохрани как названием «My Prompt»'), "My Prompt")

    def test_rules_save_library(self) -> None:
        r = classify_agent_follow_up_api_response("сохрани в библиотеку с тегами foo, bar", "text")
        self.assertEqual(r["action"], "save_library")
        self.assertEqual(r["data"]["tags"], ["foo", "bar"])

    def test_rules_eval_prompt(self) -> None:
        r = classify_agent_follow_up_api_response("оцени промпт", "text")
        self.assertEqual(r["action"], "eval_prompt")

    def test_rules_nav_library_search(self) -> None:
        r = classify_agent_follow_up_api_response('открой библиотеку по запросу "alpha"', "text")
        self.assertEqual(r["action"], "nav_library")
        self.assertEqual(r["data"].get("search"), "alpha")

    def test_rules_product_help(self) -> None:
        r = classify_agent_follow_up_api_response("как работает версионирование?", "text")
        self.assertEqual(r["action"], "chat")
        self.assertEqual(r["data"]["message"], AGENT_PRODUCT_HELP_TEXT)

    def test_rules_default_iterate(self) -> None:
        r = classify_agent_follow_up_api_response("добавь пример использования в конец", "text")
        self.assertEqual(r["action"], "iterate")
        self.assertEqual(r["data"]["feedback"], "добавь пример использования в конец")

    def test_semantic_chat_override_apply_tip(self) -> None:
        self.assertTrue(semantic_chat_should_be_iterate("chat", "Примени совет: x"))
        self.assertTrue(
            semantic_chat_should_be_iterate(
                "chat",
                "Учти по очереди советы судьи:\n1. уточни объём",
            )
        )
        self.assertFalse(semantic_chat_should_be_iterate("chat", "как работает библиотека"))

    def test_judge_hints_bulk_not_product_help(self) -> None:
        """Тело совета может содержать «версии», «полноту» и т.д. — не должно уходить в product_help."""
        text = (
            "Учти по очереди советы судьи:\n"
            "1. проверь версии требований\n"
            "2. оцени полноту критериев"
        )
        r = classify_agent_follow_up_api_response(text, "text")
        self.assertEqual(r["action"], "iterate")
        self.assertEqual(r["data"]["feedback"], text)


class ResolveHasPromptActionTests(unittest.TestCase):
    def _resolve(
        self,
        text: str,
        route_result: dict,
        prompt_type: str = "text",
    ) -> dict:
        return resolve_has_prompt_action(text, prompt_type, route_result)

    def test_strong_edit_overrides_semantic_save(self) -> None:
        r = self._resolve(
            "убери второй пункт",
            {"intent": "save_library", "confidence": 0.99, "margin": 0.5},
        )
        self.assertEqual(r["action"], "iterate")

    def test_falls_back_to_rules_when_intent_none(self) -> None:
        r = self._resolve("сохрани в библиотеку", {"intent": None, "confidence": 0.0, "margin": 0.0})
        self.assertEqual(r["action"], "save_library")

    def test_semantic_iterate(self) -> None:
        r = self._resolve(
            "перефразируй вежливее",
            {"intent": "iterate", "confidence": 0.99, "margin": 0.5},
        )
        self.assertEqual(r["action"], "iterate")

    def test_semantic_save_includes_tags(self) -> None:
        r = self._resolve(
            "сохрани с тегами x, y",
            {"intent": "save_library", "confidence": 0.99, "margin": 0.5},
        )
        self.assertEqual(r["action"], "save_library")
        self.assertEqual(r["data"]["tags"], ["x", "y"])

    def test_semantic_chat_message(self) -> None:
        r = self._resolve(
            "что такое trial",
            {"intent": "chat", "confidence": 0.99, "margin": 0.5},
        )
        self.assertEqual(r["action"], "chat")
        self.assertIn("Версии", r["data"]["message"])

    def test_judge_hints_override_semantic_chat(self) -> None:
        r = self._resolve(
            "Учти по очереди советы судьи:\n1. добавь пример",
            {"intent": "chat", "confidence": 0.99, "margin": 0.5},
        )
        self.assertEqual(r["action"], "iterate")

    def test_nav_compare_explicit_action(self) -> None:
        r = self._resolve(
            "открой сравнение",
            {"intent": "nav_compare", "confidence": 0.99, "margin": 0.5},
        )
        self.assertEqual(r["action"], "nav_compare")


if __name__ == "__main__":
    unittest.main()

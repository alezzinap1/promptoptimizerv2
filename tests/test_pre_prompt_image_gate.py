"""Гейты пре-промпта для вкладки image и очистка фраз в чате студии."""
from __future__ import annotations

import unittest

from core.pre_prompt_gate import (
    pre_prompt_image_tab_scene_warrants_task,
    pre_prompt_rules_meta_chat,
)
from services.agent_studio_chat_reply import strip_agent_meta_phrases


class PrePromptImageGateTests(unittest.TestCase):
    def test_scene_description_not_meta_only(self) -> None:
        self.assertTrue(pre_prompt_image_tab_scene_warrants_task("кот космонавт"))
        self.assertTrue(
            pre_prompt_image_tab_scene_warrants_task(
                "большие жуткие пауки нападают на поселение добрых беззащитных людей"
            )
        )

    def test_greeting_and_ack_not_scene(self) -> None:
        self.assertFalse(pre_prompt_image_tab_scene_warrants_task("привет"))
        self.assertFalse(pre_prompt_image_tab_scene_warrants_task("ок"))
        self.assertFalse(pre_prompt_image_tab_scene_warrants_task("спасибо"))

    def test_meta_chat_still_true_for_short_two_words(self) -> None:
        """Старая эвристика meta_chat по-прежнему ловит 2 коротких слова — image-гейт обходит это раньше в agent_route."""
        self.assertTrue(pre_prompt_rules_meta_chat("кот космонавт"))


class StripAgentMetaPhrasesTests(unittest.TestCase):
    def test_strips_generation_promise_ru(self) -> None:
        raw = "Отлично! Сейчас сгенерируем промпт по описанию. Ещё идеи: абстракция."
        out = strip_agent_meta_phrases(raw)
        self.assertNotIn("сгенерируем", out.lower())
        self.assertIn("абстракция", out.lower())

    def test_strips_generation_promise_en(self) -> None:
        raw = "Nice. Will generate the prompt now. Try abstract art."
        out = strip_agent_meta_phrases(raw)
        self.assertNotIn("generate", out.lower())
        self.assertIn("abstract", out.lower())


if __name__ == "__main__":
    unittest.main()

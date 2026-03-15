from __future__ import annotations

import unittest

from core.evidence import build_evidence_map
from core.intent_graph import build_intent_graph
from core.prompt_debugger import analyze_prompt_spec
from core.prompt_spec import build_generation_brief, build_prompt_spec


class PromptSpecTests(unittest.TestCase):
    def test_builds_spec_with_workspace_defaults(self) -> None:
        spec = build_prompt_spec(
            raw_input="Нужен промпт для анализа отчёта и возврата результата в JSON. Не придумывай факты.",
            classification={"task_types": ["analysis"], "complexity": "medium"},
            target_model="gpt4o",
            workspace={
                "id": 1,
                "name": "Finance",
                "config": {
                    "default_constraints": ["Сохраняй точность"],
                    "reference_snippets": ["Используй только поля из отчёта"],
                },
            },
        )

        self.assertEqual(spec["output_format"], "json")
        self.assertIn("Сохраняй точность", spec["constraints"])
        self.assertIn("workspace_reference_snippets", spec["source_of_truth"])
        self.assertIn("user_provided_report", spec["source_of_truth"])
        self.assertIn("Не додумывать факты", spec["success_criteria"])

    def test_builds_evidence_and_intent_graph(self) -> None:
        spec = build_prompt_spec(
            raw_input="Верни результат в JSON. Не добавляй лишнего текста.",
            classification={"task_types": ["analysis"], "complexity": "low"},
        )
        evidence = build_evidence_map(spec, spec["input_description"])
        graph = build_intent_graph(spec)

        self.assertEqual(evidence["output_format"]["source_type"], "user")
        self.assertTrue(evidence["success_criteria"]["value_preview"])
        self.assertTrue(any(node["id"] == "goal" for node in graph))

    def test_debugger_finds_missing_grounding(self) -> None:
        spec = build_prompt_spec(
            raw_input="Проанализируй ситуацию и дай рекомендации.",
            classification={"task_types": ["analysis"], "complexity": "medium"},
        )
        issues = analyze_prompt_spec(spec)
        brief = build_generation_brief(spec)

        self.assertTrue(any(issue["category"] == "weak_grounding" for issue in issues))
        self.assertIn("СТРУКТУРИРОВАННАЯ СПЕЦИФИКАЦИЯ", brief)

    def test_debugger_finds_instruction_conflict(self) -> None:
        spec = build_prompt_spec(
            raw_input="Дай краткий и подробный анализ.",
            classification={"task_types": ["analysis"], "complexity": "medium"},
            overrides={
                "success_criteria": ["Ответ должен быть кратким", "Ответ должен быть подробным"],
            },
        )
        issues = analyze_prompt_spec(spec)
        self.assertTrue(any(issue["category"] == "instruction_conflict" for issue in issues))

    def test_debugger_finds_vague_goal(self) -> None:
        spec = build_prompt_spec(
            raw_input="Улучши этот текст.",
            classification={"task_types": ["general"], "complexity": "low"},
        )
        issues = analyze_prompt_spec(spec)
        self.assertTrue(any(issue["category"] == "vague_goal" for issue in issues))

    def test_overrides_replace_auto_inference(self) -> None:
        spec = build_prompt_spec(
            raw_input="Сделай анализ документа.",
            classification={"task_types": ["analysis"], "complexity": "medium"},
            overrides={
                "audience": "финансовый аналитик",
                "output_format": "table",
                "source_of_truth": ["user_provided_document"],
                "success_criteria": ["Ответ должен быть кратким"],
                "constraints": ["Не придумывать факты"],
            },
        )

        self.assertEqual(spec["audience"], "финансовый аналитик")
        self.assertEqual(spec["output_format"], "table")
        self.assertEqual(spec["source_of_truth"], ["user_provided_document"])
        self.assertEqual(spec["success_criteria"], ["Ответ должен быть кратким"])
        self.assertEqual(spec["constraints"], ["Не придумывать факты"])


if __name__ == "__main__":
    unittest.main()

"""
Technique Registry — loads YAML technique cards from techniques/ directory.
Provides selection, filtering and context-building methods.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

TECHNIQUES_DIR = Path(__file__).parent.parent / "techniques"

# Which techniques degrade on small models (< ~13B params)
AVOID_ON_SMALL_MODELS = {"chain_of_thought", "self_consistency", "meta_prompting", "tree_of_thoughts"}

# Claude-specific techniques (XML framing, thinking tags)
CLAUDE_PREFERRED = {"xml_framing", "role_prompting", "chain_of_thought", "constraints_prompting"}

# Fallback when no technique matches task_type (e.g. "general", "data_analysis")
FALLBACK_TECHNIQUE_IDS = ["role_prompting", "structured_output", "constraints_prompting"]


class TechniqueRegistry:
    def __init__(self, techniques_dir: Path | None = None):
        self._dir = techniques_dir or TECHNIQUES_DIR
        self._techniques: dict[str, dict[str, Any]] = {}
        self._load_all()

    def _load_all(self) -> None:
        if not self._dir.exists():
            logger.warning("Techniques directory not found: %s", self._dir)
            return
        for path in sorted(self._dir.glob("*.yaml")):
            try:
                with open(path, encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if data and isinstance(data, dict) and "id" in data:
                    self._techniques[data["id"]] = data
            except Exception as e:
                logger.error("Failed to load %s: %s", path.name, e)
        logger.info("TechniqueRegistry: loaded %d techniques", len(self._techniques))

    def get(self, technique_id: str) -> dict[str, Any] | None:
        return self._techniques.get(technique_id)

    def get_all_ids(self) -> list[str]:
        return list(self._techniques.keys())

    def get_all(self) -> list[dict[str, Any]]:
        return list(self._techniques.values())

    def get_by_task_type(
        self,
        task_type: str,
        complexity: str = "medium",
        target_model: str = "unknown",
    ) -> list[dict[str, Any]]:
        """Return techniques suitable for task_type, complexity and target_model."""
        results = []
        is_small_model = target_model == "small_model"

        for tech in self._techniques.values():
            when = tech.get("when_to_use", {})
            task_types = when.get("task_types", [])
            complexities = when.get("complexity", [])
            not_for = when.get("not_for", [])

            if task_type in not_for:
                continue
            if is_small_model and tech["id"] in AVOID_ON_SMALL_MODELS:
                continue
            if task_type in task_types and (not complexities or complexity in complexities):
                results.append(tech)

        return sorted(results, key=lambda t: t.get("priority", 99))

    def select_techniques(
        self,
        task_types: list[str],
        complexity: str = "medium",
        max_techniques: int = 3,
        target_model: str = "unknown",
    ) -> list[dict[str, Any]]:
        """Select optimal technique set for given task types and target model."""
        seen: set[str] = set()
        selected: list[dict[str, Any]] = []

        # Boost Claude-specific techniques if target is Claude
        is_claude = "claude" in target_model

        for task_type in task_types:
            candidates = self.get_by_task_type(task_type, complexity, target_model)
            for tech in candidates:
                tid = tech["id"]
                if tid not in seen:
                    seen.add(tid)
                    selected.append(tech)

        # Sort: Claude targets prefer claude-specific techniques
        if is_claude:
            selected.sort(key=lambda t: (0 if t["id"] in CLAUDE_PREFERRED else 1, t.get("priority", 99)))
        else:
            selected.sort(key=lambda t: t.get("priority", 99))

        result = selected[:max_techniques]
        if not result:
            # No technique matched task_types (e.g. "general", "data_analysis") — use fallback
            for tid in FALLBACK_TECHNIQUE_IDS:
                tech = self._techniques.get(tid)
                if tech and (target_model != "small_model" or tid not in AVOID_ON_SMALL_MODELS):
                    result.append(tech)
                    if len(result) >= max_techniques:
                        break
        return result[:max_techniques]

    def build_technique_context(self, technique_ids: list[str]) -> str:
        """Build compact context string from technique cards for injection into system prompt."""
        parts: list[str] = []
        for tid in technique_ids:
            tech = self._techniques.get(tid)
            if not tech:
                continue
            lines = [f"## Техника: {tech.get('name', tid)}"]

            why = tech.get("why_it_works", "")
            if why:
                lines.append(f"Почему работает: {why.strip()}")

            core = tech.get("core_pattern", "")
            if core:
                lines.append(f"Базовый шаблон:\n{core.strip()}")
            else:
                variants = tech.get("variants", [])
                if variants:
                    v = variants[0]
                    lines.append(f"Шаблон ({v.get('name', 'основной')}):\n{v.get('pattern', '').strip()}")

            anti = tech.get("anti_patterns", [])
            if anti:
                lines.append("Не применять когда: " + "; ".join(anti[:2]))

            parts.append("\n".join(lines))

        return "\n\n---\n\n".join(parts)

    def explain_technique(self, technique_id: str) -> str:
        """Generate human-readable explanation for a technique."""
        tech = self._techniques.get(technique_id)
        if not tech:
            return f"Техника '{technique_id}' не найдена."

        lines = [
            f"### {tech.get('name', technique_id)}",
            "",
            f"**Как работает:** {tech.get('why_it_works', '').strip()}",
        ]

        when = tech.get("when_to_use", {})
        task_types = when.get("task_types", [])
        if task_types:
            lines.append(f"\n**Применяется для:** {', '.join(task_types)}")

        not_for = when.get("not_for", [])
        if not_for:
            lines.append(f"**Не подходит для:** {', '.join(not_for)}")

        variants = tech.get("variants", [])
        if variants:
            lines.append("\n**Варианты применения:**")
            for v in variants[:4]:
                lines.append(
                    f"- **{v.get('name', '—')}** "
                    f"({v.get('cost_tokens', '?')} токенов): {v.get('use_when', '')}"
                )

        anti = tech.get("anti_patterns", [])
        if anti:
            lines.append("\n**Типичные ошибки:**")
            for a in anti[:3]:
                lines.append(f"- ⚠️ {a}")

        compat = tech.get("compatibility", {})
        combines = compat.get("combines_well_with", [])
        if combines:
            lines.append(f"\n**Хорошо сочетается с:** {', '.join(combines)}")

        return "\n".join(lines)

    def reload(self) -> None:
        self._techniques.clear()
        self._load_all()

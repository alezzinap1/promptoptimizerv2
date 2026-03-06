"""
Реестр техник промптинга.
Загружает YAML-карточки из папки techniques/ и предоставляет
методы для поиска и выборки техник по задаче.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

# Путь к папке с YAML-карточками
TECHNIQUES_DIR = Path(__file__).parent.parent.parent / "techniques"


class TechniqueRegistry:
    """Загружает и хранит все карточки техник промптинга."""

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
                    logger.debug("Loaded technique: %s", data["id"])
            except Exception as e:
                logger.error("Failed to load technique %s: %s", path.name, e)
        logger.info("TechniqueRegistry: loaded %d techniques", len(self._techniques))

    def get(self, technique_id: str) -> dict[str, Any] | None:
        return self._techniques.get(technique_id)

    def get_all_ids(self) -> list[str]:
        return list(self._techniques.keys())

    def get_all(self) -> list[dict[str, Any]]:
        return list(self._techniques.values())

    def get_by_task_type(self, task_type: str, complexity: str = "medium") -> list[dict[str, Any]]:
        """Возвращает список техник подходящих для данного task_type и complexity."""
        results = []
        for tech in self._techniques.values():
            when = tech.get("when_to_use", {})
            task_types = when.get("task_types", [])
            complexities = when.get("complexity", [])
            not_for = when.get("not_for", [])

            if task_type in not_for:
                continue
            if task_type in task_types and (not complexities or complexity in complexities):
                results.append(tech)

        return sorted(results, key=lambda t: t.get("priority", 99))

    def select_techniques(
        self,
        task_types: list[str],
        complexity: str = "medium",
        max_techniques: int = 3,
    ) -> list[dict[str, Any]]:
        """
        Выбирает оптимальный набор техник для набора task_types.
        Возвращает не более max_techniques карточек (по приоритету).
        """
        seen_ids: set[str] = set()
        selected: list[dict[str, Any]] = []

        for task_type in task_types:
            candidates = self.get_by_task_type(task_type, complexity)
            for tech in candidates:
                tid = tech["id"]
                if tid not in seen_ids:
                    seen_ids.add(tid)
                    selected.append(tech)

        selected.sort(key=lambda t: t.get("priority", 99))
        return selected[:max_techniques]

    def build_technique_context(self, technique_ids: list[str]) -> str:
        """
        Собирает компактный контекст из карточек для инжекции в system prompt.
        Включает только name, why_it_works, core_pattern/variants и anti_patterns.
        Цель: минимум токенов при максимуме полезной информации.
        """
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
                    main_variant = variants[0]
                    lines.append(f"Шаблон ({main_variant.get('name', 'основной')}):\n{main_variant.get('pattern', '').strip()}")

            anti = tech.get("anti_patterns", [])
            if anti:
                lines.append("Не применять когда: " + "; ".join(anti[:2]))

            parts.append("\n".join(lines))

        return "\n\n---\n\n".join(parts)

    def explain_technique(self, technique_id: str) -> str:
        """
        Генерирует понятное объяснение техники для пользователя.
        Используется для кнопки "Почему так".
        """
        tech = self._techniques.get(technique_id)
        if not tech:
            return f"Техника '{technique_id}' не найдена в базе."

        lines = [
            f"📚 <b>{tech.get('name', technique_id)}</b>",
            "",
            f"<b>Как работает:</b> {tech.get('why_it_works', '').strip()}",
        ]

        when = tech.get("when_to_use", {})
        task_types = when.get("task_types", [])
        if task_types:
            lines.append(f"\n<b>Применяется для:</b> {', '.join(task_types)}")

        not_for = when.get("not_for", [])
        if not_for:
            lines.append(f"<b>Не подходит для:</b> {', '.join(not_for)}")

        variants = tech.get("variants", [])
        if variants:
            lines.append(f"\n<b>Варианты применения:</b>")
            for v in variants[:3]:
                lines.append(f"  • <b>{v.get('name', '—')}</b> ({v.get('cost_tokens', '?')} токенов): {v.get('use_when', '')}")

        anti = tech.get("anti_patterns", [])
        if anti:
            lines.append(f"\n<b>Типичные ошибки:</b>")
            for a in anti[:3]:
                lines.append(f"  ⚠️ {a}")

        return "\n".join(lines)

    def reload(self) -> None:
        """Перезагружает все карточки с диска (для hot-reload при разработке)."""
        self._techniques.clear()
        self._load_all()

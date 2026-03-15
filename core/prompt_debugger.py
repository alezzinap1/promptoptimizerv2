"""
Rule-based prompt debugger for the Prompt IDE flow.

This debugger focuses on structural problems in the prompt specification rather
than scoring final model quality. It is intentionally deterministic and cheap
so it can run on every edit and remain explainable.

Covers: missing fields, output ambiguity, grounding, constraints, model fit,
instruction conflicts, vague goals, reliability gaps, overloaded specs.
"""
from __future__ import annotations

import re


def _issue(
    severity: str,
    category: str,
    message: str,
    why_it_matters: str,
    suggested_fix: str,
    affected_fields: list[str],
) -> dict:
    """Create a normalized debugger issue payload."""
    return {
        "severity": severity,
        "category": category,
        "message": message,
        "why_it_matters": why_it_matters,
        "suggested_fix": suggested_fix,
        "affected_fields": affected_fields,
    }


def analyze_prompt_spec(spec: dict) -> list[dict]:
    """Return structural issues found in the PromptSpec."""
    issues: list[dict] = []
    task_types = set(spec.get("task_types", []))

    if not spec.get("goal"):
        issues.append(
            _issue(
                "high",
                "missing_critical_field",
                "Не определена цель задачи.",
                "Без чёткой цели prompt будет слишком общим и расплывчатым.",
                "Сформулируй желаемый результат одним предложением.",
                ["goal"],
            )
        )

    needs_structured_output = bool(
        task_types.intersection({"analysis", "structured_output", "data_analysis", "code", "research"})
    )
    if not spec.get("output_format") and needs_structured_output:
        issues.append(
            _issue(
                "medium",
                "output_schema_ambiguity",
                "Не указан формат вывода.",
                "Модель может вернуть ответ в неудобной или нестабильной форме.",
                "Укажи явный формат: JSON, таблица, список, markdown или другой шаблон.",
                ["output_format"],
            )
        )

    if not spec.get("source_of_truth") and bool(
        task_types.intersection({"analysis", "research", "data_analysis", "code", "debugging"})
    ):
        issues.append(
            _issue(
                "high",
                "weak_grounding",
                "Для аналитической задачи не указан источник истины.",
                "Модель будет вынуждена додумывать факты и это повышает риск галлюцинаций.",
                "Добавь документ, данные, исходный код или явно укажи, на чём должна основываться модель.",
                ["source_of_truth"],
            )
        )

    if not spec.get("constraints"):
        issues.append(
            _issue(
                "medium",
                "missing_constraints",
                "У задачи нет явных ограничений.",
                "Без ограничений модель чаще уходит в лишние детали и нестабильный формат.",
                "Добавь 1-3 ограничения: что делать нельзя, что обязательно сохранить, где нужно быть осторожным.",
                ["constraints"],
            )
        )

    if spec.get("target_model") == "small_model" and len(spec.get("constraints", [])) > 4:
        issues.append(
            _issue(
                "medium",
                "model_mismatch",
                "PromptSpec может быть перегружен для небольшой модели.",
                "Small models хуже держат длинные и многослойные инструкции.",
                "Сократи число ограничений и сделай структуру более прямой.",
                ["target_model", "constraints"],
            )
        )

    if spec.get("previous_prompt") and not spec.get("constraints"):
        issues.append(
            _issue(
                "low",
                "iteration_without_direction",
                "Итерация идёт без явных критериев правки.",
                "Модель может переписать prompt слишком широко, а не улучшить его точечно.",
                "Добавь хотя бы одно ограничение или критерий успеха для итерации.",
                ["previous_prompt", "constraints"],
            )
        )

    if not spec.get("success_criteria"):
        issues.append(
            _issue(
                "low",
                "missing_success_criteria",
                "Не заданы явные критерии успеха.",
                "Будет труднее понять, чем хороший prompt отличается от просто приемлемого.",
                "Добавь 1-2 критерия успеха: точность, краткость, формат, полнота или поведение при ошибках.",
                ["success_criteria"],
            )
        )

    if spec.get("output_format") == "json" and not spec.get("source_of_truth"):
        issues.append(
            _issue(
                "medium",
                "schema_without_grounding",
                "Структурированный вывод задан, но источник данных не определён.",
                "JSON сам по себе не делает prompt надёжным: без grounding модель может аккуратно структурировать выдуманные данные.",
                "Укажи, откуда брать данные и что делать при отсутствии значений.",
                ["output_format", "source_of_truth"],
            )
        )

    # Instruction conflicts: contradictory brevity vs detail
    all_text = " ".join(
        (spec.get("constraints") or [])
        + (spec.get("success_criteria") or [])
        + [spec.get("goal") or ""]
    ).lower()
    brevity = bool(re.search(r"кратк|лаконич|коротк|сжато|compact|concise", all_text))
    detail = bool(re.search(r"подробн|детальн|развернут|глубок|detailed|thorough", all_text))
    if brevity and detail:
        issues.append(
            _issue(
                "medium",
                "instruction_conflict",
                "Противоречивые требования: краткость и подробность одновременно.",
                "Модель не сможет одновременно быть краткой и подробной — это создаёт неопределённость.",
                "Выбери один приоритет: либо краткость, либо детальность. Можно уточнить: «кратко, но с ключевыми фактами».",
                ["constraints", "success_criteria", "goal"],
            )
        )

    # Ambiguity: vague goal without specifics
    goal = (spec.get("goal") or "").lower()
    vague_verbs = r"улучши|сделай лучше|оптимизируй|переработай|доработай|исправь"
    if goal and re.search(vague_verbs, goal) and len(goal.split()) < 8:
        issues.append(
            _issue(
                "medium",
                "vague_goal",
                "Цель сформулирована слишком размыто.",
                "Глаголы «улучши», «оптимизируй» без конкретики не дают модели чёткого направления.",
                "Уточни: что именно улучшить, по каким критериям, в каком аспекте.",
                ["goal"],
            )
        )

    # Reliability gaps: no fallback / error policy
    reliability_signals = r"при ошибк|при отсутствии|fallback|если нет|если данных нет|отказ|refuse"
    if not re.search(reliability_signals, all_text) and needs_structured_output:
        issues.append(
            _issue(
                "low",
                "reliability_gap",
                "Не задано поведение при отсутствии данных или ошибках.",
                "Модель может додумывать или возвращать некорректные структуры вместо явного «нет данных».",
                "Добавь правило: что возвращать при отсутствии данных, как обрабатывать ошибки.",
                ["constraints", "success_criteria"],
            )
        )

    # Overloaded for simple task
    complexity = spec.get("complexity", "medium")
    constraints_count = len(spec.get("constraints") or [])
    if complexity == "low" and constraints_count > 4:
        issues.append(
            _issue(
                "low",
                "overloaded_for_task",
                "Слишком много ограничений для простой задачи.",
                "Простая задача с большим числом ограничений может запутать модель и усложнить поддержку prompt.",
                "Сократи ограничения до 2–3 ключевых или повысь complexity.",
                ["constraints", "complexity"],
            )
        )

    # Audience without success criteria
    if spec.get("audience") and not spec.get("success_criteria"):
        issues.append(
            _issue(
                "low",
                "audience_without_criteria",
                "Указана аудитория, но нет критериев успеха под неё.",
                "Без критериев трудно понять, подходит ли результат для выбранной аудитории.",
                "Добавь 1–2 критерия: уровень детализации, терминология, формат под аудиторию.",
                ["audience", "success_criteria"],
            )
        )

    return issues

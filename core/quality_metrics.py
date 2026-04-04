"""
Heuristic quality metrics for prompts.
No LLM calls — pure text analysis.
Provides actionable scores to help users understand prompt quality.
"""
from __future__ import annotations

import re

from core.tokenizer import count_tokens, estimate_tokens_quick


def estimate_tokens(text: str, model_id: str = "") -> int:
    """
    Token count — exact for OpenAI models via tiktoken, approximate for others.
    Falls back to char-based estimation when model is unknown.
    """
    if model_id:
        return count_tokens(text, model_id)["tokens"]
    return estimate_tokens_quick(text)


def count_instructions(text: str) -> int:
    """Count explicit instructions: numbered items and bullet points."""
    count = 0
    for line in text.split("\n"):
        stripped = line.strip()
        if re.match(r"^\d+[\.\)]\s+\S", stripped):
            count += 1
        elif re.match(r"^[-•*]\s+\S", stripped):
            count += 1
    return count


def count_constraints(text: str) -> int:
    """Count explicit constraints and restrictions in the text."""
    constraint_signals = [
        "не ", "нельзя", "запрещено", "запрещен", "избегай", "без ",
        "только ", "исключительно", "никогда", "всегда", "обязательно",
        "don't", "never", "always", "must not", "avoid", "only",
        "without", "no ", "except", "prohibited", "required", "must",
        "не добавляй", "не используй", "не включай", "не делай",
    ]
    lower = text.lower()
    return sum(1 for w in constraint_signals if w in lower)


def has_role(text: str) -> bool:
    """Check if prompt defines an explicit role for the model."""
    patterns = [
        "ты —", "ты -", "you are", "act as", "assume the role",
        "вы —", "вы -", "представь что ты", "imagine you are",
        "your role is", "твоя роль",
    ]
    lower = text.lower()
    return any(p in lower for p in patterns)


def has_output_format(text: str) -> bool:
    """Check if the expected output format is explicitly specified."""
    format_signals = [
        "json", "markdown", "таблиц", "список", "формат", "структур",
        "верни в", "выведи в", "xml", "yaml", "csv", "numbered",
        "bullet", "пронумеруй", "маркированный", "формате ответа",
        "output format", "return as", "respond with", "provide a",
        "в виде", "в формате",
    ]
    lower = text.lower()
    return any(f in lower for f in format_signals)


def has_examples(text: str) -> bool:
    """Check if few-shot examples are included."""
    example_signals = [
        "например:", "пример:", "example:", "e.g.", "input:", "output:",
        "образец", "for example", "как например", "вот пример",
        "ввод:", "вывод:", "input:\n", "output:\n", "# пример",
        "sample:", "sample input", "expected output",
    ]
    lower = text.lower()
    return any(p in lower for p in example_signals)


def has_context(text: str) -> bool:
    """Check if background context is provided."""
    context_signals = [
        "контекст:", "background:", "context:", "дано:", "given:",
        "в контексте", "в рамках", "для проекта", "ситуация:",
        "you are working on", "задача находится", "работаешь с",
    ]
    lower = text.lower()
    return any(p in lower for p in context_signals)


def has_cot_trigger(text: str) -> bool:
    """Check if Chain of Thought is triggered."""
    cot_signals = [
        "шаг за шагом", "step by step", "пошагово", "по шагам",
        "think step", "рассуждай", "сначала", "затем", "наконец",
        "шаг 1", "step 1", "во-первых",
    ]
    lower = text.lower()
    return any(p in lower for p in cot_signals)


def compute_completeness_score(metrics: dict) -> float:
    """
    Compute completeness checklist score (0–100).
    This is NOT a measure of model output quality — only presence of typical prompt elements.

    Rubric:
    - Role defined:       25 pts
    - Output format:      20 pts
    - Instructions:       up to 20 pts (5 per instruction, max 4)
    - Constraints:        up to 15 pts (5 per constraint, max 3)
    - Examples present:   10 pts
    - Context provided:   10 pts
    """
    score = 0.0

    if metrics["has_role"]:
        score += 25

    if metrics["has_output_format"]:
        score += 20

    score += min(20, metrics["instruction_count"] * 5)
    score += min(15, metrics["constraint_count"] * 5)

    if metrics["has_examples"]:
        score += 10

    if metrics["has_context"]:
        score += 10

    return min(100.0, score)


def get_completeness_label(score: float) -> str:
    """Label for completeness checklist score (not quality of model output)."""
    if score >= 80:
        return "Полный"
    if score >= 60:
        return "Хороший"
    if score >= 40:
        return "Средний"
    if score >= 20:
        return "Базовый"
    return "Минимальный"


def get_quality_label(score: float) -> str:
    """Alias for backward compatibility."""
    return get_completeness_label(score)


def get_improvement_tips(metrics: dict) -> list[str]:
    """Return actionable improvement suggestions based on metrics."""
    tips = []

    if not metrics["has_role"]:
        tips.append("Добавь роль: 'Ты — [эксперт]. ...' — повышает качество на 15–25%")

    if not metrics["has_output_format"]:
        tips.append("Укажи формат вывода: JSON, таблица, список с полями, etc.")

    if metrics["instruction_count"] < 2:
        tips.append("Добавь конкретные инструкции (пронумерованный список шагов)")

    if metrics["constraint_count"] == 0:
        tips.append("Добавь ограничения: что модель НЕ должна делать")

    if not metrics["has_examples"]:
        tips.append("Few-Shot: добавь 1–2 примера ввода/вывода для сложных задач")

    if not metrics["has_context"]:
        tips.append("Добавь контекст: для кого/чего создаётся результат")

    if not metrics["has_cot_trigger"] and metrics["token_estimate"] > 100:
        tips.append("Для сложных задач: добавь 'Думай шаг за шагом перед ответом'")

    return tips


def _cyrillic_letter_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    cyr = sum(1 for c in letters if "\u0400" <= c <= "\u04ff")
    return cyr / len(letters)


def _language_mismatch_tip(task_input: str | None, prompt_text: str) -> str | None:
    if not task_input or not prompt_text or len(task_input.strip()) < 6:
        return None
    ti = task_input.strip()
    pt = prompt_text.strip()
    c_task = _cyrillic_letter_ratio(ti)
    c_prompt = _cyrillic_letter_ratio(pt)
    if c_task >= 0.45 and c_prompt < 0.2:
        return (
            "Задача преимущественно на русском, а промпт — на английском. "
            "Если целевая модель не требует английских тегов, сформулируйте описание на языке задачи."
        )
    if c_task < 0.2 and c_prompt >= 0.45:
        return "Задача на латинице, а промпт с большой долей кириллицы — проверьте согласованность с выбранным сервисом генерации."
    return None


def _image_has_section(text: str, patterns: list[str]) -> bool:
    lower = text.lower()
    for p in patterns:
        if p in lower:
            return True
    return False


def _image_contradiction_hint(text: str) -> str | None:
    """Грубая эвристика противоречий свет/настроение (RU/EN)."""
    lower = text.lower()
    dark_signals = ("noir", "нуар", "тёмн", "dark mood", "night", "ночь", "low key", "chiaroscuro", "deep shadow")
    bright_signals = ("bright", "светл", "sunny", "солнеч", "high key", "pastel", "воздуш", "daylight")
    has_dark = any(s in lower for s in dark_signals)
    has_bright = any(s in lower for s in bright_signals)
    if has_dark and has_bright:
        return (
            "Возможное противоречие: одновременно «тёмная/ночная» и «светлая/солнечная» атмосфера. "
            "Уточните доминирующее освещение или разделите на два варианта."
        )
    return None


def _image_count_sections(text: str) -> int:
    """Headers like **Subject:** or ## Style / Subject: at line start."""
    n = 0
    for line in text.splitlines():
        s = line.strip().lower()
        if re.match(r"^#{1,3}\s+\S", s):
            n += 1
        elif re.match(r"^\*\*[a-zа-яё0-9\s\-]{2,40}\*\*:", s):
            n += 1
        elif re.match(
            r"^(subject|style|composition|details|negative|technical|субъект|стиль|композиц|детали|негатив|технич|параметр|освещен|палитр|кадр|ракурс)\s*:",
            s,
        ):
            n += 1
    return min(n, 8)


def analyze_image_prompt(
    text: str,
    model_id: str = "",
    task_input: str | None = None,
) -> dict:
    """
    Heuristic checklist for text-to-image prompts (structure + visual cues).
    Separate from chat/LLM rubric — see metaprompt / image pipeline research.
    """
    if not text or not text.strip():
        return {
            "token_estimate": 0,
            "token_method": "none",
            "instruction_count": 0,
            "constraint_count": 0,
            "has_role": False,
            "has_output_format": False,
            "has_examples": False,
            "has_context": False,
            "has_cot_trigger": False,
            "completeness_score": 0.0,
            "completeness_label": "Минимальный",
            "improvement_tips": [],
            "prompt_analysis_mode": "image",
        }

    tok = count_tokens(text, model_id) if model_id else {"tokens": estimate_tokens_quick(text), "method": "estimate"}
    lower = text.lower()

    style_hit = _image_has_section(
        text,
        [
            "style:", "стиль", "aesthetic", "эстетик", "medium:", "oil", "watercolor", "3d render",
            "cartoon", "мульт", "clay", "claymation", "anime", "realistic", "реализ", "illustration",
            "cinematic", "pixar", "стиль:",
        ],
    )
    comp_hit = _image_has_section(
        text,
        [
            "composition", "композиц", "framing", "camera", "wide shot", "close-up", "close up", "angle",
            "depth of field", "bokeh", "ракурс", "кадр", "план:", "shot:",
        ],
    )
    light_color = _image_has_section(
        text,
        [
            "lighting", "light", "освещ", "golden hour", "soft light", "palette", "color", "цвет",
            "атмосфер", "mood", "настроен", "тени", "контраст",
        ],
    )
    neg_hit = _image_has_section(
        text,
        [
            "negative:", "негатив", "avoid", "избегай", "исключи", "without", "no ", "don't", "не добавляй",
            "artifacts", "артефакт", "distort", "искаж",
        ],
    )
    tech_hit = _image_has_section(
        text,
        [
            "aspect", "16:9", "9:16", "4:3", "1:1", "соотношение", "--ar", "resolution", "8k", "4k", "hdr",
            "quality", "качество", "technical", "параметр",
        ],
    )
    subject_hit = _image_has_section(
        text,
        [
            "subject:", "субъект", "scene:", "сцена", "main subject", "foreground", "background", "персонаж",
            "объект", "герой",
        ],
    ) or len(text) > 180

    section_n = _image_count_sections(text)
    detail_bonus = min(15.0, max(0.0, (len(text) / 1200.0) * 15.0))

    score = 0.0
    if subject_hit:
        score += 22.0
    if style_hit:
        score += 22.0
    if comp_hit:
        score += 16.0
    if light_color:
        score += 12.0
    if neg_hit:
        score += 14.0
    if tech_hit:
        score += 14.0
    score += min(12.0, section_n * 3.0)
    score += detail_bonus
    score = min(100.0, score)

    tips: list[str] = []
    if not style_hit:
        tips.append("Добавьте блок стиля: техника (иллюстрация, 3D, масло), референсы эпохи или художественного приёма.")
    if not comp_hit:
        tips.append("Уточните кадрирование: план (общий/средний), ракурс, глубина резкости.")
    if not light_color:
        tips.append("Добавьте свет и/или цветовую палитру (мягкий свет, золотой час, холодная гамма…).")
    if not neg_hit:
        tips.append("Добавьте негативный промпт: артефакты, лишние пальцы, шум, водяные знаки — что исключить.")
    if not tech_hit:
        tips.append("Укажите технические параметры: соотношение сторон (1:1, 16:9…), разрешение или качество, если важно.")

    lang_tip = _language_mismatch_tip(task_input, text)
    if lang_tip:
        tips.insert(0, lang_tip)
    contra = _image_contradiction_hint(text)
    if contra:
        tips.insert(0 if not lang_tip else 1, contra)

    # Fields for compatibility with older UIs / eval chips
    metrics = {
        "token_estimate": tok["tokens"],
        "token_method": tok["method"],
        "instruction_count": section_n,
        "constraint_count": sum(1 for w in ["avoid", "no ", "never", "without", "не ", "без "] if w in lower),
        "has_role": subject_hit,
        "has_output_format": tech_hit,
        "has_examples": False,
        "has_context": light_color,
        "has_cot_trigger": False,
        "has_subject": subject_hit,
        "has_style": style_hit,
        "has_composition": comp_hit,
        "has_lighting_or_palette": light_color,
        "has_negative_block": neg_hit,
        "has_technical_params": tech_hit,
        "completeness_score": score,
        "completeness_label": get_completeness_label(score),
        "improvement_tips": tips[:6],
        "prompt_analysis_mode": "image",
    }
    metrics["quality_score"] = metrics["completeness_score"]
    metrics["quality_label"] = metrics["completeness_label"]
    return metrics


def analyze_prompt(
    text: str,
    model_id: str = "",
    *,
    prompt_type: str = "text",
    task_input: str | None = None,
) -> dict:
    """
    Full prompt analysis. Returns metrics dict with quality score and tips.
    *model_id* (OpenRouter id or short key) enables exact token counting.
    For prompt_type=\"image\", uses a dedicated image-generation rubric.
    """
    if prompt_type == "image":
        return analyze_image_prompt(text, model_id=model_id, task_input=task_input)

    if not text or not text.strip():
        return {
            "token_estimate": 0,
            "token_method": "none",
            "instruction_count": 0,
            "constraint_count": 0,
            "has_role": False,
            "has_output_format": False,
            "has_examples": False,
            "has_context": False,
            "has_cot_trigger": False,
            "completeness_score": 0.0,
            "completeness_label": "Минимальный",
            "improvement_tips": [],
            "prompt_analysis_mode": "text",
        }

    tok = count_tokens(text, model_id) if model_id else {"tokens": estimate_tokens_quick(text), "method": "estimate"}

    metrics = {
        "token_estimate": tok["tokens"],
        "token_method": tok["method"],
        "instruction_count": count_instructions(text),
        "constraint_count": count_constraints(text),
        "has_role": has_role(text),
        "has_output_format": has_output_format(text),
        "has_examples": has_examples(text),
        "has_context": has_context(text),
        "has_cot_trigger": has_cot_trigger(text),
    }
    metrics["completeness_score"] = compute_completeness_score(metrics)
    metrics["completeness_label"] = get_completeness_label(metrics["completeness_score"])
    tips = get_improvement_tips(metrics)
    lang = _language_mismatch_tip(task_input, text)
    if lang:
        tips.insert(0, lang)
    metrics["improvement_tips"] = tips[:8]
    metrics["prompt_analysis_mode"] = "text"
    # Backward compatibility
    metrics["quality_score"] = metrics["completeness_score"]
    metrics["quality_label"] = metrics["completeness_label"]

    return metrics

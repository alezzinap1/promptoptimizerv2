"""User info API — usage stats, trial status, service info."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from config.settings import TRIAL_MAX_COMPLETION_PER_M
from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.trial_budget import effective_trial_tokens_limit

router = APIRouter()


@router.get("/user-info")
def get_user_info(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Return user usage, trial status, and brief service info."""
    user_id = int(user["id"])
    usage = db.get_user_usage(user_id)
    user_key = db.get_user_openrouter_api_key(user_id)
    has_own_key = bool(user_key)
    eff_limit = effective_trial_tokens_limit(usage)
    trial_remaining = max(0, eff_limit - usage["tokens_used"]) if not has_own_key else None

    return {
        "tokens_used": usage["tokens_used"],
        "dollars_used": round(usage["dollars_used"], 6),
        "has_own_api_key": has_own_key,
        "trial_tokens_limit": eff_limit,
        "trial_tokens_remaining": trial_remaining,
        "trial_max_completion_per_m": TRIAL_MAX_COMPLETION_PER_M,
        "service_info": {
            "title": "Prompt Engineer",
            "description": "Ассистент для проектирования промптов: классификация задачи, подбор техник, учёт целевой модели, reasoning, итеративное улучшение.",
            "features": [
                "Генерация промптов из описания задачи",
                "Итеративное улучшение с обратной связью",
                "Библиотека и история версий",
                "Workspaces с глоссарием и правилами",
                "Prompt IDE: spec, debugger, evidence",
                "A/B сравнение техник",
                "Поддержка OpenRouter (GPT-4, Claude, Gemini и др.)",
            ],
        },
    }

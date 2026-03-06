"""
Summary-based memory для сессий.
Вместо хранения 16 сырых сообщений храним:
- Сжатое резюме сессии (~150 токенов)
- Последние 2-3 полных сообщения (~200 токенов)
Экономит 60-70% токенов истории при сохранении полезного контекста.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.db.sqlite_manager import SQLiteManager
    from bot.services.llm_client import LLMService

logger = logging.getLogger(__name__)

SUMMARY_UPDATE_EVERY = 4  # обновляем резюме каждые N сообщений

SUMMARY_PROMPT = """Обнови краткое резюме сессии. Резюме должно содержать:
- Главная задача пользователя в этой сессии
- Ключевые уточнения которые уже были сделаны
- Текущий статус (какой промпт уже создан если есть)

Максимум 3 предложения. Только факты, без оценок.

Текущее резюме: {current_summary}

Новый обмен:
Пользователь: {user_message}
Агент: {agent_message}

Обновлённое резюме:"""


class SessionMemory:
    """Управляет памятью сессии с компрессией."""

    def __init__(self, db: "SQLiteManager", llm: "LLMService"):
        self._db = db
        self._llm = llm

    async def get_context(self, user_id: int) -> dict:
        """
        Возвращает контекст для инжекции в LLM:
        - summary: резюме сессии
        - recent_history: последние 2 полных сообщения
        """
        summary = await self._db.get_session_summary(user_id)
        recent = await self._db.get_agent_history(user_id, limit=4)
        return {
            "summary": summary or "",
            "recent_history": recent,
        }

    async def add_exchange(
        self,
        user_id: int,
        user_message: str,
        agent_message: str,
        provider: str = "trinity",
        temperature: float = 0.3,
    ) -> None:
        """Добавляет новый обмен и при необходимости обновляет резюме."""
        await self._db.add_agent_message(user_id, "user", user_message)
        await self._db.add_agent_message(user_id, "assistant", agent_message)

        total = await self._db.count_agent_messages(user_id)
        if total > 0 and total % SUMMARY_UPDATE_EVERY == 0:
            await self._update_summary(user_id, user_message, agent_message, provider, temperature)

    async def _update_summary(
        self,
        user_id: int,
        user_message: str,
        agent_message: str,
        provider: str,
        temperature: float,
    ) -> None:
        try:
            current = await self._db.get_session_summary(user_id) or ""
            # Обрезаем agent_message чтобы не перегружать сводку
            agent_short = agent_message[:400] if len(agent_message) > 400 else agent_message
            prompt = SUMMARY_PROMPT.format(
                current_summary=current or "Нет",
                user_message=user_message[:200],
                agent_message=agent_short,
            )
            new_summary = await self._llm.simple_call(
                prompt,
                provider=provider,
                temperature=temperature,
                max_tokens=200,
            )
            if new_summary and new_summary.strip():
                await self._db.update_session_summary(user_id, new_summary.strip())
        except Exception as e:
            logger.warning("Failed to update session summary for user %d: %s", user_id, e)

    async def clear(self, user_id: int) -> None:
        """Очищает историю и резюме сессии."""
        await self._db.clear_agent_history(user_id)
        await self._db.update_session_summary(user_id, "")

    async def get_last_agent_prompt(self, user_id: int) -> str:
        """Возвращает последний промпт из истории агента (блок [PROMPT]...[/PROMPT])."""
        history = await self._db.get_agent_history(user_id, limit=8)
        for msg in reversed(history):
            if msg.get("role") == "assistant" and msg.get("content"):
                content = msg["content"]
                if "[PROMPT]" in content and "[/PROMPT]" in content:
                    _, rest = content.split("[PROMPT]", 1)
                    if "[/PROMPT]" in rest:
                        block, _ = rest.split("[/PROMPT]", 1)
                        if block.strip():
                            return block.strip()
        return ""

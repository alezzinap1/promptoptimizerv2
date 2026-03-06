"""
LLM клиент через OpenRouter.
Поддерживает: multi-turn диалог с историей, одиночные вызовы, вызовы для резюмирования.
"""
from __future__ import annotations

import logging

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Карта провайдеров → полные имена моделей на OpenRouter
PROVIDER_MODELS: dict[str, str] = {
    "deepseek":    "deepseek/deepseek-chat",
    "chatgpt":     "openai/gpt-4o-mini",
    "gemini":      "google/gemini-2.5-flash-lite-preview-06-17",
    "grok":        "x-ai/grok-3-mini-beta",
    "mistral":     "mistralai/mistral-nemo",
    "mimo":        "xiaomi/mimolivr2-flash",
    "trinity":     "trinity-labs/trinity-v1-large:free",
    "gpt5nano":    "openai/gpt-4o-mini",
    "deepseek_r1": "deepseek/deepseek-r1-distill-qwen-32b:free",
    "qwen":        "qwen/qwen3-235b-a22b",
}

PROVIDER_NAMES: dict[str, str] = {
    "deepseek":    "DeepSeek Chat",
    "chatgpt":     "ChatGPT (GPT-4o Mini)",
    "gemini":      "Gemini 2.5 Flash Lite",
    "grok":        "Grok 3 Mini",
    "mistral":     "Mistral Nemo",
    "mimo":        "Mimo V2 Flash",
    "trinity":     "Trinity Large (free)",
    "gpt5nano":    "GPT-4o Mini",
    "deepseek_r1": "DeepSeek R1 Chimera (free)",
    "qwen":        "Qwen3 235B",
}


class LLMService:
    def __init__(self, api_key: str):
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
        )

    def _get_model(self, provider: str) -> str:
        model = PROVIDER_MODELS.get(provider)
        if not model:
            raise ValueError(f"Unknown provider: {provider}. Available: {list(PROVIDER_MODELS.keys())}")
        return model

    async def chat_with_history(
        self,
        user_content: str,
        history: list[dict],
        system_prompt: str,
        provider: str = "trinity",
        temperature: float = 0.4,
    ) -> str:
        """
        Multi-turn диалог с историей.
        system_prompt уже собран ContextBuilder'ом.
        """
        model = self._get_model(provider)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            if msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_content})

        response = await self._client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""

    async def simple_call(
        self,
        prompt: str,
        provider: str = "trinity",
        temperature: float = 0.3,
        max_tokens: int | None = None,
        system: str | None = None,
    ) -> str:
        """
        Одиночный вызов без истории.
        Используется для резюмирования сессий и классификации.
        """
        model = self._get_model(provider)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        kwargs: dict = dict(model=model, messages=messages, temperature=temperature)
        if max_tokens:
            kwargs["max_tokens"] = max_tokens

        response = await self._client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

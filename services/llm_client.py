"""
Sync LLM client via OpenRouter.
Uses the synchronous OpenAI SDK (blocking calls; suitable for sync call sites and streaming via chunk iterator).
Streaming yields text chunks for consumers that iterate over tokens (e.g. API streaming endpoints).

Примечание: у провайдеров вроде OpenAI «structured outputs» / JSON Schema (response_format)
дают более жёсткую гарантию формата, чем текстовые теги в system prompt; при расширении
генерации можно добавить отдельный вызов с json_schema и парсинг JSON вместо [PROMPT]-блоков.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Iterator

from openai import OpenAI

logger = logging.getLogger(__name__)

# Default timeout for LLM calls (seconds). Override via OpenAI client init.
DEFAULT_TIMEOUT = 120.0

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Generation models (for generating prompts)
PROVIDER_MODELS: dict[str, str] = {
    "deepseek":       "deepseek/deepseek-chat",
    "deepseek_r1":    "deepseek/deepseek-r1",
    "gpt4o":          "openai/gpt-4o",
    "gpt4o_mini":     "openai/gpt-4o-mini",
    "gemini_flash":   "google/gemini-2.0-flash-001",
    "gemini_pro":     "google/gemini-pro-1.5",
    "claude_haiku":   "anthropic/claude-3-haiku",
    "claude_sonnet":  "anthropic/claude-3.5-sonnet",
    "grok":           "x-ai/grok-3-mini-beta",
    "mistral":        "mistralai/mistral-nemo",
    "qwen":           "qwen/qwen3-235b-a22b",
    "trinity":        "trinity-labs/trinity-v1-large:free",
    "nano_banana":    "google/gemini-2.5-flash-image",
}

PROVIDER_NAMES: dict[str, str] = {
    "deepseek":       "DeepSeek Chat",
    "deepseek_r1":    "DeepSeek R1 (reasoning)",
    "gpt4o":          "GPT-4o",
    "gpt4o_mini":     "GPT-4o Mini",
    "gemini_flash":   "Gemini 1.5 Flash",
    "gemini_pro":     "Gemini 1.5 Pro",
    "claude_haiku":   "Claude 3 Haiku",
    "claude_sonnet":  "Claude 3.5 Sonnet",
    "grok":           "Grok 3 Mini",
    "mistral":        "Mistral Nemo",
    "qwen":           "Qwen3 235B",
    "trinity":        "Trinity Large (free)",
    "nano_banana":    "Nano Banana2 (image)",
}

# Target models — what the generated prompt will be used with
TARGET_MODELS: dict[str, str] = {
    "unknown":      "Неизвестно / Любая модель",
    "gpt4o":        "GPT-4o",
    "gpt4o_mini":   "GPT-4o Mini",
    "claude_3_5":   "Claude 3.5 Sonnet",
    "claude_3":     "Claude 3 Haiku/Sonnet",
    "gemini_pro":   "Gemini 1.5 Pro",
    "gemini_flash": "Gemini 1.5 Flash",
    "mistral":      "Mistral Large",
    "llama3":       "Llama 3 (70B)",
    "small_model":  "Небольшая модель (< 13B)",
}

DEFAULT_PROVIDER = "deepseek"
DEFAULT_TEMPERATURE = 0.7

MODEL_TIERS: dict[str, list[str]] = {
    "tier1": ["google/gemini-flash-1.5", "deepseek/deepseek-chat"],
    "tier2": ["google/gemini-pro-1.5", "anthropic/claude-3-haiku", "deepseek/deepseek-chat"],
    "tier3": ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1"],
}


def get_model_for_tier(tier: str, preferred: str | None = None) -> str:
    """Select an appropriate model for the given cost tier."""
    if preferred and "/" in preferred:
        return preferred
    models = MODEL_TIERS.get(tier, MODEL_TIERS["tier2"])
    return models[0]


class LLMClient:
    """Synchronous LLM client for call sites that do not use an async event loop."""

    def __init__(self, api_key: str, timeout: float = DEFAULT_TIMEOUT):
        self._client = OpenAI(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            timeout=timeout,
        )

    def _get_model(self, provider: str) -> str:
        model = PROVIDER_MODELS.get(provider)
        if model:
            return model
        if "/" in provider:
            return provider
        raise ValueError(f"Unknown provider: {provider}. Available: {list(PROVIDER_MODELS)}")

    def _build_completion_kwargs(
        self,
        model: str,
        messages: list,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float | None = None,
        top_k: int | None = None,
        stream: bool = False,
    ) -> dict:
        kwargs: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if top_p is not None and 0 <= top_p <= 1:
            kwargs["top_p"] = top_p
        if top_k is not None and top_k > 0:
            kwargs["extra_body"] = {"top_k": top_k}
        if stream:
            kwargs["stream"] = True
        return kwargs

    def generate(
        self,
        system_prompt: str,
        user_content: str,
        provider: str = DEFAULT_PROVIDER,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float | None = None,
        top_k: int | None = None,
        history: list[dict] | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Single generation call without streaming."""
        model = self._get_model(provider)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history or []:
            if msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_content})

        kwargs = self._build_completion_kwargs(model, messages, temperature, top_p, top_k)
        if max_tokens is not None and max_tokens > 0:
            kwargs["max_tokens"] = max_tokens
        response = self._client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    def generate_json(
        self,
        system_prompt: str,
        user_content: str,
        provider: str = DEFAULT_PROVIDER,
        max_tokens: int = 500,
    ) -> dict:
        """
        JSON object response (OpenRouter / OpenAI-compatible). Fallback: extract {...} from text.
        """
        model = self._get_model(provider)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        kwargs: dict = {
            "model": model,
            "messages": messages,
            "temperature": 0.0,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        try:
            response = self._client.chat.completions.create(**kwargs)
        except Exception as e:
            logger.warning("generate_json API error: %s", e)
            return {}
        raw = (response.choices[0].message.content or "").strip()
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            m = re.search(r"\{[\s\S]*\}", raw)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    pass
            logger.warning("generate_json parse failed: %s", raw[:200])
            return {}

    def stream(
        self,
        system_prompt: str,
        user_content: str,
        provider: str = DEFAULT_PROVIDER,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float | None = None,
        top_k: int | None = None,
        history: list[dict] | None = None,
    ) -> Iterator[str]:
        """
        Streaming generation — yields text chunks for streaming HTTP responses or other consumers.
        """
        model = self._get_model(provider)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history or []:
            if msg.get("role") in ("user", "assistant") and msg.get("content"):
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_content})

        kwargs = self._build_completion_kwargs(
            model, messages, temperature, top_p, top_k, stream=True
        )
        with self._client.chat.completions.create(**kwargs) as stream_response:
            for chunk in stream_response:
                if not chunk.choices:
                    continue
                content = chunk.choices[0].delta.content
                if content:
                    yield content

    def summarize(
        self,
        text: str,
        provider: str = DEFAULT_PROVIDER,
        max_tokens: int = 200,
    ) -> str:
        """Lightweight call for session summarization."""
        model = self._get_model(provider)
        response = self._client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": text}],
            temperature=0.3,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""

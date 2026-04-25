"""LLMClient.embed for OpenAI-compatible embeddings endpoint."""
from __future__ import annotations

from unittest.mock import MagicMock

from services.llm_client import LLMClient


class _FakeItem:
    def __init__(self, vec: list[float]) -> None:
        self.embedding = vec


def test_embed_returns_list_of_vectors() -> None:
    c = LLMClient(api_key="test")
    fake_resp = MagicMock()
    fake_resp.data = [_FakeItem([0.1, 0.2]), _FakeItem([0.3, 0.4])]
    c._client = MagicMock()  # type: ignore[assignment]
    c._client.embeddings.create.return_value = fake_resp

    out = c.embed(["a", "b"], provider="openai/text-embedding-3-small")
    assert out == [[0.1, 0.2], [0.3, 0.4]]
    c._client.embeddings.create.assert_called_once()
    _, kwargs = c._client.embeddings.create.call_args
    assert kwargs["model"] == "openai/text-embedding-3-small"
    assert kwargs["input"] == ["a", "b"]


def test_embed_empty_input_returns_empty() -> None:
    c = LLMClient(api_key="test")
    c._client = MagicMock()  # type: ignore[assignment]
    assert c.embed([], provider="openai/text-embedding-3-small") == []
    c._client.embeddings.create.assert_not_called()


def test_embed_falls_back_to_sequential_on_batch_error() -> None:
    c = LLMClient(api_key="test")
    c._client = MagicMock()  # type: ignore[assignment]
    fake_one = MagicMock()
    fake_one.data = [_FakeItem([1.0, 2.0])]
    fake_two = MagicMock()
    fake_two.data = [_FakeItem([3.0, 4.0])]
    # First call (batch with input=["a","b"]) raises, then two single calls succeed.
    c._client.embeddings.create.side_effect = [Exception("batch unsupported"), fake_one, fake_two]

    out = c.embed(["a", "b"], provider="openai/text-embedding-3-small")
    assert out == [[1.0, 2.0], [3.0, 4.0]]
    assert c._client.embeddings.create.call_count == 3


def test_embed_resolves_deprecated_alias() -> None:
    """Embed should remap deprecated DeepSeek IDs the same way generate does
    (defensive — most embedding providers won't accept generation IDs anyway,
    but keeps the contract consistent across LLMClient.*)."""
    c = LLMClient(api_key="test")
    fake_resp = MagicMock()
    fake_resp.data = [_FakeItem([0.0])]
    c._client = MagicMock()  # type: ignore[assignment]
    c._client.embeddings.create.return_value = fake_resp

    c.embed(["x"], provider="deepseek/deepseek-chat")
    _, kwargs = c._client.embeddings.create.call_args
    assert kwargs["model"] == "deepseek/deepseek-v4-flash"

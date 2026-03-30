"""Token counting API endpoint."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from core.tokenizer import count_tokens

router = APIRouter()


class TokenCountRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    text: str
    model_id: str = ""


@router.post("/tokenizer/count")
def count(req: TokenCountRequest):
    """Count tokens for text using the appropriate tokenizer for model_id."""
    result = count_tokens(req.text, req.model_id)
    return result

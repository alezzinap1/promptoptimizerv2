"""
Encrypt/decrypt per-user OpenRouter API keys at rest (Fernet).

Set USER_API_KEY_FERNET_SECRET to a Fernet key (urlsafe base64, 32 bytes).
Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If the secret is unset, keys are stored in plaintext (dev only — not for public deploy).
"""
from __future__ import annotations

import logging
import os

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_PREFIX = "enc:v1:"


def _fernet() -> Fernet | None:
    raw = os.getenv("USER_API_KEY_FERNET_SECRET", "").strip()
    if not raw:
        return None
    try:
        return Fernet(raw.encode("ascii"))
    except Exception as exc:
        logger.warning("Invalid USER_API_KEY_FERNET_SECRET: %s", exc)
        return None


def encrypt_user_api_key_for_storage(plaintext: str) -> str:
    if not plaintext:
        return ""
    f = _fernet()
    if f is None:
        return plaintext
    token = f.encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt_stored_user_api_key(stored: str) -> str:
    s = (stored or "").strip()
    if not s:
        return ""
    if not s.startswith(_PREFIX):
        return s
    f = _fernet()
    if f is None:
        logger.error("Encrypted user API key in DB but USER_API_KEY_FERNET_SECRET is not set")
        return ""
    try:
        return f.decrypt(s[len(_PREFIX) :].encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("Failed to decrypt user API key (wrong secret or corrupt data)")
        return ""

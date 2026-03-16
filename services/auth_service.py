"""
Auth helpers shared by FastAPI and Streamlit.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import uuid

PBKDF2_ITERATIONS = 200_000


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Create PBKDF2 hash in storage format: pbkdf2_sha256$iters$salt$b64hash."""
    used_salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), used_salt, PBKDF2_ITERATIONS)
    return (
        f"pbkdf2_sha256${PBKDF2_ITERATIONS}$"
        f"{base64.b64encode(used_salt).decode('ascii')}$"
        f"{base64.b64encode(dk).decode('ascii')}"
    )


def verify_password(password: str, encoded: str) -> bool:
    """Verify password against encoded PBKDF2 hash."""
    try:
        alg, iterations, salt_b64, hash_b64 = encoded.split("$", 3)
        if alg != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(hash_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def generate_session_id() -> str:
    return str(uuid.uuid4())

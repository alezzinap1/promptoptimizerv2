"""
Minimal health check server for production deployments.

Run: uvicorn app.health_server:app --host 0.0.0.0 --port 8502

Provides:
- GET /health — liveness (always 200 if process is up)
- GET /ready — readiness (checks DB connectivity)
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

try:
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
except ImportError:
    FastAPI = None  # type: ignore
    JSONResponse = None  # type: ignore


def _check_db() -> tuple[bool, str]:
    """Try to connect to DB. Return (ok, message)."""
    try:
        from app.config import DB_PATH
        from db.manager import DBManager

        db = DBManager(db_path=DB_PATH)
        db.init()
        db.get_library_stats()
        return True, "ok"
    except Exception as e:
        return False, str(e)


if FastAPI is not None:

    app = FastAPI(title="Prompt Engineer Health", docs_url=None, redoc_url=None)

    @app.get("/health")
    def health() -> dict:
        """Liveness probe."""
        return {"status": "ok", "service": "prompt-engineer"}

    @app.get("/ready")
    def ready() -> dict:
        """Readiness probe — checks DB."""
        ok, msg = _check_db()
        if ok:
            return {"status": "ready", "db": "ok"}
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "db": msg},
        )

else:
    app = None  # FastAPI not installed

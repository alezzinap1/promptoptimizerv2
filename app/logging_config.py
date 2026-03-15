"""
Structured logging setup for the application.

Uses standard logging with JSON-like format for production.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime

from app.config import APP_ENV, LOG_LEVEL


class JsonFormatter(logging.Formatter):
    """Format log records as JSON lines for structured logging."""

    def format(self, record: logging.LogRecord) -> str:
        log_obj = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)
        # Add extra fields if present
        if hasattr(record, "extra") and record.extra:
            log_obj.update(record.extra)
        return json.dumps(log_obj, ensure_ascii=False)


def setup_logging() -> None:
    """Configure application logging based on APP_ENV."""
    level = getattr(logging, LOG_LEVEL.upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)

    if root.handlers:
        for h in root.handlers[:]:
            root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)

    if APP_ENV == "prod":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )

    root.addHandler(handler)

"""
Async SQLite менеджер.
Таблицы:
  users               — настройки пользователя
  agent_conversation  — история диалога (скользящее окно)
  session_summaries   — сжатые резюме сессий
  prompt_sessions     — версии промптов с reasoning и метриками
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

DEFAULT_LLM = "trinity"
DEFAULT_TEMPERATURE = 0.4
MAX_HISTORY_MESSAGES = 12  # сокращено vs старого проекта, т.к. есть резюме


class SQLiteManager:
    def __init__(self, db_path: str = "data/agent.db"):
        self._path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    async def init(self) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id        INTEGER PRIMARY KEY,
                    llm_provider   TEXT    DEFAULT 'trinity',
                    meta_prompt    TEXT,
                    context_prompt TEXT,
                    mode           TEXT    DEFAULT 'agent',
                    temperature    REAL    DEFAULT 0.4,
                    preference_style  TEXT,
                    preference_goal   TEXT,
                    preference_format TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS agent_conversation (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    role    TEXT    NOT NULL,
                    content TEXT    NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS session_summaries (
                    user_id     INTEGER PRIMARY KEY,
                    summary     TEXT    DEFAULT '',
                    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS prompt_sessions (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL,
                    session_uuid    TEXT    NOT NULL,
                    version         INTEGER DEFAULT 1,
                    task_types      TEXT,
                    complexity      TEXT,
                    techniques_used TEXT,
                    original_request TEXT,
                    reasoning       TEXT,
                    final_prompt    TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Safe migrations для существующих БД
            for col, col_def in [
                ("preference_style", "TEXT"),
                ("preference_goal", "TEXT"),
                ("preference_format", "TEXT"),
            ]:
                try:
                    await db.execute(f"ALTER TABLE users ADD COLUMN {col} {col_def}")
                except Exception:
                    pass

            await db.commit()

    # ─── Users ───────────────────────────────────────────────────────────────

    async def get_or_create_user(self, user_id: int) -> dict:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            ) as cur:
                row = await cur.fetchone()
            if row:
                return dict(row)
            await db.execute(
                "INSERT INTO users (user_id) VALUES (?)", (user_id,)
            )
            await db.commit()
            async with db.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            ) as cur:
                row = await cur.fetchone()
            return dict(row)

    async def update_user_setting(self, user_id: int, key: str, value) -> None:
        allowed = {
            "llm_provider", "meta_prompt", "context_prompt", "mode",
            "temperature", "preference_style", "preference_goal", "preference_format",
        }
        if key not in allowed:
            raise ValueError(f"Unknown setting: {key}")
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                f"UPDATE users SET {key} = ? WHERE user_id = ?", (value, user_id)
            )
            await db.commit()

    # ─── Agent conversation ───────────────────────────────────────────────────

    async def add_agent_message(self, user_id: int, role: str, content: str) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                "INSERT INTO agent_conversation (user_id, role, content) VALUES (?, ?, ?)",
                (user_id, role, content),
            )
            # Обрезаем до лимита
            await db.execute("""
                DELETE FROM agent_conversation
                WHERE user_id = ? AND id NOT IN (
                    SELECT id FROM agent_conversation
                    WHERE user_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                )
            """, (user_id, user_id, MAX_HISTORY_MESSAGES))
            await db.commit()

    async def get_agent_history(self, user_id: int, limit: int = MAX_HISTORY_MESSAGES) -> list[dict]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT role, content FROM agent_conversation
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ?
            """, (user_id, limit)) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in reversed(rows)]

    async def count_agent_messages(self, user_id: int) -> int:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                "SELECT COUNT(*) FROM agent_conversation WHERE user_id = ?", (user_id,)
            ) as cur:
                row = await cur.fetchone()
        return row[0] if row else 0

    async def clear_agent_history(self, user_id: int) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute(
                "DELETE FROM agent_conversation WHERE user_id = ?", (user_id,)
            )
            await db.commit()

    # ─── Session summaries ────────────────────────────────────────────────────

    async def get_session_summary(self, user_id: int) -> str:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute(
                "SELECT summary FROM session_summaries WHERE user_id = ?", (user_id,)
            ) as cur:
                row = await cur.fetchone()
        return row[0] if row else ""

    async def update_session_summary(self, user_id: int, summary: str) -> None:
        async with aiosqlite.connect(self._path) as db:
            await db.execute("""
                INSERT INTO session_summaries (user_id, summary, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    summary = excluded.summary,
                    updated_at = excluded.updated_at
            """, (user_id, summary))
            await db.commit()

    # ─── Prompt sessions (версионирование) ───────────────────────────────────

    async def save_prompt_version(
        self,
        user_id: int,
        session_uuid: str,
        version: int,
        task_types: list[str],
        complexity: str,
        techniques_used: list[str],
        original_request: str,
        reasoning: str,
        final_prompt: str,
    ) -> int:
        async with aiosqlite.connect(self._path) as db:
            cur = await db.execute("""
                INSERT INTO prompt_sessions
                    (user_id, session_uuid, version, task_types, complexity,
                     techniques_used, original_request, reasoning, final_prompt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user_id, session_uuid, version,
                json.dumps(task_types, ensure_ascii=False),
                complexity,
                json.dumps(techniques_used, ensure_ascii=False),
                original_request, reasoning, final_prompt,
            ))
            await db.commit()
            return cur.lastrowid

    async def get_prompt_versions(self, user_id: int, session_uuid: str) -> list[dict]:
        async with aiosqlite.connect(self._path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT * FROM prompt_sessions
                WHERE user_id = ? AND session_uuid = ?
                ORDER BY version ASC
            """, (user_id, session_uuid)) as cur:
                rows = await cur.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            for field in ("task_types", "techniques_used"):
                try:
                    d[field] = json.loads(d[field]) if d[field] else []
                except Exception:
                    d[field] = []
            result.append(d)
        return result

    async def get_latest_session_uuid(self, user_id: int) -> str | None:
        async with aiosqlite.connect(self._path) as db:
            async with db.execute("""
                SELECT session_uuid FROM prompt_sessions
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT 1
            """, (user_id,)) as cur:
                row = await cur.fetchone()
        return row[0] if row else None

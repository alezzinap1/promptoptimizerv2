"""
Synchronous SQLite manager for the web app.
Fixes from the async bot version:
  - WAL mode for concurrent reads
  - Single context manager per operation (no connection per method leak)
  - Proper version incrementing (MAX(version) + 1)
  - Indexed queries
  - Prompt library with tags, ratings, search
"""
from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = "data/web_agent.db"


class DBManager:
    def __init__(self, db_path: str = DEFAULT_DB_PATH):
        self._path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS prompt_sessions (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id      TEXT    NOT NULL,
                    version         INTEGER NOT NULL DEFAULT 1,
                    task_input      TEXT,
                    task_types      TEXT    DEFAULT '[]',
                    complexity      TEXT    DEFAULT 'medium',
                    target_model    TEXT    DEFAULT 'unknown',
                    gen_model       TEXT,
                    techniques_used TEXT    DEFAULT '[]',
                    reasoning       TEXT,
                    final_prompt    TEXT,
                    metrics         TEXT    DEFAULT '{}',
                    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_prompt_sessions_session_id
                    ON prompt_sessions(session_id);

                CREATE TABLE IF NOT EXISTS prompt_library (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    title        TEXT    NOT NULL,
                    tags         TEXT    DEFAULT '[]',
                    target_model TEXT    DEFAULT 'unknown',
                    task_type    TEXT    DEFAULT 'general',
                    techniques   TEXT    DEFAULT '[]',
                    prompt       TEXT    NOT NULL,
                    rating       INTEGER DEFAULT 0,
                    notes        TEXT    DEFAULT '',
                    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_library_target_model
                    ON prompt_library(target_model);

                CREATE INDEX IF NOT EXISTS idx_library_task_type
                    ON prompt_library(task_type);
            """)
        logger.info("DB initialized at %s", self._path)

    # ─── Prompt sessions ──────────────────────────────────────────────────────

    def save_prompt_version(
        self,
        session_id: str,
        task_input: str,
        task_types: list[str],
        complexity: str,
        target_model: str,
        gen_model: str,
        techniques_used: list[str],
        reasoning: str,
        final_prompt: str,
        metrics: dict | None = None,
    ) -> int:
        """Save a new version, auto-incrementing version number per session."""
        with self._conn() as conn:
            cur = conn.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM prompt_sessions WHERE session_id = ?",
                (session_id,),
            )
            version = cur.fetchone()[0]

            cur = conn.execute(
                """
                INSERT INTO prompt_sessions
                    (session_id, version, task_input, task_types, complexity,
                     target_model, gen_model, techniques_used, reasoning, final_prompt, metrics)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id, version, task_input,
                    json.dumps(task_types, ensure_ascii=False),
                    complexity, target_model, gen_model,
                    json.dumps(techniques_used, ensure_ascii=False),
                    reasoning, final_prompt,
                    json.dumps(metrics or {}, ensure_ascii=False),
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def get_session_versions(self, session_id: str) -> list[dict]:
        """Get all versions for a session, ordered by version ASC."""
        with self._conn() as conn:
            cur = conn.execute(
                "SELECT * FROM prompt_sessions WHERE session_id = ? ORDER BY version ASC",
                (session_id,),
            )
            rows = cur.fetchall()

        result = []
        for row in rows:
            d = dict(row)
            for field in ("task_types", "techniques_used"):
                try:
                    d[field] = json.loads(d[field]) if d[field] else []
                except Exception:
                    d[field] = []
            try:
                d["metrics"] = json.loads(d["metrics"]) if d["metrics"] else {}
            except Exception:
                d["metrics"] = {}
            result.append(d)
        return result

    def get_latest_version(self, session_id: str) -> dict | None:
        versions = self.get_session_versions(session_id)
        return versions[-1] if versions else None

    # ─── Prompt library ───────────────────────────────────────────────────────

    def save_to_library(
        self,
        title: str,
        prompt: str,
        tags: list[str] | None = None,
        target_model: str = "unknown",
        task_type: str = "general",
        techniques: list[str] | None = None,
        notes: str = "",
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO prompt_library
                    (title, tags, target_model, task_type, techniques, prompt, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title,
                    json.dumps(tags or [], ensure_ascii=False),
                    target_model, task_type,
                    json.dumps(techniques or [], ensure_ascii=False),
                    prompt, notes,
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def get_library(
        self,
        target_model: str | None = None,
        task_type: str | None = None,
        search: str | None = None,
    ) -> list[dict]:
        query = "SELECT * FROM prompt_library WHERE 1=1"
        params: list = []

        if target_model and target_model != "all":
            query += " AND target_model = ?"
            params.append(target_model)
        if task_type and task_type != "all":
            query += " AND task_type = ?"
            params.append(task_type)
        if search and search.strip():
            query += " AND (title LIKE ? OR prompt LIKE ? OR notes LIKE ?)"
            like = f"%{search.strip()}%"
            params.extend([like, like, like])

        query += " ORDER BY rating DESC, created_at DESC"

        with self._conn() as conn:
            cur = conn.execute(query, params)
            rows = cur.fetchall()

        result = []
        for row in rows:
            d = dict(row)
            for field in ("tags", "techniques"):
                try:
                    d[field] = json.loads(d[field]) if d[field] else []
                except Exception:
                    d[field] = []
            result.append(d)
        return result

    def update_library_item(
        self,
        item_id: int,
        title: str | None = None,
        tags: list[str] | None = None,
        notes: str | None = None,
        rating: int | None = None,
    ) -> None:
        updates = []
        params = []
        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(tags, ensure_ascii=False))
        if notes is not None:
            updates.append("notes = ?")
            params.append(notes)
        if rating is not None:
            updates.append("rating = ?")
            params.append(max(0, min(5, rating)))
        if not updates:
            return
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(item_id)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE prompt_library SET {', '.join(updates)} WHERE id = ?",
                params,
            )

    def delete_from_library(self, item_id: int) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM prompt_library WHERE id = ?", (item_id,))

    def get_library_stats(self) -> dict:
        with self._conn() as conn:
            cur = conn.execute("SELECT COUNT(*) FROM prompt_library")
            total = cur.fetchone()[0]
            cur = conn.execute("SELECT DISTINCT target_model FROM prompt_library")
            models = [r[0] for r in cur.fetchall()]
            cur = conn.execute("SELECT DISTINCT task_type FROM prompt_library")
            types = [r[0] for r in cur.fetchall()]
        return {"total": total, "models": models, "task_types": types}

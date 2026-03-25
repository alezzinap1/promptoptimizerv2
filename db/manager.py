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
import time
from contextlib import contextmanager
from pathlib import Path
from statistics import mean

from config.settings import SESSION_TTL_SEC
from services.api_key_crypto import decrypt_stored_user_api_key, encrypt_user_api_key_for_storage

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
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    username      TEXT    NOT NULL UNIQUE,
                    password_hash TEXT    NOT NULL,
                    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS user_sessions (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id    TEXT    NOT NULL UNIQUE,
                    user_id       INTEGER NOT NULL,
                    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS prompt_sessions (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER,
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
                    user_id      INTEGER,
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

                CREATE TABLE IF NOT EXISTS app_events (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id      INTEGER,
                    session_id   TEXT    DEFAULT '',
                    event_name   TEXT    NOT NULL,
                    payload      TEXT    DEFAULT '{}',
                    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_app_events_event_name
                    ON app_events(event_name);

                CREATE INDEX IF NOT EXISTS idx_app_events_session_id
                    ON app_events(session_id);

                CREATE TABLE IF NOT EXISTS workspaces (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id      INTEGER,
                    name         TEXT    NOT NULL UNIQUE,
                    description  TEXT    DEFAULT '',
                    config_json  TEXT    DEFAULT '{}',
                    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS prompt_specs (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id       INTEGER,
                    session_id    TEXT    NOT NULL,
                    workspace_id  INTEGER,
                    raw_input     TEXT    DEFAULT '',
                    spec_json     TEXT    DEFAULT '{}',
                    evidence_json TEXT    DEFAULT '{}',
                    issues_json   TEXT    DEFAULT '[]',
                    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_prompt_specs_session_id
                    ON prompt_specs(session_id);

                CREATE TABLE IF NOT EXISTS user_preferences (
                    user_id             INTEGER PRIMARY KEY,
                    theme               TEXT    DEFAULT 'slate',
                    font                TEXT    DEFAULT 'jetbrains',
                    gen_models_json     TEXT    DEFAULT '[]',
                    target_models_json  TEXT    DEFAULT '[]',
                    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS user_techniques (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL,
                    technique_json  TEXT    NOT NULL,
                    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)
            self._migrate_phase2(conn)
            self._migrate_phase3(conn)
            self._migrate_phase4_sessions_ttl(conn)
            self._migrate_phase5_simple_improve(conn)
            self._migrate_phase6_task_classifier_prefs(conn)
            self._migrate_phase7_user_auth_extended(conn)
        logger.info("DB initialized at %s", self._path)

    def _migrate_phase2(self, conn: sqlite3.Connection) -> None:
        """Best-effort migration for auth/multitenancy columns on old DBs."""
        self._safe_add_column(conn, "prompt_sessions", "user_id", "INTEGER")
        self._safe_add_column(conn, "prompt_library", "user_id", "INTEGER")
        self._safe_add_column(conn, "app_events", "user_id", "INTEGER")
        self._safe_add_column(conn, "workspaces", "user_id", "INTEGER")
        self._safe_add_column(conn, "prompt_specs", "user_id", "INTEGER")

    def _migrate_phase3(self, conn: sqlite3.Connection) -> None:
        """Trial/usage: user API key, user_usage table."""
        self._safe_add_column(conn, "user_preferences", "openrouter_api_key", "TEXT DEFAULT ''")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_usage (
                user_id         INTEGER PRIMARY KEY,
                tokens_used     INTEGER DEFAULT 0,
                dollars_used    REAL DEFAULT 0,
                updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

    def _migrate_phase4_sessions_ttl(self, conn: sqlite3.Connection) -> None:
        """Session expiry (Unix seconds). Backfill and drop stale rows."""
        self._safe_add_column(conn, "user_sessions", "expires_at", "INTEGER")
        now_sec = int(time.time())
        conn.execute(
            """
            UPDATE user_sessions
            SET expires_at = ? + ?
            WHERE expires_at IS NULL
            """,
            (now_sec, SESSION_TTL_SEC),
        )
        conn.execute(
            """
            DELETE FROM user_sessions
            WHERE expires_at IS NOT NULL AND expires_at < ?
            """,
            (now_sec,),
        )

    def _migrate_phase5_simple_improve(self, conn: sqlite3.Connection) -> None:
        """Simple mode: preset id + optional custom meta-instructions."""
        self._safe_add_column(
            conn, "user_preferences", "simple_improve_preset", "TEXT DEFAULT 'balanced'"
        )
        self._safe_add_column(conn, "user_preferences", "simple_improve_meta", "TEXT DEFAULT ''")

    def _migrate_phase6_task_classifier_prefs(self, conn: sqlite3.Connection) -> None:
        """Task classification: heuristic vs LLM + optional classifier model id."""
        self._safe_add_column(
            conn, "user_preferences", "task_classification_mode", "TEXT DEFAULT 'heuristic'"
        )
        self._safe_add_column(conn, "user_preferences", "task_classifier_model", "TEXT DEFAULT ''")

    def _migrate_phase7_user_auth_extended(self, conn: sqlite3.Connection) -> None:
        """Email + GitHub OAuth fields on users table."""
        self._safe_add_column(conn, "users", "email", "TEXT")
        self._safe_add_column(conn, "users", "github_id", "TEXT")
        self._safe_add_column(conn, "users", "github_login", "TEXT")
        self._safe_add_column(conn, "users", "avatar_url", "TEXT")
        # password_hash may be empty string for GitHub-only accounts
        # Allow it by not adding a constraint (existing NOT NULL is on DDL string, not enforced for existing rows)
        try:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL")
        except sqlite3.OperationalError:
            pass

    def _safe_add_column(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        column_name: str,
        column_ddl: str,
    ) -> None:
        cols = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        existing = {c["name"] for c in cols}
        if column_name not in existing:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl}")

    # ─── Prompt sessions ──────────────────────────────────────────────────────

    # ─── Users / auth ─────────────────────────────────────────────────────────

    def create_user(self, username: str, password_hash: str, email: str | None = None) -> int:
        """Create a user account. Raises sqlite3.IntegrityError for duplicates."""
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
                (username.strip().lower(), password_hash, email),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def create_github_user(
        self,
        username: str,
        github_id: str,
        github_login: str,
        email: str | None = None,
        avatar_url: str | None = None,
    ) -> int:
        """Create user via GitHub OAuth (no password). Returns user_id."""
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO users (username, password_hash, email, github_id, github_login, avatar_url)
                   VALUES (?, '', ?, ?, ?, ?)""",
                (username.strip().lower(), email, github_id, github_login, avatar_url),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def get_user_by_github_id(self, github_id: str) -> dict | None:
        """Find user by GitHub ID."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE github_id = ?", (github_id,)
            ).fetchone()
        return dict(row) if row else None

    def update_user_email(self, user_id: int, email: str) -> None:
        """Update user email. Raises sqlite3.IntegrityError if email already taken."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE users SET email = ? WHERE id = ?",
                (email.strip().lower(), user_id),
            )

    def get_user_by_username(self, username: str) -> dict | None:
        """Find user by username."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE username = ?",
                (username.strip().lower(),),
            ).fetchone()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> dict | None:
        """Find user by id."""
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def bind_session_to_user(self, session_id: str, user_id: int) -> None:
        """Bind session_id to user. Session expires after SESSION_TTL_SEC from bind/login."""
        expires_at = int(time.time()) + SESSION_TTL_SEC
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO user_sessions (session_id, user_id, updated_at, expires_at)
                VALUES (?, ?, CURRENT_TIMESTAMP, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    updated_at = CURRENT_TIMESTAMP,
                    expires_at = excluded.expires_at
                """,
                (session_id, user_id, expires_at),
            )

    def get_session_user(self, session_id: str) -> dict | None:
        """Resolve user for session_id if session exists and is not expired."""
        now_sec = int(time.time())
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT u.* FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.session_id = ?
                  AND s.expires_at IS NOT NULL
                  AND s.expires_at > ?
                """,
                (session_id, now_sec),
            ).fetchone()
        return dict(row) if row else None

    def clear_session_binding(self, session_id: str) -> None:
        """Logout by deleting the session binding."""
        with self._conn() as conn:
            conn.execute("DELETE FROM user_sessions WHERE session_id = ?", (session_id,))

    def get_user_preferences(self, user_id: int) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM user_preferences WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if not row:
            return {
                "user_id": user_id,
                "theme": "slate",
                "font": "jetbrains",
                "preferred_generation_models": [],
                "preferred_target_models": [],
                "simple_improve_preset": "balanced",
                "simple_improve_meta": "",
                "task_classification_mode": "heuristic",
                "task_classifier_model": "",
            }
        data = dict(row)
        for source, target in (
            ("gen_models_json", "preferred_generation_models"),
            ("target_models_json", "preferred_target_models"),
        ):
            try:
                data[target] = json.loads(data.get(source) or "[]")
            except Exception:
                data[target] = []
            data.pop(source, None)
        data.setdefault("simple_improve_preset", "balanced")
        data.setdefault("simple_improve_meta", "")
        data.setdefault("task_classification_mode", "heuristic")
        data.setdefault("task_classifier_model", "")
        return data

    def upsert_user_preferences(
        self,
        user_id: int,
        theme: str | None = None,
        font: str | None = None,
        preferred_generation_models: list[str] | None = None,
        preferred_target_models: list[str] | None = None,
        simple_improve_preset: str | None = None,
        simple_improve_meta: str | None = None,
        task_classification_mode: str | None = None,
        task_classifier_model: str | None = None,
    ) -> dict:
        current = self.get_user_preferences(user_id)
        next_theme = theme if theme is not None else str(current.get("theme") or "slate")
        next_font = font if font is not None else str(current.get("font") or "jetbrains")
        next_gen = (
            preferred_generation_models
            if preferred_generation_models is not None
            else list(current.get("preferred_generation_models") or [])
        )
        next_target = (
            preferred_target_models
            if preferred_target_models is not None
            else list(current.get("preferred_target_models") or [])
        )
        next_simple_preset = (
            simple_improve_preset
            if simple_improve_preset is not None
            else str(current.get("simple_improve_preset") or "balanced")
        )
        next_simple_meta = (
            simple_improve_meta
            if simple_improve_meta is not None
            else str(current.get("simple_improve_meta") or "")
        )
        next_cls_mode = (
            task_classification_mode
            if task_classification_mode is not None
            else str(current.get("task_classification_mode") or "heuristic")
        )
        if next_cls_mode not in ("heuristic", "llm"):
            next_cls_mode = "heuristic"
        next_cls_model = (
            task_classifier_model
            if task_classifier_model is not None
            else str(current.get("task_classifier_model") or "")
        )
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO user_preferences
                    (user_id, theme, font, gen_models_json, target_models_json,
                     simple_improve_preset, simple_improve_meta,
                     task_classification_mode, task_classifier_model, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    theme = excluded.theme,
                    font = excluded.font,
                    gen_models_json = excluded.gen_models_json,
                    target_models_json = excluded.target_models_json,
                    simple_improve_preset = excluded.simple_improve_preset,
                    simple_improve_meta = excluded.simple_improve_meta,
                    task_classification_mode = excluded.task_classification_mode,
                    task_classifier_model = excluded.task_classifier_model,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    next_theme,
                    next_font,
                    json.dumps(next_gen, ensure_ascii=False),
                    json.dumps(next_target, ensure_ascii=False),
                    next_simple_preset,
                    next_simple_meta,
                    next_cls_mode,
                    next_cls_model.strip()[:500],
                ),
            )
        return self.get_user_preferences(user_id)

    def get_user_openrouter_api_key(self, user_id: int) -> str:
        """Get user's OpenRouter API key. Empty if not set."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT openrouter_api_key FROM user_preferences WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if not row:
            return ""
        data = dict(row)
        raw = str(data.get("openrouter_api_key") or "").strip()
        return decrypt_stored_user_api_key(raw)

    def set_user_openrouter_api_key(self, user_id: int, api_key: str) -> None:
        """Set or clear user's OpenRouter API key (encrypted at rest when Fernet secret is set)."""
        key = (api_key or "").strip()
        stored = encrypt_user_api_key_for_storage(key)
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE user_preferences SET openrouter_api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                (stored, user_id),
            )
            if cur.rowcount == 0:
                conn.execute(
                    """
                    INSERT INTO user_preferences (user_id, theme, font, gen_models_json, target_models_json, openrouter_api_key, updated_at)
                    VALUES (?, 'slate', 'jetbrains', '[]', '["unknown"]', ?, CURRENT_TIMESTAMP)
                    """,
                    (user_id, stored),
                )

    def get_user_usage(self, user_id: int) -> dict:
        """Get user's token and dollar usage."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT tokens_used, dollars_used, updated_at FROM user_usage WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if not row:
            return {"tokens_used": 0, "dollars_used": 0.0, "updated_at": None}
        data = dict(row)
        return {
            "tokens_used": int(data.get("tokens_used") or 0),
            "dollars_used": float(data.get("dollars_used") or 0),
            "updated_at": data.get("updated_at"),
        }

    def add_user_usage(
        self, user_id: int, tokens_delta: int, dollars_delta: float
    ) -> None:
        """Add usage. Creates row if not exists."""
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO user_usage (user_id, tokens_used, dollars_used, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    tokens_used = tokens_used + excluded.tokens_used,
                    dollars_used = dollars_used + excluded.dollars_used,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, tokens_delta, dollars_delta),
            )

    def list_user_techniques(self, user_id: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM user_techniques
                WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (user_id,),
            ).fetchall()
        items: list[dict] = []
        for row in rows:
            data = dict(row)
            try:
                technique = json.loads(data.get("technique_json") or "{}")
            except Exception:
                technique = {}
            technique["db_id"] = data["id"]
            technique["editable"] = True
            technique["origin"] = "custom"
            technique["created_at"] = data.get("created_at")
            technique["updated_at"] = data.get("updated_at")
            items.append(technique)
        return items

    def create_user_technique(self, user_id: int, technique: dict) -> dict:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO user_techniques (user_id, technique_json)
                VALUES (?, ?)
                """,
                (user_id, json.dumps(technique, ensure_ascii=False)),
            )
            item_id = cur.lastrowid
        row = self.get_user_technique(int(item_id), user_id=user_id)
        return row or {}

    def get_user_technique(self, technique_id: int, user_id: int) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT * FROM user_techniques
                WHERE id = ? AND user_id = ?
                """,
                (technique_id, user_id),
            ).fetchone()
        if not row:
            return None
        data = dict(row)
        try:
            technique = json.loads(data.get("technique_json") or "{}")
        except Exception:
            technique = {}
        technique["db_id"] = data["id"]
        technique["editable"] = True
        technique["origin"] = "custom"
        technique["created_at"] = data.get("created_at")
        technique["updated_at"] = data.get("updated_at")
        return technique

    def update_user_technique(self, technique_id: int, user_id: int, technique: dict) -> dict | None:
        with self._conn() as conn:
            conn.execute(
                """
                UPDATE user_techniques
                SET technique_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (json.dumps(technique, ensure_ascii=False), technique_id, user_id),
            )
        return self.get_user_technique(technique_id, user_id=user_id)

    def delete_user_technique(self, technique_id: int, user_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM user_techniques WHERE id = ? AND user_id = ?",
                (technique_id, user_id),
            )

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
        user_id: int | None = None,
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
                    (user_id, session_id, version, task_input, task_types, complexity,
                     target_model, gen_model, techniques_used, reasoning, final_prompt, metrics)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id, session_id, version, task_input,
                    json.dumps(task_types, ensure_ascii=False),
                    complexity, target_model, gen_model,
                    json.dumps(techniques_used, ensure_ascii=False),
                    reasoning, final_prompt,
                    json.dumps(metrics or {}, ensure_ascii=False),
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def get_session_versions(self, session_id: str, user_id: int | None = None) -> list[dict]:
        """Get all versions for a session, ordered by version ASC."""
        with self._conn() as conn:
            if user_id is None:
                cur = conn.execute(
                    "SELECT * FROM prompt_sessions WHERE session_id = ? ORDER BY version ASC",
                    (session_id,),
                )
            else:
                cur = conn.execute(
                    "SELECT * FROM prompt_sessions WHERE session_id = ? AND user_id = ? ORDER BY version ASC",
                    (session_id, user_id),
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

    def get_latest_version(self, session_id: str, user_id: int | None = None) -> dict | None:
        versions = self.get_session_versions(session_id, user_id=user_id)
        return versions[-1] if versions else None

    # ─── Workspaces and prompt specs ───────────────────────────────────────────

    def create_workspace(
        self,
        name: str,
        description: str = "",
        config: dict | None = None,
        user_id: int | None = None,
    ) -> int:
        """Create a reusable workspace profile for prompt design."""
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO workspaces (user_id, name, description, config_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    user_id,
                    name.strip(),
                    description.strip(),
                    json.dumps(config or {}, ensure_ascii=False),
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def list_workspaces(self, user_id: int | None = None) -> list[dict]:
        """Return all saved workspaces ordered by name."""
        with self._conn() as conn:
            if user_id is None:
                rows = conn.execute(
                    "SELECT * FROM workspaces ORDER BY lower(name) ASC"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM workspaces WHERE user_id = ? ORDER BY lower(name) ASC",
                    (user_id,),
                ).fetchall()
        result = []
        for row in rows:
            d = dict(row)
            try:
                d["config"] = json.loads(d.pop("config_json") or "{}")
            except Exception:
                d["config"] = {}
            result.append(d)
        return result

    def get_workspace(self, workspace_id: int, user_id: int | None = None) -> dict | None:
        """Return a single workspace with parsed config."""
        with self._conn() as conn:
            if user_id is None:
                row = conn.execute(
                    "SELECT * FROM workspaces WHERE id = ?",
                    (workspace_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM workspaces WHERE id = ? AND user_id = ?",
                    (workspace_id, user_id),
                ).fetchone()
        if not row:
            return None
        data = dict(row)
        try:
            data["config"] = json.loads(data.pop("config_json") or "{}")
        except Exception:
            data["config"] = {}
        return data

    def update_workspace(
        self,
        workspace_id: int,
        name: str | None = None,
        description: str | None = None,
        config: dict | None = None,
        user_id: int | None = None,
    ) -> None:
        """Update one or more workspace fields."""
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if description is not None:
            updates.append("description = ?")
            params.append(description.strip())
        if config is not None:
            updates.append("config_json = ?")
            params.append(json.dumps(config, ensure_ascii=False))
        if not updates:
            return
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(workspace_id)
        with self._conn() as conn:
            if user_id is None:
                conn.execute(
                    f"UPDATE workspaces SET {', '.join(updates)} WHERE id = ?",
                    params,
                )
            else:
                conn.execute(
                    f"UPDATE workspaces SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                    [*params, user_id],
                )

    def delete_workspace(self, workspace_id: int, user_id: int | None = None) -> None:
        """Delete a workspace and keep prompt specs as historical artifacts."""
        with self._conn() as conn:
            if user_id is None:
                conn.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
            else:
                conn.execute("DELETE FROM workspaces WHERE id = ? AND user_id = ?", (workspace_id, user_id))

    def save_prompt_spec(
        self,
        session_id: str,
        raw_input: str,
        spec: dict,
        evidence: dict,
        issues: list[dict],
        workspace_id: int | None = None,
        user_id: int | None = None,
    ) -> int:
        """Persist the structured prompt specification used by the IDE flow."""
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO prompt_specs
                    (user_id, session_id, workspace_id, raw_input, spec_json, evidence_json, issues_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    session_id,
                    workspace_id,
                    raw_input,
                    json.dumps(spec, ensure_ascii=False),
                    json.dumps(evidence, ensure_ascii=False),
                    json.dumps(issues, ensure_ascii=False),
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def get_latest_prompt_spec(self, session_id: str, user_id: int | None = None) -> dict | None:
        """Return the most recent structured prompt specification for a session."""
        with self._conn() as conn:
            if user_id is None:
                row = conn.execute(
                    """
                    SELECT * FROM prompt_specs
                    WHERE session_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1
                    """,
                    (session_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT * FROM prompt_specs
                    WHERE session_id = ? AND user_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1
                    """,
                    (session_id, user_id),
                ).fetchone()
        if not row:
            return None
        data = dict(row)
        for src, dst, default in (
            ("spec_json", "spec", {}),
            ("evidence_json", "evidence", {}),
            ("issues_json", "issues", []),
        ):
            try:
                data[dst] = json.loads(data.pop(src) or json.dumps(default))
            except Exception:
                data[dst] = default
        return data

    # ─── Product events / metrics ──────────────────────────────────────────────

    def log_event(
        self,
        event_name: str,
        session_id: str | None = None,
        payload: dict | None = None,
        user_id: int | None = None,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO app_events (user_id, session_id, event_name, payload)
                VALUES (?, ?, ?, ?)
                """,
                (
                    user_id,
                    session_id or "",
                    event_name,
                    json.dumps(payload or {}, ensure_ascii=False),
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def get_recent_events(self, limit: int = 50, user_id: int | None = None) -> list[dict]:
        with self._conn() as conn:
            if user_id is None:
                cur = conn.execute(
                    "SELECT * FROM app_events ORDER BY created_at DESC, id DESC LIMIT ?",
                    (max(1, limit),),
                )
            else:
                cur = conn.execute(
                    "SELECT * FROM app_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
                    (user_id, max(1, limit)),
                )
            rows = cur.fetchall()

        result = []
        for row in rows:
            d = dict(row)
            try:
                d["payload"] = json.loads(d["payload"]) if d["payload"] else {}
            except Exception:
                d["payload"] = {}
            result.append(d)
        return result

    def get_product_metrics_summary(self, user_id: int | None = None) -> dict:
        events = self.get_recent_events(limit=5000, user_id=user_id)
        counts: dict[str, int] = {}
        generation_latencies: list[float] = []
        prompt_scores: list[float] = []

        for event in events:
            name = event.get("event_name", "")
            counts[name] = counts.get(name, 0) + 1

            payload = event.get("payload") or {}
            if name == "generation_result":
                latency = payload.get("latency_ms")
                if isinstance(latency, (int, float)):
                    generation_latencies.append(float(latency))

                score = payload.get("completeness_score")
                if isinstance(score, (int, float)):
                    prompt_scores.append(float(score))

        generate_requests = counts.get("generate_requested", 0)
        generated_prompts = counts.get("generate_prompt_success", 0)
        generated_questions = counts.get("generate_questions", 0)
        saved_prompts = counts.get("prompt_saved_to_library", 0)
        compare_runs = counts.get("compare_run", 0)
        question_answers = counts.get("questions_answered", 0)
        question_skips = counts.get("questions_skipped", 0)
        iterations_started = counts.get("iteration_started", 0)
        library_opens = counts.get("library_open_prompt", 0)

        def pct(part: int, whole: int) -> float:
            return round((part / whole) * 100, 1) if whole else 0.0

        p95_latency = 0.0
        if generation_latencies:
            ordered = sorted(generation_latencies)
            idx = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95) - 1))
            p95_latency = round(ordered[idx], 1)

        return {
            "event_counts": counts,
            "generate_requests": generate_requests,
            "generated_prompts": generated_prompts,
            "generated_questions": generated_questions,
            "saved_prompts": saved_prompts,
            "compare_runs": compare_runs,
            "question_answers": question_answers,
            "question_skips": question_skips,
            "iterations_started": iterations_started,
            "library_opens": library_opens,
            "prompt_acceptance_rate": pct(saved_prompts, generated_prompts),
            "questions_response_rate": pct(question_answers + question_skips, generated_questions),
            "save_to_library_rate": pct(saved_prompts, generated_prompts),
            "avg_generation_latency_ms": round(mean(generation_latencies), 1) if generation_latencies else 0.0,
            "p95_generation_latency_ms": p95_latency,
            "avg_prompt_completeness": round(mean(prompt_scores), 1) if prompt_scores else 0.0,
        }

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
        user_id: int | None = None,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO prompt_library
                    (user_id, title, tags, target_model, task_type, techniques, prompt, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
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
        user_id: int | None = None,
    ) -> list[dict]:
        query = "SELECT * FROM prompt_library WHERE 1=1"
        params: list = []
        if user_id is not None:
            query += " AND user_id = ?"
            params.append(user_id)

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
        user_id: int | None = None,
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
            if user_id is None:
                conn.execute(
                    f"UPDATE prompt_library SET {', '.join(updates)} WHERE id = ?",
                    params,
                )
            else:
                conn.execute(
                    f"UPDATE prompt_library SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                    [*params, user_id],
                )

    def delete_from_library(self, item_id: int, user_id: int | None = None) -> None:
        with self._conn() as conn:
            if user_id is None:
                conn.execute("DELETE FROM prompt_library WHERE id = ?", (item_id,))
            else:
                conn.execute("DELETE FROM prompt_library WHERE id = ? AND user_id = ?", (item_id, user_id))

    def get_library_stats(self, user_id: int | None = None) -> dict:
        with self._conn() as conn:
            if user_id is None:
                cur = conn.execute("SELECT COUNT(*) FROM prompt_library")
            else:
                cur = conn.execute("SELECT COUNT(*) FROM prompt_library WHERE user_id = ?", (user_id,))
            total = cur.fetchone()[0]
            if user_id is None:
                cur = conn.execute("SELECT DISTINCT target_model FROM prompt_library")
            else:
                cur = conn.execute("SELECT DISTINCT target_model FROM prompt_library WHERE user_id = ?", (user_id,))
            models = [r[0] for r in cur.fetchall()]
            if user_id is None:
                cur = conn.execute("SELECT DISTINCT task_type FROM prompt_library")
            else:
                cur = conn.execute("SELECT DISTINCT task_type FROM prompt_library WHERE user_id = ?", (user_id,))
            types = [r[0] for r in cur.fetchall()]
        return {"total": total, "models": models, "task_types": types}

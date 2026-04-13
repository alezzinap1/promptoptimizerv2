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
from datetime import datetime
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
            self._migrate_phase8_ui_color_mode(conn)
            self._migrate_phase9_community_and_skills(conn)
            self._migrate_phase10_user_presets(conn)
            self._migrate_phase11_pre_router_and_skill_client_id(conn)
            self._migrate_phase12_library_cover_image(conn)
            self._migrate_phase13_image_try_model(conn)
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

    def _migrate_phase8_ui_color_mode(self, conn: sqlite3.Connection) -> None:
        """Dark/light UI mode stored separately from palette (theme column)."""
        self._safe_add_column(
            conn, "user_preferences", "color_mode", "TEXT DEFAULT 'dark'"
        )

    def _migrate_phase9_community_and_skills(self, conn: sqlite3.Connection) -> None:
        """Community prompt library, votes, and backend-persisted skills."""
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS community_prompts (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                author_user_id  INTEGER NOT NULL,
                title           TEXT    NOT NULL,
                description     TEXT    DEFAULT '',
                prompt          TEXT    NOT NULL,
                prompt_type     TEXT    DEFAULT 'text',
                category        TEXT    DEFAULT 'general',
                tags            TEXT    DEFAULT '[]',
                upvotes         INTEGER DEFAULT 0,
                image_path      TEXT,
                is_public       INTEGER DEFAULT 1,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_community_prompts_type
                ON community_prompts(prompt_type);
            CREATE INDEX IF NOT EXISTS idx_community_prompts_category
                ON community_prompts(category);
            CREATE INDEX IF NOT EXISTS idx_community_prompts_author
                ON community_prompts(author_user_id);

            CREATE TABLE IF NOT EXISTS community_votes (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   INTEGER NOT NULL,
                prompt_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (prompt_id) REFERENCES community_prompts(id) ON DELETE CASCADE,
                UNIQUE(user_id, prompt_id)
            );

            CREATE TABLE IF NOT EXISTS skills (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                name        TEXT    NOT NULL,
                description TEXT    DEFAULT '',
                body        TEXT    NOT NULL,
                category    TEXT    DEFAULT 'general',
                is_public   INTEGER DEFAULT 0,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_skills_user
                ON skills(user_id);
        """)

    def _migrate_phase10_user_presets(self, conn: sqlite3.Connection) -> None:
        """User-defined image/skill style presets (studio)."""
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS user_presets (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL,
                kind         TEXT    NOT NULL CHECK (kind IN ('image', 'skill')),
                name         TEXT    NOT NULL,
                description  TEXT    DEFAULT '',
                payload_json TEXT    NOT NULL DEFAULT '{}',
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_user_presets_user_kind
                ON user_presets(user_id, kind);
        """)

    def _migrate_phase11_pre_router_and_skill_client_id(self, conn: sqlite3.Connection) -> None:
        """Логи пре-роутера LLM; client_local_id для синхронизации скиллов с клиента."""
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS pre_router_logs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER NOT NULL,
                text            TEXT    NOT NULL,
                prompt_type     TEXT,
                intent          TEXT,
                confidence      REAL,
                reason          TEXT,
                expert_level    TEXT,
                user_overrode   INTEGER DEFAULT 0,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_pre_router_logs_user
                ON pre_router_logs(user_id, created_at DESC);
        """)
        self._safe_add_column(conn, "skills", "client_local_id", "TEXT")
        try:
            conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_user_client_local
                ON skills(user_id, client_local_id)
                WHERE client_local_id IS NOT NULL
                """
            )
        except sqlite3.OperationalError:
            pass

    def _migrate_phase12_library_cover_image(self, conn: sqlite3.Connection) -> None:
        """Превью картинки для записей библиотеки (проба Nano Banana и т.п.)."""
        self._safe_add_column(conn, "prompt_library", "cover_image_path", "TEXT DEFAULT ''")

    def _migrate_phase13_image_try_model(self, conn: sqlite3.Connection) -> None:
        """Модель OpenRouter для кнопки «Проба картинки» (полный id или короткий ключ)."""
        self._safe_add_column(conn, "user_preferences", "image_try_model", "TEXT DEFAULT ''")

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
                "theme": "amber",
                "font": "plusjakarta",
                "color_mode": "dark",
                "preferred_generation_models": [],
                "preferred_target_models": [],
                "simple_improve_preset": "balanced",
                "simple_improve_meta": "",
                "task_classification_mode": "heuristic",
                "task_classifier_model": "",
                "image_try_model": "",
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
        data.setdefault("image_try_model", "")
        data.setdefault("color_mode", "dark")
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
        color_mode: str | None = None,
        image_try_model: str | None = None,
    ) -> dict:
        current = self.get_user_preferences(user_id)
        next_theme = theme if theme is not None else str(current.get("theme") or "amber")
        next_font = font if font is not None else str(current.get("font") or "plusjakarta")
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
        next_color_mode = (
            color_mode
            if color_mode is not None
            else str(current.get("color_mode") or "dark")
        )
        if next_color_mode not in ("dark", "light"):
            next_color_mode = "dark"
        next_image_try = (
            image_try_model
            if image_try_model is not None
            else str(current.get("image_try_model") or "")
        )
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO user_preferences
                    (user_id, theme, font, color_mode, gen_models_json, target_models_json,
                     simple_improve_preset, simple_improve_meta,
                     task_classification_mode, task_classifier_model, image_try_model, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    theme = excluded.theme,
                    font = excluded.font,
                    color_mode = excluded.color_mode,
                    gen_models_json = excluded.gen_models_json,
                    target_models_json = excluded.target_models_json,
                    simple_improve_preset = excluded.simple_improve_preset,
                    simple_improve_meta = excluded.simple_improve_meta,
                    task_classification_mode = excluded.task_classification_mode,
                    task_classifier_model = excluded.task_classifier_model,
                    image_try_model = excluded.image_try_model,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    next_theme,
                    next_font,
                    next_color_mode,
                    json.dumps(next_gen, ensure_ascii=False),
                    json.dumps(next_target, ensure_ascii=False),
                    next_simple_preset,
                    next_simple_meta,
                    next_cls_mode,
                    next_cls_model.strip()[:500],
                    str(next_image_try).strip()[:500],
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
                    INSERT INTO user_preferences (user_id, theme, font, color_mode, gen_models_json, target_models_json, openrouter_api_key, updated_at)
                    VALUES (?, 'amber', 'plusjakarta', 'dark', '[]', '["unknown"]', ?, CURRENT_TIMESTAMP)
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

    def list_user_presets(self, user_id: int, kind: str | None = None) -> list[dict]:
        """List user presets, optionally filtered by kind ('image' or 'skill')."""
        with self._conn() as conn:
            if kind in ("image", "skill"):
                rows = conn.execute(
                    """
                    SELECT id, user_id, kind, name, description, payload_json, created_at
                    FROM user_presets WHERE user_id = ? AND kind = ?
                    ORDER BY lower(name) ASC
                    """,
                    (user_id, kind),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, user_id, kind, name, description, payload_json, created_at
                    FROM user_presets WHERE user_id = ?
                    ORDER BY kind ASC, lower(name) ASC
                    """,
                    (user_id,),
                ).fetchall()
        out = []
        for row in rows:
            d = dict(row)
            try:
                d["payload"] = json.loads(d.pop("payload_json") or "{}")
            except Exception:
                d["payload"] = {}
            out.append(d)
        return out

    def get_user_preset(self, preset_id: int, user_id: int) -> dict | None:
        """Return one preset if it belongs to the user."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM user_presets WHERE id = ? AND user_id = ?",
                (preset_id, user_id),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["payload"] = json.loads(d.pop("payload_json") or "{}")
        except Exception:
            d["payload"] = {}
        return d

    def create_user_preset(
        self,
        user_id: int,
        kind: str,
        name: str,
        description: str = "",
        payload: dict | None = None,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO user_presets (user_id, kind, name, description, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    kind,
                    name.strip(),
                    (description or "").strip(),
                    json.dumps(payload or {}, ensure_ascii=False),
                ),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def update_user_preset(
        self,
        preset_id: int,
        user_id: int,
        name: str | None = None,
        description: str | None = None,
        payload: dict | None = None,
    ) -> None:
        updates = []
        params: list = []
        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if description is not None:
            updates.append("description = ?")
            params.append(description.strip())
        if payload is not None:
            updates.append("payload_json = ?")
            params.append(json.dumps(payload, ensure_ascii=False))
        if not updates:
            return
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([preset_id, user_id])
        with self._conn() as conn:
            conn.execute(
                f"UPDATE user_presets SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                params,
            )

    def delete_user_preset(self, preset_id: int, user_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM user_presets WHERE id = ? AND user_id = ?",
                (preset_id, user_id),
            )

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
        cover_image_path: str | None = None,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO prompt_library
                    (user_id, title, tags, target_model, task_type, techniques, prompt, notes, cover_image_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    title,
                    json.dumps(tags or [], ensure_ascii=False),
                    target_model, task_type,
                    json.dumps(techniques or [], ensure_ascii=False),
                    prompt,
                    notes,
                    (cover_image_path or "").strip(),
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
            query += " AND (title LIKE ? OR prompt LIKE ? OR notes LIKE ? OR tags LIKE ?)"
            like = f"%{search.strip()}%"
            params.extend([like, like, like, like])

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
        prompt: str | None = None,
        tags: list[str] | None = None,
        notes: str | None = None,
        rating: int | None = None,
        cover_image_path: str | None = None,
        user_id: int | None = None,
    ) -> None:
        updates = []
        params = []
        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if prompt is not None:
            updates.append("prompt = ?")
            params.append(prompt)
        if tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(tags, ensure_ascii=False))
        if cover_image_path is not None:
            updates.append("cover_image_path = ?")
            params.append(cover_image_path.strip())
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

    # ─── Community prompts ─────────────────────────────────────────────────

    def create_community_prompt(
        self,
        author_user_id: int,
        title: str,
        prompt: str,
        description: str = "",
        prompt_type: str = "text",
        category: str = "general",
        tags: list[str] | None = None,
        image_path: str | None = None,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO community_prompts
                   (author_user_id, title, description, prompt, prompt_type, category, tags, image_path)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (author_user_id, title, description, prompt, prompt_type, category,
                 json.dumps(tags or [], ensure_ascii=False), image_path),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def list_community_prompts(
        self,
        prompt_type: str | None = None,
        category: str | None = None,
        search: str | None = None,
        sort: str = "newest",
        limit: int = 50,
        offset: int = 0,
        viewer_user_id: int | None = None,
    ) -> list[dict]:
        query = "SELECT cp.*, u.username AS author_name FROM community_prompts cp LEFT JOIN users u ON cp.author_user_id = u.id WHERE cp.is_public = 1"
        params: list = []
        if prompt_type:
            query += " AND cp.prompt_type = ?"
            params.append(prompt_type)
        if category:
            query += " AND cp.category = ?"
            params.append(category)
        if search:
            query += " AND (cp.title LIKE ? OR cp.description LIKE ? OR cp.prompt LIKE ?)"
            term = f"%{search}%"
            params.extend([term, term, term])
        if sort == "popular":
            query += " ORDER BY cp.upvotes DESC, cp.created_at DESC"
        elif sort == "top":
            query += " ORDER BY cp.upvotes DESC"
        else:
            query += " ORDER BY cp.created_at DESC"
        query += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
            items = []
            for row in rows:
                d = dict(row)
                try:
                    d["tags"] = json.loads(d["tags"]) if d["tags"] else []
                except Exception:
                    d["tags"] = []
                if viewer_user_id:
                    v = conn.execute(
                        "SELECT 1 FROM community_votes WHERE user_id = ? AND prompt_id = ?",
                        (viewer_user_id, d["id"]),
                    ).fetchone()
                    d["voted"] = v is not None
                else:
                    d["voted"] = False
                items.append(d)
            return items

    def get_community_prompt(self, prompt_id: int, viewer_user_id: int | None = None) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT cp.*, u.username AS author_name FROM community_prompts cp LEFT JOIN users u ON cp.author_user_id = u.id WHERE cp.id = ?",
                (prompt_id,),
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            try:
                d["tags"] = json.loads(d["tags"]) if d["tags"] else []
            except Exception:
                d["tags"] = []
            if viewer_user_id:
                v = conn.execute(
                    "SELECT 1 FROM community_votes WHERE user_id = ? AND prompt_id = ?",
                    (viewer_user_id, d["id"]),
                ).fetchone()
                d["voted"] = v is not None
            else:
                d["voted"] = False
            return d

    def update_community_prompt(
        self,
        prompt_id: int,
        user_id: int,
        title: str | None = None,
        description: str | None = None,
        prompt: str | None = None,
        tags: list[str] | None = None,
        category: str | None = None,
        image_path: str | None = None,
    ) -> None:
        updates: list[str] = []
        params: list = []
        if title is not None:
            updates.append("title = ?"); params.append(title)
        if description is not None:
            updates.append("description = ?"); params.append(description)
        if prompt is not None:
            updates.append("prompt = ?"); params.append(prompt)
        if tags is not None:
            updates.append("tags = ?"); params.append(json.dumps(tags, ensure_ascii=False))
        if category is not None:
            updates.append("category = ?"); params.append(category)
        if image_path is not None:
            updates.append("image_path = ?"); params.append(image_path)
        if not updates:
            return
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([prompt_id, user_id])
        with self._conn() as conn:
            conn.execute(
                f"UPDATE community_prompts SET {', '.join(updates)} WHERE id = ? AND author_user_id = ?",
                params,
            )

    def delete_community_prompt(self, prompt_id: int, user_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM community_prompts WHERE id = ? AND author_user_id = ?",
                (prompt_id, user_id),
            )

    def toggle_community_vote(self, user_id: int, prompt_id: int) -> bool:
        """Returns True if voted, False if unvoted."""
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM community_votes WHERE user_id = ? AND prompt_id = ?",
                (user_id, prompt_id),
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM community_votes WHERE id = ?", (existing["id"],))
                conn.execute(
                    "UPDATE community_prompts SET upvotes = MAX(0, upvotes - 1) WHERE id = ?",
                    (prompt_id,),
                )
                return False
            else:
                conn.execute(
                    "INSERT INTO community_votes (user_id, prompt_id) VALUES (?, ?)",
                    (user_id, prompt_id),
                )
                conn.execute(
                    "UPDATE community_prompts SET upvotes = upvotes + 1 WHERE id = ?",
                    (prompt_id,),
                )
                return True

    # ─── Skills (backend-persisted) ────────────────────────────────────────

    def create_skill(self, user_id: int, name: str, body: str, description: str = "", category: str = "general") -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO skills (user_id, name, description, body, category) VALUES (?, ?, ?, ?, ?)",
                (user_id, name, description, body, category),
            )
            return cur.lastrowid  # type: ignore[return-value]

    def list_skills(self, user_id: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM skills WHERE user_id = ? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_skill(self, skill_id: int, user_id: int) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM skills WHERE id = ? AND user_id = ?",
                (skill_id, user_id),
            ).fetchone()
            return dict(row) if row else None

    def update_skill(
        self, skill_id: int, user_id: int,
        name: str | None = None, description: str | None = None,
        body: str | None = None, category: str | None = None,
    ) -> None:
        updates: list[str] = []
        params: list = []
        if name is not None:
            updates.append("name = ?"); params.append(name)
        if description is not None:
            updates.append("description = ?"); params.append(description)
        if body is not None:
            updates.append("body = ?"); params.append(body)
        if category is not None:
            updates.append("category = ?"); params.append(category)
        if not updates:
            return
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([skill_id, user_id])
        with self._conn() as conn:
            conn.execute(
                f"UPDATE skills SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                params,
            )

    def delete_skill(self, skill_id: int, user_id: int) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM skills WHERE id = ? AND user_id = ?", (skill_id, user_id))

    def insert_pre_router_log(
        self,
        user_id: int,
        text: str,
        prompt_type: str | None,
        intent: str | None,
        confidence: float | None,
        reason: str | None,
        expert_level: str | None,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO pre_router_logs
                    (user_id, text, prompt_type, intent, confidence, reason, expert_level)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    text,
                    prompt_type or "",
                    intent,
                    confidence,
                    reason,
                    expert_level,
                ),
            )
            return int(cur.lastrowid)  # type: ignore[return-value]

    def mark_pre_router_override(self, user_id: int, log_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE pre_router_logs SET user_overrode = 1 WHERE id = ? AND user_id = ?",
                (log_id, user_id),
            )

    def bulk_upsert_skills(
        self,
        user_id: int,
        items: list[dict],
    ) -> dict[str, int]:
        """
        items: local_id, name, body, description?, category?, updated_at (ISO).
        Если на сервере запись с тем же client_local_id новее клиента — conflict.
        """
        inserted = 0
        updated = 0
        conflicts = 0

        def _parse_ts(s: str | None) -> float:
            if not s:
                return 0.0
            raw = s.strip()
            try:
                if raw.endswith("Z"):
                    raw = raw[:-1] + "+00:00"
                if "T" in raw or raw.count("-") >= 3:
                    return datetime.fromisoformat(raw).timestamp()
                return datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S").timestamp()
            except Exception:
                return 0.0

        with self._conn() as conn:
            for raw in items:
                if not isinstance(raw, dict):
                    continue
                lid = str(raw.get("local_id") or "").strip()
                name = str(raw.get("name") or "").strip()
                body = str(raw.get("body") or "").strip()
                if not lid or not name or not body:
                    continue
                description = str(raw.get("description") or "").strip()
                category = str(raw.get("category") or "general").strip() or "general"
                ua = raw.get("updated_at")
                client_ts = _parse_ts(ua) if isinstance(ua, str) else 0.0

                row = conn.execute(
                    "SELECT id, updated_at FROM skills WHERE user_id = ? AND client_local_id = ?",
                    (user_id, lid),
                ).fetchone()
                if row:
                    srv_raw = str(row["updated_at"] or "")
                    srv_ts = _parse_ts(srv_raw) if srv_raw else 0.0
                    if srv_ts > client_ts + 1e-6:
                        conflicts += 1
                        continue
                    conn.execute(
                        """
                        UPDATE skills
                        SET name = ?, description = ?, body = ?, category = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND user_id = ?
                        """,
                        (name, description, body, category, int(row["id"]), user_id),
                    )
                    updated += 1
                else:
                    conn.execute(
                        """
                        INSERT INTO skills (user_id, name, description, body, category, client_local_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (user_id, name, description, body, category, lid),
                    )
                    inserted += 1
        return {"inserted": inserted, "updated": updated, "conflicts": conflicts}

    def create_skill_with_client_id(
        self,
        user_id: int,
        name: str,
        body: str,
        description: str = "",
        category: str = "general",
        client_local_id: str | None = None,
    ) -> int:
        lid = (client_local_id or "").strip() or None
        with self._conn() as conn:
            if lid:
                ex = conn.execute(
                    "SELECT id FROM skills WHERE user_id = ? AND client_local_id = ?",
                    (user_id, lid),
                ).fetchone()
                if ex:
                    conn.execute(
                        """
                        UPDATE skills
                        SET name = ?, description = ?, body = ?, category = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND user_id = ?
                        """,
                        (name, description, body, category, int(ex["id"]), user_id),
                    )
                    return int(ex["id"])
            cur = conn.execute(
                """
                INSERT INTO skills (user_id, name, description, body, category, client_local_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, name, description, body, category, lid),
            )
            return int(cur.lastrowid)  # type: ignore[return-value]

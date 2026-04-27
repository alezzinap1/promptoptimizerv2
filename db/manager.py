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
            self._migrate_phase14_admin_flags(conn)
            self._migrate_phase15_user_usage_limits(conn)
            self._migrate_phase16_model_health(conn)
            self._migrate_phase17_prompt_alt_and_tier_overrides(conn)
            self._migrate_phase18_onboarding_profile(conn)
            self._migrate_phase19_llm_review_cache(conn)
            self._migrate_phase20_eval_stability(conn)
            self._migrate_phase21_eval_synthesis_dual_judge(conn)
            self._migrate_phase22_eval_lineage_meta(conn)
            self._migrate_phase23_eval_meta_lite(conn)
            self._migrate_phase24_model_health_slot_pk(conn)
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

    def _migrate_phase14_admin_flags(self, conn: sqlite3.Connection) -> None:
        """Admin / abuse: flags on users + append-only admin audit log."""
        self._safe_add_column(conn, "users", "is_admin", "INTEGER NOT NULL DEFAULT 0")
        self._safe_add_column(conn, "users", "is_blocked", "INTEGER NOT NULL DEFAULT 0")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS admin_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                target_user_id INTEGER,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_user_id) REFERENCES users(id),
                FOREIGN KEY (target_user_id) REFERENCES users(id)
            )
        """)

    def _migrate_phase15_user_usage_limits(self, conn: sqlite3.Connection) -> None:
        """Per-user trial token cap, RPM override, session generation budget (NULL = global default)."""
        self._safe_add_column(conn, "user_usage", "trial_tokens_limit", "INTEGER")
        self._safe_add_column(conn, "user_usage", "rate_limit_rpm", "INTEGER")
        self._safe_add_column(conn, "user_usage", "session_generation_budget", "INTEGER")

    def _migrate_phase16_model_health(self, conn: sqlite3.Connection) -> None:
        """Снапшот здоровья: одна строка на слот каталога (model_id, mode, tier)."""
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS model_health (
                model_id                TEXT NOT NULL,
                mode                    TEXT NOT NULL DEFAULT '',
                tier                    TEXT NOT NULL DEFAULT '',
                available               INTEGER NOT NULL DEFAULT 1,
                reason                  TEXT NOT NULL DEFAULT '',
                last_pricing_prompt     REAL,
                last_pricing_completion REAL,
                swapped_to              TEXT,
                last_checked_at         TIMESTAMP,
                PRIMARY KEY (model_id, mode, tier)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS model_health_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                model_id        TEXT NOT NULL,
                event           TEXT NOT NULL,
                detail          TEXT NOT NULL DEFAULT '',
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

    def _migrate_phase17_prompt_alt_and_tier_overrides(self, conn: sqlite3.Connection) -> None:
        """
        Бесплатный перевод без LLM: альтернативная языковая версия промпта
        хранится рядом с оригиналом. Админские оверрайды модели под (mode, tier).
        """
        self._safe_add_column(conn, "prompt_library", "prompt_alt", "TEXT DEFAULT ''")
        self._safe_add_column(conn, "prompt_library", "prompt_lang", "TEXT DEFAULT ''")
        self._safe_add_column(conn, "prompt_library", "prompt_alt_lang", "TEXT DEFAULT ''")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS model_tier_overrides (
                mode        TEXT NOT NULL,
                tier        TEXT NOT NULL,
                model_id    TEXT NOT NULL,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (mode, tier)
            )
            """
        )

    def _migrate_phase18_onboarding_profile(self, conn: sqlite3.Connection) -> None:
        """
        Onboarding profile persistence: what the user told us during the 3-step
        onboarding flow (goal + default tier) becomes part of their account
        instead of living only in localStorage. Lets the library's empty-state
        starter prompts work across devices and seeds Studio/Simple Improve
        with the user's picked tier.

        Also adds a per-user Compare v2 daily rounds cap so admins can loosen
        or tighten the default without changing global config.
        """
        self._safe_add_column(conn, "user_preferences", "user_goal", "TEXT DEFAULT ''")
        self._safe_add_column(conn, "user_preferences", "default_tier", "TEXT DEFAULT ''")
        self._safe_add_column(conn, "user_usage", "compare_rounds_per_day", "INTEGER")

    def _migrate_phase19_llm_review_cache(self, conn: sqlite3.Connection) -> None:
        """Кэш текстовой оценки промпта (LLM-судья) — один и тот же промпт не дергает модель повторно."""
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS library_llm_review_cache (
                user_id         INTEGER NOT NULL,
                cache_key       TEXT    NOT NULL,
                review          TEXT    NOT NULL,
                judge_model     TEXT    NOT NULL,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, cache_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_llm_review_cache_user
                ON library_llm_review_cache(user_id)
            """
        )

    def _migrate_phase20_eval_stability(self, conn: sqlite3.Connection) -> None:
        """Stability evaluation runs (N-runs, judge, embeddings, pair-compare).

        Creates 4 tables for evaluation runs/results/judge-scores/rubrics
        plus a per-user-per-day usage counter and the daily budget column on users.
        """
        self._safe_add_column(conn, "users", "eval_daily_budget_usd", "REAL NOT NULL DEFAULT 5.0")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS eval_rubrics (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id             INTEGER NOT NULL,
                name                TEXT    NOT NULL,
                preset_key          TEXT,
                criteria_json       TEXT    NOT NULL,
                reference_required  INTEGER NOT NULL DEFAULT 0,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS eval_runs (
                id                       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id                  INTEGER NOT NULL,
                status                   TEXT    NOT NULL,
                mode                     TEXT    NOT NULL,
                prompt_a_text            TEXT    NOT NULL,
                prompt_a_hash            TEXT    NOT NULL,
                prompt_a_library_id      INTEGER,
                prompt_a_library_version INTEGER,
                prompt_b_text            TEXT,
                prompt_b_hash            TEXT,
                prompt_b_library_id      INTEGER,
                prompt_b_library_version INTEGER,
                task_input               TEXT    NOT NULL,
                reference_answer         TEXT,
                target_model_id          TEXT    NOT NULL,
                judge_model_id           TEXT    NOT NULL,
                embedding_model_id       TEXT    NOT NULL,
                rubric_id                INTEGER,
                rubric_snapshot_json     TEXT    NOT NULL,
                n_runs                   INTEGER NOT NULL,
                parallelism              INTEGER NOT NULL DEFAULT 4,
                temperature              REAL    NOT NULL,
                top_p                    REAL,
                pair_judge_samples       INTEGER DEFAULT 5,
                cost_preview_usd         REAL    NOT NULL,
                cost_preview_tokens      INTEGER NOT NULL,
                cost_actual_usd          REAL,
                cost_actual_tokens       INTEGER,
                duration_ms              INTEGER,
                diversity_score          REAL,
                agg_overall_p50          REAL,
                agg_overall_p10          REAL,
                agg_overall_p90          REAL,
                agg_overall_var          REAL,
                pair_winner              TEXT,
                pair_winner_confidence   REAL,
                error                    TEXT,
                created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at              TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS eval_results (
                id                       INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id                   INTEGER NOT NULL,
                prompt_side              TEXT    NOT NULL,
                run_index                INTEGER NOT NULL,
                output_text              TEXT    NOT NULL,
                output_tokens            INTEGER NOT NULL,
                input_tokens             INTEGER NOT NULL,
                latency_ms               INTEGER,
                status                   TEXT    NOT NULL,
                error                    TEXT,
                embedding_blob           BLOB,
                judge_overall            REAL,
                judge_overall_secondary  REAL,
                judge_reasoning          TEXT,
                parsed_as_json           INTEGER NOT NULL DEFAULT 0,
                parsed_top_fields_json   TEXT,
                created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (run_id) REFERENCES eval_runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS eval_judge_scores (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                result_id       INTEGER NOT NULL,
                criterion_key   TEXT    NOT NULL,
                score           REAL    NOT NULL,
                reasoning       TEXT,
                FOREIGN KEY (result_id) REFERENCES eval_results(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS eval_user_daily_usage (
                user_id     INTEGER NOT NULL,
                date_utc    TEXT    NOT NULL,
                dollars     REAL    NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, date_utc),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_eval_runs_user
                ON eval_runs(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_eval_runs_lib_a
                ON eval_runs(prompt_a_library_id);
            CREATE INDEX IF NOT EXISTS idx_eval_runs_lib_b
                ON eval_runs(prompt_b_library_id);
            CREATE INDEX IF NOT EXISTS idx_eval_results_run
                ON eval_results(run_id);
            """
        )

    def _migrate_phase21_eval_synthesis_dual_judge(self, conn: sqlite3.Connection) -> None:
        """Second judge (MVP-1.5), meta-synthesis report, per-output secondary reasoning."""
        self._safe_add_column(conn, "eval_runs", "judge_secondary_model_id", "TEXT")
        self._safe_add_column(conn, "eval_runs", "run_synthesis", "INTEGER NOT NULL DEFAULT 1")
        self._safe_add_column(conn, "eval_runs", "synthesis_model_id", "TEXT")
        self._safe_add_column(conn, "eval_runs", "synthesis_report_json", "TEXT")
        self._safe_add_column(conn, "eval_runs", "synthesis_error", "TEXT")
        self._safe_add_column(conn, "eval_runs", "judge_agreement_mean_abs", "REAL")
        self._safe_add_column(conn, "eval_results", "judge_reasoning_secondary", "TEXT")

    def _migrate_phase22_eval_lineage_meta(self, conn: sqlite3.Connection) -> None:
        """Lineage fingerprints (C1/C2 trends) + persisted meta-analysis pipeline."""
        self._safe_add_column(conn, "eval_runs", "prompt_fingerprint", "TEXT")
        self._safe_add_column(conn, "eval_runs", "task_fingerprint", "TEXT")
        self._safe_add_column(conn, "eval_runs", "rubric_fingerprint", "TEXT")
        self._safe_add_column(conn, "eval_runs", "meta_pipeline_json", "TEXT")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eval_runs_lineage
                ON eval_runs(
                    user_id,
                    prompt_fingerprint,
                    task_fingerprint,
                    rubric_fingerprint,
                    created_at DESC
                )
            """
        )

    def _migrate_phase23_eval_meta_lite(self, conn: sqlite3.Connection) -> None:
        """Lite meta-synthesis: single LLM pass instead of full multi-step pipeline."""
        self._safe_add_column(conn, "eval_runs", "meta_synthesis_mode", "TEXT NOT NULL DEFAULT 'full'")

    def _migrate_phase24_model_health_slot_pk(self, conn: sqlite3.Connection) -> None:
        """Старые БД: PRIMARY KEY только по model_id → пересобрать таблицу с составным ключом."""
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='model_health'"
        ).fetchone()
        if not row or not row[0]:
            return
        ddl = row[0]
        if "PRIMARY KEY (model_id, mode, tier)" in ddl:
            return
        conn.executescript(
            """
            CREATE TABLE model_health__m24 (
                model_id                TEXT NOT NULL,
                mode                    TEXT NOT NULL DEFAULT '',
                tier                    TEXT NOT NULL DEFAULT '',
                available               INTEGER NOT NULL DEFAULT 1,
                reason                  TEXT NOT NULL DEFAULT '',
                last_pricing_prompt     REAL,
                last_pricing_completion REAL,
                swapped_to              TEXT,
                last_checked_at         TIMESTAMP,
                PRIMARY KEY (model_id, mode, tier)
            );
            INSERT INTO model_health__m24 (
                model_id, mode, tier, available, reason,
                last_pricing_prompt, last_pricing_completion, swapped_to, last_checked_at
            )
            SELECT model_id, mode, tier, available, reason,
                   last_pricing_prompt, last_pricing_completion, swapped_to, last_checked_at
            FROM model_health;
            DROP TABLE model_health;
            ALTER TABLE model_health__m24 RENAME TO model_health;
            """
        )

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
                "user_goal": "",
                "default_tier": "",
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
        data.setdefault("user_goal", "")
        data.setdefault("default_tier", "")
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
        user_goal: str | None = None,
        default_tier: str | None = None,
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
        next_user_goal = (
            user_goal
            if user_goal is not None
            else str(current.get("user_goal") or "")
        )
        next_default_tier = (
            default_tier
            if default_tier is not None
            else str(current.get("default_tier") or "")
        )
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO user_preferences
                    (user_id, theme, font, color_mode, gen_models_json, target_models_json,
                     simple_improve_preset, simple_improve_meta,
                     task_classification_mode, task_classifier_model, image_try_model,
                     user_goal, default_tier, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                    user_goal = excluded.user_goal,
                    default_tier = excluded.default_tier,
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
                    str(next_user_goal).strip()[:32],
                    str(next_default_tier).strip()[:32],
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
        """Get user's token and dollar usage plus optional per-user limit overrides."""
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT tokens_used, dollars_used, updated_at,
                       trial_tokens_limit, rate_limit_rpm, session_generation_budget
                FROM user_usage WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        if not row:
            return {
                "tokens_used": 0,
                "dollars_used": 0.0,
                "updated_at": None,
                "trial_tokens_limit": None,
                "rate_limit_rpm": None,
                "session_generation_budget": None,
            }
        data = dict(row)
        return {
            "tokens_used": int(data.get("tokens_used") or 0),
            "dollars_used": float(data.get("dollars_used") or 0),
            "updated_at": data.get("updated_at"),
            "trial_tokens_limit": data.get("trial_tokens_limit"),
            "rate_limit_rpm": data.get("rate_limit_rpm"),
            "session_generation_budget": data.get("session_generation_budget"),
        }

    def update_user_usage_limits(self, user_id: int, updates: dict) -> None:
        """Set nullable limit columns on user_usage (caller validates). Ensures row exists."""
        allowed = {"trial_tokens_limit", "rate_limit_rpm", "session_generation_budget"}
        cols = [k for k in updates if k in allowed]
        if not cols:
            return
        with self._conn() as conn:
            cur = conn.execute("SELECT 1 FROM user_usage WHERE user_id = ?", (user_id,))
            if not cur.fetchone():
                conn.execute(
                    """
                    INSERT INTO user_usage (user_id, tokens_used, dollars_used, updated_at)
                    VALUES (?, 0, 0, CURRENT_TIMESTAMP)
                    """,
                    (user_id,),
                )
            sets = ", ".join(f"{c} = ?" for c in cols)
            values = [updates[c] for c in cols]
            conn.execute(
                f"UPDATE user_usage SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                [*values, user_id],
            )

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

    def log_admin_audit(
        self,
        admin_user_id: int,
        action: str,
        target_user_id: int | None,
        meta: dict | None = None,
    ) -> int:
        """Record an admin action (no prompt/user content)."""
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO admin_audit_log (admin_user_id, action, target_user_id, meta_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    admin_user_id,
                    action,
                    target_user_id,
                    json.dumps(meta or {}, ensure_ascii=False),
                ),
            )
            return int(cur.lastrowid)  # type: ignore[return-value]

    def list_users_admin(
        self,
        *,
        q: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        """Paginated user list for admin UI (no password_hash)."""
        limit = max(1, min(100, int(limit)))
        offset = max(0, int(offset))
        qn = (q or "").strip()
        params: list = []
        if qn:
            like = f"%{qn.lower()}%"
            where = """(
                LOWER(u.username) LIKE ? OR LOWER(COALESCE(u.email, '')) LIKE ?
                OR CAST(u.id AS TEXT) = ?
            )"""
            params.extend([like, like, qn])
        else:
            where = "1=1"

        count_sql = f"SELECT COUNT(*) FROM users u WHERE {where}"
        list_sql = f"""
            SELECT
                u.id,
                u.username,
                u.email,
                u.created_at,
                COALESCE(u.is_admin, 0) AS is_admin,
                COALESCE(u.is_blocked, 0) AS is_blocked,
                (
                    SELECT MAX(s.updated_at) FROM user_sessions s WHERE s.user_id = u.id
                ) AS last_active_at,
                COALESCE(uu.tokens_used, 0) AS tokens_used,
                COALESCE(uu.dollars_used, 0.0) AS dollars_used,
                uu.trial_tokens_limit AS trial_tokens_limit,
                uu.rate_limit_rpm AS rate_limit_rpm,
                uu.session_generation_budget AS session_generation_budget
            FROM users u
            LEFT JOIN user_usage uu ON uu.user_id = u.id
            WHERE {where}
            ORDER BY datetime(
                COALESCE(
                    (SELECT MAX(s2.updated_at) FROM user_sessions s2 WHERE s2.user_id = u.id),
                    u.created_at
                )
            ) DESC, u.id DESC
            LIMIT ? OFFSET ?
        """
        with self._conn() as conn:
            total = int(conn.execute(count_sql, params).fetchone()[0])
            rows = conn.execute(list_sql, [*params, limit, offset]).fetchall()
        out: list[dict] = []
        for row in rows:
            d = dict(row)
            d["is_admin"] = int(d.get("is_admin") or 0)
            d["is_blocked"] = int(d.get("is_blocked") or 0)
            out.append(d)
        return out, total

    def set_user_blocked(self, user_id: int, blocked: bool) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE users SET is_blocked = ? WHERE id = ?",
                (1 if blocked else 0, user_id),
            )

    def reset_user_trial_usage(self, user_id: int) -> None:
        """Zero trial counters in user_usage (insert row if missing)."""
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE user_usage
                SET tokens_used = 0, dollars_used = 0, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
                """,
                (user_id,),
            )
            if cur.rowcount == 0:
                conn.execute(
                    """
                    INSERT INTO user_usage (user_id, tokens_used, dollars_used, updated_at)
                    VALUES (?, 0, 0, CURRENT_TIMESTAMP)
                    """,
                    (user_id,),
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

    # ─── Model health (Phase 16) ───────────────────────────────────────────────

    def upsert_model_health(
        self,
        *,
        model_id: str,
        mode: str,
        tier: str,
        available: bool,
        reason: str,
        pricing_prompt: float | None,
        pricing_completion: float | None,
        swapped_to: str | None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO model_health (
                    model_id, mode, tier, available, reason,
                    last_pricing_prompt, last_pricing_completion,
                    swapped_to, last_checked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(model_id, mode, tier) DO UPDATE SET
                    available = excluded.available,
                    reason = excluded.reason,
                    last_pricing_prompt = excluded.last_pricing_prompt,
                    last_pricing_completion = excluded.last_pricing_completion,
                    swapped_to = excluded.swapped_to,
                    last_checked_at = CURRENT_TIMESTAMP
                """,
                (
                    model_id,
                    mode,
                    tier,
                    1 if available else 0,
                    reason,
                    pricing_prompt,
                    pricing_completion,
                    swapped_to,
                ),
            )

    def list_model_health(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM model_health ORDER BY mode, tier, model_id"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_model_health_slot(self, model_id: str, mode: str, tier: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM model_health WHERE model_id = ? AND mode = ? AND tier = ?",
                (model_id, mode, tier),
            ).fetchone()
        return dict(row) if row else None

    def log_model_health_event(self, model_id: str, event: str, detail: str = "") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO model_health_events (model_id, event, detail) VALUES (?, ?, ?)",
                (model_id, event, detail),
            )

    def list_model_health_events(self, limit: int = 50) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM model_health_events ORDER BY created_at DESC, id DESC LIMIT ?",
                (max(1, int(limit)),),
            ).fetchall()
        return [dict(r) for r in rows]

    # ─── Tier overrides (Phase 17) ─────────────────────────────────────────────

    def get_tier_overrides(self) -> list[dict]:
        """Все активные оверрайды (mode, tier) → model_id."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT mode, tier, model_id, updated_at FROM model_tier_overrides"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_tier_override(self, mode: str, tier: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT model_id FROM model_tier_overrides WHERE mode = ? AND tier = ?",
                (mode, tier),
            ).fetchone()
        return str(row["model_id"]) if row else None

    def set_tier_override(self, mode: str, tier: str, model_id: str | None) -> None:
        """`model_id=None` сбрасывает оверрайд (авто-режим)."""
        with self._conn() as conn:
            if not model_id:
                conn.execute(
                    "DELETE FROM model_tier_overrides WHERE mode = ? AND tier = ?",
                    (mode, tier),
                )
                return
            conn.execute(
                """
                INSERT INTO model_tier_overrides (mode, tier, model_id, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(mode, tier) DO UPDATE SET
                    model_id = excluded.model_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (mode, tier, model_id),
            )

    # ─── Prompt library translation (Phase 17) ─────────────────────────────────

    def set_prompt_library_translation(
        self,
        item_id: int,
        *,
        prompt_lang: str,
        prompt_alt: str,
        prompt_alt_lang: str,
        user_id: int | None = None,
    ) -> bool:
        with self._conn() as conn:
            if user_id is None:
                cur = conn.execute(
                    """
                    UPDATE prompt_library
                    SET prompt_lang = ?, prompt_alt = ?, prompt_alt_lang = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (prompt_lang, prompt_alt, prompt_alt_lang, item_id),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE prompt_library
                    SET prompt_lang = ?, prompt_alt = ?, prompt_alt_lang = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND user_id = ?
                    """,
                    (prompt_lang, prompt_alt, prompt_alt_lang, item_id, user_id),
                )
        return cur.rowcount > 0

    def get_library_item(self, item_id: int, user_id: int | None = None) -> dict | None:
        with self._conn() as conn:
            if user_id is None:
                row = conn.execute("SELECT * FROM prompt_library WHERE id = ?", (item_id,)).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM prompt_library WHERE id = ? AND user_id = ?",
                    (item_id, user_id),
                ).fetchone()
        if not row:
            return None
        d = dict(row)
        for field in ("tags", "techniques"):
            try:
                d[field] = json.loads(d[field]) if d[field] else []
            except Exception:
                d[field] = []
        return d

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

    def get_llm_review_cache(self, user_id: int, cache_key: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT review, judge_model FROM library_llm_review_cache
                WHERE user_id = ? AND cache_key = ?
                """,
                (user_id, cache_key),
            ).fetchone()
            if not row:
                return None
            return {"review": str(row["review"]), "judge_model": str(row["judge_model"])}

    def upsert_llm_review_cache(self, user_id: int, cache_key: str, review: str, judge_model: str) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO library_llm_review_cache (user_id, cache_key, review, judge_model)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, cache_key) DO UPDATE SET
                    review = excluded.review,
                    judge_model = excluded.judge_model,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, cache_key, review, judge_model),
            )

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

    def list_community_prompts_admin(
        self,
        *,
        visibility: str = "all",
        sort: str = "newest",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """visibility: all | public | hidden — для модерации ленты (is_public)."""
        vis = (visibility or "all").lower()
        base_from = "FROM community_prompts cp LEFT JOIN users u ON cp.author_user_id = u.id"
        if vis == "public":
            where = " WHERE cp.is_public = 1"
        elif vis == "hidden":
            where = " WHERE cp.is_public = 0"
        else:
            where = ""
        count_sql = f"SELECT COUNT(*) AS c {base_from}{where}"
        with self._conn() as conn:
            total = int(conn.execute(count_sql).fetchone()[0])
        if sort == "popular":
            order = " ORDER BY cp.upvotes DESC, cp.created_at DESC"
        else:
            order = " ORDER BY cp.created_at DESC"
        query = f"SELECT cp.*, u.username AS author_name {base_from}{where}{order} LIMIT ? OFFSET ?"
        with self._conn() as conn:
            rows = conn.execute(query, (limit, offset)).fetchall()
        items: list[dict] = []
        for row in rows:
            d = dict(row)
            try:
                d["tags"] = json.loads(d["tags"]) if d["tags"] else []
            except Exception:
                d["tags"] = []
            items.append(d)
        return items, total

    def admin_set_community_public(self, prompt_id: int, is_public: int) -> bool:
        """Скрыть/показать пост в ленте без проверки автора (только админ API)."""
        val = 1 if int(is_public) else 0
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE community_prompts SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (val, prompt_id),
            )
            return bool(cur.rowcount)

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

    # ─── Eval Stability: rubrics ───────────────────────────────────────────

    def create_eval_rubric(
        self,
        user_id: int,
        name: str,
        criteria: list[dict],
        preset_key: str | None = None,
        reference_required: bool = False,
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO eval_rubrics (user_id, name, preset_key, criteria_json, reference_required)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    int(user_id),
                    name,
                    preset_key,
                    json.dumps(criteria, ensure_ascii=False),
                    1 if reference_required else 0,
                ),
            )
            return int(cur.lastrowid)  # type: ignore[return-value]

    @staticmethod
    def _rubric_row_to_dict(row) -> dict:
        d = dict(row)
        try:
            d["criteria"] = json.loads(d.pop("criteria_json")) if d.get("criteria_json") else []
        except Exception:
            d["criteria"] = []
        d["reference_required"] = bool(d.get("reference_required") or 0)
        return d

    def list_eval_rubrics(self, user_id: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM eval_rubrics WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
                (int(user_id),),
            ).fetchall()
        return [self._rubric_row_to_dict(r) for r in rows]

    def get_eval_rubric(self, rubric_id: int, user_id: int | None = None) -> dict | None:
        with self._conn() as conn:
            if user_id is None:
                row = conn.execute(
                    "SELECT * FROM eval_rubrics WHERE id = ?", (int(rubric_id),)
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM eval_rubrics WHERE id = ? AND user_id = ?",
                    (int(rubric_id), int(user_id)),
                ).fetchone()
        return self._rubric_row_to_dict(row) if row else None

    def update_eval_rubric(
        self,
        rubric_id: int,
        user_id: int,
        name: str | None = None,
        criteria: list[dict] | None = None,
        reference_required: bool | None = None,
    ) -> bool:
        updates: list[str] = []
        params: list = []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if criteria is not None:
            updates.append("criteria_json = ?")
            params.append(json.dumps(criteria, ensure_ascii=False))
        if reference_required is not None:
            updates.append("reference_required = ?")
            params.append(1 if reference_required else 0)
        if not updates:
            return False
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([int(rubric_id), int(user_id)])
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE eval_rubrics SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                params,
            )
            return cur.rowcount > 0

    def delete_eval_rubric(self, rubric_id: int, user_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM eval_rubrics WHERE id = ? AND user_id = ?",
                (int(rubric_id), int(user_id)),
            )
            return cur.rowcount > 0

    # ─── Eval Stability: runs ─────────────────────────────────────────────

    def create_eval_run(
        self,
        *,
        user_id: int,
        mode: str,
        prompt_a_text: str,
        prompt_a_hash: str,
        task_input: str,
        target_model_id: str,
        judge_model_id: str,
        embedding_model_id: str,
        rubric_snapshot: dict,
        n_runs: int,
        cost_preview_usd: float,
        cost_preview_tokens: int,
        temperature: float = 0.7,
        prompt_a_library_id: int | None = None,
        prompt_a_library_version: int | None = None,
        prompt_b_text: str | None = None,
        prompt_b_hash: str | None = None,
        prompt_b_library_id: int | None = None,
        prompt_b_library_version: int | None = None,
        reference_answer: str | None = None,
        rubric_id: int | None = None,
        parallelism: int = 4,
        top_p: float | None = None,
        pair_judge_samples: int = 5,
        status: str = "queued",
        judge_secondary_model_id: str | None = None,
        run_synthesis: bool = True,
        synthesis_model_id: str | None = None,
        prompt_fingerprint: str | None = None,
        task_fingerprint: str | None = None,
        rubric_fingerprint: str | None = None,
        meta_synthesis_mode: str = "full",
    ) -> int:
        msm = (meta_synthesis_mode or "full").strip().lower()
        if msm not in ("full", "lite"):
            msm = "full"
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO eval_runs (
                    user_id, status, mode,
                    prompt_a_text, prompt_a_hash, prompt_a_library_id, prompt_a_library_version,
                    prompt_b_text, prompt_b_hash, prompt_b_library_id, prompt_b_library_version,
                    task_input, reference_answer,
                    target_model_id, judge_model_id, embedding_model_id,
                    rubric_id, rubric_snapshot_json,
                    n_runs, parallelism, temperature, top_p, pair_judge_samples,
                    cost_preview_usd, cost_preview_tokens,
                    judge_secondary_model_id, run_synthesis, synthesis_model_id,
                    prompt_fingerprint, task_fingerprint, rubric_fingerprint,
                    meta_synthesis_mode
                ) VALUES (
                    ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?,
                    ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?
                )
                """,
                (
                    int(user_id), status, mode,
                    prompt_a_text, prompt_a_hash, prompt_a_library_id, prompt_a_library_version,
                    prompt_b_text, prompt_b_hash, prompt_b_library_id, prompt_b_library_version,
                    task_input, reference_answer,
                    target_model_id, judge_model_id, embedding_model_id,
                    rubric_id, json.dumps(rubric_snapshot, ensure_ascii=False),
                    int(n_runs), int(parallelism), float(temperature), top_p, int(pair_judge_samples),
                    float(cost_preview_usd), int(cost_preview_tokens),
                    judge_secondary_model_id,
                    1 if run_synthesis else 0,
                    synthesis_model_id,
                    prompt_fingerprint,
                    task_fingerprint,
                    rubric_fingerprint,
                    msm,
                ),
            )
            return int(cur.lastrowid)  # type: ignore[return-value]

    @staticmethod
    def _run_row_to_dict(row) -> dict:
        d = dict(row)
        snap = d.pop("rubric_snapshot_json", None)
        try:
            d["rubric_snapshot"] = json.loads(snap) if snap else {}
        except Exception:
            d["rubric_snapshot"] = {}
        if "run_synthesis" in d:
            try:
                d["run_synthesis"] = bool(int(d["run_synthesis"]))
            except (TypeError, ValueError):
                d["run_synthesis"] = True
        return d

    def get_eval_run(self, run_id: int, user_id: int | None = None) -> dict | None:
        with self._conn() as conn:
            if user_id is None:
                row = conn.execute(
                    "SELECT * FROM eval_runs WHERE id = ?", (int(run_id),)
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM eval_runs WHERE id = ? AND user_id = ?",
                    (int(run_id), int(user_id)),
                ).fetchone()
        return self._run_row_to_dict(row) if row else None

    def update_eval_run_status(self, run_id: int, status: str, error: str | None = None) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE eval_runs SET status = ?, error = COALESCE(?, error) WHERE id = ?",
                (status, error, int(run_id)),
            )

    def finalize_eval_run(
        self,
        run_id: int,
        *,
        status: str,
        cost_actual_usd: float | None = None,
        cost_actual_tokens: int | None = None,
        duration_ms: int | None = None,
        diversity_score: float | None = None,
        agg_overall_p50: float | None = None,
        agg_overall_p10: float | None = None,
        agg_overall_p90: float | None = None,
        agg_overall_var: float | None = None,
        pair_winner: str | None = None,
        pair_winner_confidence: float | None = None,
        error: str | None = None,
        judge_agreement_mean_abs: float | None = None,
        synthesis_report_json: str | None = None,
        synthesis_error: str | None = None,
        meta_pipeline_json: str | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                UPDATE eval_runs SET
                    status = ?,
                    cost_actual_usd = COALESCE(?, cost_actual_usd),
                    cost_actual_tokens = COALESCE(?, cost_actual_tokens),
                    duration_ms = COALESCE(?, duration_ms),
                    diversity_score = COALESCE(?, diversity_score),
                    agg_overall_p50 = COALESCE(?, agg_overall_p50),
                    agg_overall_p10 = COALESCE(?, agg_overall_p10),
                    agg_overall_p90 = COALESCE(?, agg_overall_p90),
                    agg_overall_var = COALESCE(?, agg_overall_var),
                    pair_winner = COALESCE(?, pair_winner),
                    pair_winner_confidence = COALESCE(?, pair_winner_confidence),
                    error = COALESCE(?, error),
                    judge_agreement_mean_abs = COALESCE(?, judge_agreement_mean_abs),
                    synthesis_report_json = COALESCE(?, synthesis_report_json),
                    synthesis_error = COALESCE(?, synthesis_error),
                    meta_pipeline_json = COALESCE(?, meta_pipeline_json),
                    finished_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    status,
                    cost_actual_usd, cost_actual_tokens, duration_ms,
                    diversity_score,
                    agg_overall_p50, agg_overall_p10, agg_overall_p90, agg_overall_var,
                    pair_winner, pair_winner_confidence,
                    error,
                    judge_agreement_mean_abs,
                    synthesis_report_json,
                    synthesis_error,
                    meta_pipeline_json,
                    int(run_id),
                ),
            )

    def list_eval_runs_for_user(self, user_id: int, limit: int = 20) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM eval_runs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
                (int(user_id), max(1, limit)),
            ).fetchall()
        return [self._run_row_to_dict(r) for r in rows]

    def list_eval_runs_for_library(self, library_id: int, limit: int = 20) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM eval_runs
                WHERE prompt_a_library_id = ? OR prompt_b_library_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (int(library_id), int(library_id), max(1, limit)),
            ).fetchall()
        return [self._run_row_to_dict(r) for r in rows]

    def list_eval_runs_series(
        self,
        user_id: int,
        *,
        prompt_fingerprint: str,
        task_fingerprint: str,
        rubric_fingerprint: str,
        target_model_id: str | None = None,
        status: str = "completed",
        limit: int = 80,
    ) -> list[dict]:
        """Runs comparable on the same lineage key (C1/C2 trends)."""
        lim = max(1, min(200, int(limit)))
        with self._conn() as conn:
            if target_model_id:
                rows = conn.execute(
                    """
                    SELECT * FROM eval_runs
                    WHERE user_id = ? AND status = ?
                      AND prompt_fingerprint = ? AND task_fingerprint = ? AND rubric_fingerprint = ?
                      AND target_model_id = ?
                    ORDER BY created_at ASC, id ASC
                    LIMIT ?
                    """,
                    (
                        int(user_id),
                        status,
                        prompt_fingerprint,
                        task_fingerprint,
                        rubric_fingerprint,
                        target_model_id,
                        lim,
                    ),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM eval_runs
                    WHERE user_id = ? AND status = ?
                      AND prompt_fingerprint = ? AND task_fingerprint = ? AND rubric_fingerprint = ?
                    ORDER BY created_at ASC, id ASC
                    LIMIT ?
                    """,
                    (
                        int(user_id),
                        status,
                        prompt_fingerprint,
                        task_fingerprint,
                        rubric_fingerprint,
                        lim,
                    ),
                ).fetchall()
        return [self._run_row_to_dict(r) for r in rows]

    def backfill_eval_run_lineage(self, run_id: int) -> bool:
        """Compute and store fingerprints if missing. Returns True if row updated."""
        from services.eval.lineage import fingerprints_for_stored_run

        with self._conn() as conn:
            row = conn.execute("SELECT * FROM eval_runs WHERE id = ?", (int(run_id),)).fetchone()
            if not row:
                return False
            d = self._run_row_to_dict(row)
            if d.get("prompt_fingerprint") and d.get("task_fingerprint") and d.get("rubric_fingerprint"):
                return False
            pfp, tfp, rfp = fingerprints_for_stored_run(d)
            conn.execute(
                """
                UPDATE eval_runs
                SET prompt_fingerprint = ?, task_fingerprint = ?, rubric_fingerprint = ?
                WHERE id = ?
                """,
                (pfp, tfp, rfp, int(run_id)),
            )
            return True

    def delete_eval_run(self, run_id: int, *, user_id: int | None = None) -> bool:
        """Delete an eval run (results + judge scores cascade). Returns True on hit."""
        with self._conn() as conn:
            if user_id is None:
                cur = conn.execute("DELETE FROM eval_runs WHERE id = ?", (int(run_id),))
            else:
                cur = conn.execute(
                    "DELETE FROM eval_runs WHERE id = ? AND user_id = ?",
                    (int(run_id), int(user_id)),
                )
            return bool(cur.rowcount)

    def mark_running_runs_failed(self, reason: str = "server restart") -> int:
        """Mark all currently 'running' runs as failed. Used on server startup recovery."""
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE eval_runs
                SET status = 'failed',
                    error = COALESCE(error, ?),
                    finished_at = CURRENT_TIMESTAMP
                WHERE status = 'running'
                """,
                (reason,),
            )
            return int(cur.rowcount or 0)

    # ─── Eval Stability: results & judge scores ────────────────────────────

    def insert_eval_result(
        self,
        *,
        run_id: int,
        prompt_side: str,
        run_index: int,
        output_text: str,
        output_tokens: int,
        input_tokens: int,
        latency_ms: int | None,
        status: str,
        embedding: list[float] | None = None,
        judge_overall: float | None = None,
        judge_overall_secondary: float | None = None,
        judge_reasoning: str | None = None,
        judge_reasoning_secondary: str | None = None,
        parsed_as_json: bool = False,
        parsed_top_fields: dict | None = None,
        error: str | None = None,
    ) -> int:
        emb_blob = None
        if embedding is not None:
            emb_blob = json.dumps([float(x) for x in embedding]).encode("utf-8")
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO eval_results (
                    run_id, prompt_side, run_index,
                    output_text, output_tokens, input_tokens, latency_ms,
                    status, error, embedding_blob,
                    judge_overall, judge_overall_secondary, judge_reasoning,
                    judge_reasoning_secondary,
                    parsed_as_json, parsed_top_fields_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(run_id), prompt_side, int(run_index),
                    output_text, int(output_tokens), int(input_tokens), latency_ms,
                    status, error, emb_blob,
                    judge_overall, judge_overall_secondary, judge_reasoning,
                    judge_reasoning_secondary,
                    1 if parsed_as_json else 0,
                    json.dumps(parsed_top_fields, ensure_ascii=False) if parsed_top_fields else None,
                ),
            )
            return int(cur.lastrowid)  # type: ignore[return-value]

    @staticmethod
    def _result_row_to_dict(row) -> dict:
        d = dict(row)
        emb = d.pop("embedding_blob", None)
        if emb:
            try:
                d["embedding"] = json.loads(bytes(emb).decode("utf-8"))
            except Exception:
                d["embedding"] = None
        else:
            d["embedding"] = None
        ptf = d.pop("parsed_top_fields_json", None)
        try:
            d["parsed_top_fields"] = json.loads(ptf) if ptf else None
        except Exception:
            d["parsed_top_fields"] = None
        d["parsed_as_json"] = bool(d.get("parsed_as_json") or 0)
        return d

    def list_eval_results_for_run(self, run_id: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM eval_results
                WHERE run_id = ?
                ORDER BY prompt_side ASC, run_index ASC, id ASC
                """,
                (int(run_id),),
            ).fetchall()
        return [self._result_row_to_dict(r) for r in rows]

    def insert_judge_scores(self, result_id: int, scores: list[dict]) -> None:
        if not scores:
            return
        with self._conn() as conn:
            conn.executemany(
                """
                INSERT INTO eval_judge_scores (result_id, criterion_key, score, reasoning)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        int(result_id),
                        str(s["criterion_key"]),
                        float(s["score"]),
                        s.get("reasoning"),
                    )
                    for s in scores
                ],
            )

    def list_judge_scores_for_result(self, result_id: int) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM eval_judge_scores WHERE result_id = ? ORDER BY id ASC",
                (int(result_id),),
            ).fetchall()
        return [dict(r) for r in rows]

    # ─── Eval Stability: per-user daily usage ──────────────────────────────

    def get_eval_daily_usage(self, user_id: int, date_utc: str) -> float:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT dollars FROM eval_user_daily_usage WHERE user_id = ? AND date_utc = ?",
                (int(user_id), date_utc),
            ).fetchone()
        return float(row["dollars"]) if row else 0.0

    def add_eval_daily_usage(self, user_id: int, date_utc: str, dollars: float) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO eval_user_daily_usage (user_id, date_utc, dollars)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, date_utc) DO UPDATE SET
                    dollars = dollars + excluded.dollars
                """,
                (int(user_id), date_utc, float(dollars)),
            )

    def get_user_eval_budget(self, user_id: int) -> float:
        """Return the user's daily eval budget (USD)."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT eval_daily_budget_usd FROM users WHERE id = ?",
                (int(user_id),),
            ).fetchone()
        return float(row["eval_daily_budget_usd"]) if row else 0.0

    def update_user_eval_budget(self, user_id: int, dollars: float) -> None:
        """Set the user's daily eval budget (USD)."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE users SET eval_daily_budget_usd = ? WHERE id = ?",
                (float(dollars), int(user_id)),
            )

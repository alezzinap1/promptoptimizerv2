"""
Migrate data from SQLite to Postgres for Prompt Engineer.

Usage:
  python scripts/migrate_sqlite_to_postgres.py \
    --sqlite data/web_agent.db \
    --postgres "postgresql://user:pass@localhost:5432/prompt_engineer"
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

import psycopg


TABLES = [
    "users",
    "user_sessions",
    "prompt_sessions",
    "prompt_library",
    "app_events",
    "workspaces",
    "prompt_specs",
]


def _ensure_postgres_schema(pg_conn: psycopg.Connection) -> None:
    """Create target tables if they do not exist."""
    ddl = """
    CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS prompt_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        session_id TEXT NOT NULL,
        version BIGINT NOT NULL DEFAULT 1,
        task_input TEXT,
        task_types TEXT DEFAULT '[]',
        complexity TEXT DEFAULT 'medium',
        target_model TEXT DEFAULT 'unknown',
        gen_model TEXT,
        techniques_used TEXT DEFAULT '[]',
        reasoning TEXT,
        final_prompt TEXT,
        metrics TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS prompt_library (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        title TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        target_model TEXT DEFAULT 'unknown',
        task_type TEXT DEFAULT 'general',
        techniques TEXT DEFAULT '[]',
        prompt TEXT NOT NULL,
        rating BIGINT DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_events (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        session_id TEXT DEFAULT '',
        event_name TEXT NOT NULL,
        payload TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workspaces (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        config_json TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS prompt_specs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        session_id TEXT NOT NULL,
        workspace_id BIGINT,
        raw_input TEXT DEFAULT '',
        spec_json TEXT DEFAULT '{}',
        evidence_json TEXT DEFAULT '{}',
        issues_json TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    with pg_conn.cursor() as cur:
        cur.execute(ddl)
    pg_conn.commit()


def _copy_table(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection, table: str) -> int:
    """Copy one table with matching column names."""
    src_cur = sqlite_conn.execute(f"SELECT * FROM {table}")
    rows = src_cur.fetchall()
    if not rows:
        return 0
    col_names = [d[0] for d in src_cur.description]
    cols_csv = ", ".join(col_names)
    placeholders = ", ".join(["%s"] * len(col_names))
    insert_sql = f"INSERT INTO {table} ({cols_csv}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
    with pg_conn.cursor() as cur:
        for row in rows:
            cur.execute(insert_sql, tuple(row))
    pg_conn.commit()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate Prompt Engineer data SQLite -> Postgres")
    parser.add_argument("--sqlite", default="data/web_agent.db", help="Source SQLite file")
    parser.add_argument("--postgres", required=True, help="Target Postgres DSN")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite db not found: {sqlite_path}")

    with sqlite3.connect(str(sqlite_path)) as src, psycopg.connect(args.postgres) as dst:
        _ensure_postgres_schema(dst)
        total = 0
        for table in TABLES:
            copied = _copy_table(src, dst, table)
            total += copied
            print(f"{table}: {copied}")
        print(f"Total rows copied: {total}")


if __name__ == "__main__":
    main()

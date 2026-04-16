#!/usr/bin/env python3
"""Grant is_admin=1 to a user by username (SQLite DB from config)."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from db.manager import DBManager  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description="Set is_admin=1 for a user by username")
    p.add_argument("--username", required=True, help="Normalized username (lowercase)")
    args = p.parse_args()
    db_path = os.getenv("DB_PATH", str(ROOT / "data" / "web_agent.db"))
    db = DBManager(db_path=db_path)
    db.init()
    u = db.get_user_by_username(args.username)
    if not u:
        print(f"User not found: {args.username!r}", file=sys.stderr)
        sys.exit(1)
    uid = int(u["id"])
    with db._conn() as conn:  # noqa: SLF001
        conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (uid,))
    print(f"OK: user id={uid} username={u['username']!r} is_admin=1")


if __name__ == "__main__":
    main()

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
    p = argparse.ArgumentParser(description="Set is_admin=1 for one or more users by username")
    p.add_argument(
        "--username",
        action="append",
        dest="usernames",
        required=True,
        metavar="NAME",
        help="Username (repeat flag for several: --username a --username b)",
    )
    args = p.parse_args()
    db_path = os.getenv("DB_PATH", str(ROOT / "data" / "web_agent.db"))
    db = DBManager(db_path=db_path)
    db.init()
    failed = False
    for raw in args.usernames:
        name = (raw or "").strip().lower()
        if not name:
            continue
        u = db.get_user_by_username(name)
        if not u:
            print(f"User not found: {name!r}", file=sys.stderr)
            failed = True
            continue
        uid = int(u["id"])
        with db._conn() as conn:  # noqa: SLF001
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (uid,))
        print(f"OK: user id={uid} username={u['username']!r} is_admin=1")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

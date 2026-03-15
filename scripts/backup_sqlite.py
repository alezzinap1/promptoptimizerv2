"""
Create timestamped SQLite backup files.

Usage:
  python scripts/backup_sqlite.py --db data/web_agent.db --out backups
"""
from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


def run_backup(db_path: Path, out_dir: Path) -> Path:
    """Copy SQLite file to backups/<name>-YYYYmmdd-HHMMSS.db."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    target = out_dir / f"{db_path.stem}-{stamp}{db_path.suffix}"
    shutil.copy2(db_path, target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup SQLite database.")
    parser.add_argument("--db", default="data/web_agent.db", help="Path to SQLite db file")
    parser.add_argument("--out", default="backups", help="Output directory for backups")
    args = parser.parse_args()

    db = Path(args.db)
    if not db.exists():
        raise SystemExit(f"DB file not found: {db}")
    backup_file = run_backup(db, Path(args.out))
    print(f"Backup created: {backup_file}")


if __name__ == "__main__":
    main()

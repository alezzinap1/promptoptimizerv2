#!/usr/bin/env python3
"""
Сжать все PNG/WebP в frontend/public/image-styles до 256×256 (как generate_style_thumbnails).
Запуск из корня: python scripts/resize_existing_style_thumbnails.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.image_utils import resize_to_square_png, resize_to_square_webp

OUT_DIR = ROOT / "frontend" / "public" / "image-styles"


def main() -> int:
    n = 0
    for path in sorted(OUT_DIR.iterdir()):
        if path.suffix.lower() not in (".png", ".webp"):
            continue
        if path.name == "manifest.json":
            continue
        data = path.read_bytes()
        try:
            if path.suffix.lower() == ".webp":
                raw = resize_to_square_webp(data)
                path.write_bytes(raw)
            else:
                raw = resize_to_square_png(data)
                path.write_bytes(raw)
        except Exception as e:
            print(f"SKIP {path.name}: {e}", file=sys.stderr)
            continue
        print(f"OK {path.name} ({len(raw)} bytes)")
        n += 1
    print(f"Done. {n} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

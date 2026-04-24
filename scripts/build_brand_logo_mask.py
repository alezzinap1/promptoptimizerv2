"""
Собрать frontend/public/brand-logo-mask.png из исходника brand-logo-source.png
(оранжевый овал + белая «m» на белом фоне): непрозрачность только у оранжевого,
белый фон и буква — прозрачные → в UI заливается var(--primary), «m» — вырез.

Запуск из корня репозитория:
  python scripts/build_brand_logo_mask.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "public" / "brand-logo-source.png"
OUT = ROOT / "frontend" / "public" / "brand-logo-mask.png"


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Нет файла {SRC} — положите туда исходный PNG логотипа.")
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size
    px = img.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            white = (r + g + b) > 720
            orange = (not white) and r > 170 and 60 < g < 240 and b < 140 and (r - b) > 40
            warm = (not white) and r > 140 and g > 40 and b < 160 and r > g - 20 and r > b
            if orange or warm:
                op[x, y] = (255, 255, 255, 255)
            else:
                op[x, y] = (0, 0, 0, 0)
    bbox = out.split()[3].getbbox()
    if bbox:
        out = out.crop(bbox)
    out.save(OUT)
    print(f"OK → {OUT} ({out.size[0]}×{out.size[1]})")


if __name__ == "__main__":
    main()

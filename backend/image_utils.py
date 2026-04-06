"""Resize and encode images for thumbnails and uploads (memory-friendly)."""
from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageOps

THUMB_SIZE = 256


def resize_to_square_png(data: bytes, size: int = THUMB_SIZE) -> bytes:
    """Fit image into size×size (crop center), output PNG bytes."""
    im = Image.open(BytesIO(data))
    im = im.convert("RGBA")
    out = ImageOps.fit(im, (size, size), method=Image.Resampling.LANCZOS)
    buf = BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def resize_to_square_webp(data: bytes, size: int = THUMB_SIZE, quality: int = 82) -> bytes:
    """Fit image into size×size, output WebP bytes (smaller than PNG for uploads)."""
    im = Image.open(BytesIO(data))
    im = im.convert("RGBA")
    out = ImageOps.fit(im, (size, size), method=Image.Resampling.LANCZOS)
    buf = BytesIO()
    out.save(buf, format="WEBP", quality=quality, method=6)
    return buf.getvalue()


def resize_upload_for_community(data: bytes, size: int = THUMB_SIZE) -> tuple[bytes, str]:
    """256×256 для экономии памяти; предпочтительно WebP, иначе PNG."""
    try:
        return resize_to_square_webp(data, size=size), ".webp"
    except Exception:
        return resize_to_square_png(data, size=size), ".png"

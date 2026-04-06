#!/usr/bin/env python3
"""
Генерация превью стилей (40×) через OpenRouter: google/gemini-2.5-flash-image.
Параллельно до N запросов (по умолчанию 4) — пакеты по N с паузой --delay между пакетами.

Требуется в окружении:
  OPENROUTER_API_KEY

Запуск из корня репозитория:
  python scripts/generate_style_thumbnails.py

Опции:
  --dry-run          только показать промпты, без API
  --only ID          только один id (например photography)
  --workers N        параллельных запросов за пакет (по умолчанию 4)
  --delay SEC        пауза между пакетами (по умолчанию 1.0)
  --skip-existing    не перезаписывать уже существующие PNG

Выход:
  frontend/public/image-styles/{id}.png
  frontend/public/image-styles/manifest.json
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "scripts" / "image_styles_thumbnail_seed.json"
OUT_DIR = ROOT / "frontend" / "public" / "image-styles"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-2.5-flash-image"

# Сцена-фон: узнаваемая тематика, глубина, свет (не нейтральная серая студия)
THEMATIC_BACKGROUNDS: dict[str, str] = {
    "photography": (
        "A believable commercial photo set: large softboxes or strip boxes as visible practicals, subtle "
        "seamless sweep with gentle tonal falloff, shallow depth of field, creamy circular bokeh, neutral "
        "but not lifeless color balance, realistic contact shadows and bounced fill—reads as premium product "
        "or editorial still life, not an empty gray void."
    ),
    "teal_orange": (
        "A widescreen cinematic exterior: coastal highway or skyline silhouette at blue hour transitioning to "
        "warm sodium or sunset rim, atmospheric perspective haze, anamorphic flare hints, teal-shadowed "
        "concrete against orange skin-of-the-architecture highlights—color grade is the subject matter."
    ),
    "glass": (
        "A prismatic light laboratory: caustic fans crossing matte surfaces, crystal shards or glass blocks "
        "in midground, cool cyan-to-lavender volumetric light, specular sparkle without clutter—space feels "
        "optical, refractive, and high-tech clean."
    ),
    "dreamcore": (
        "A soft liminal environment: empty pastel corridor or floating garden paths, gentle bloom, "
        "low-contrast fog, slightly wrong-but-calm perspective, nostalgic VHS-adjacent grain optional—"
        "comforting unease, no horror."
    ),
    "knit_fabric": (
        "A craft atelier table: wooden surface, yarn cakes, knitting needles, warm tungsten sidelight raking "
        "across wool texture, shallow DOF into shelves of skeins—cozy domestic scale and handmade authenticity."
    ),
    "retro_film": (
        "A 1970s–90s memory location: sun-faded diner booth or suburban street, period props, mild lens "
        "distortion, halation on chrome, subtle gate weave—palette slightly desaturated with warm lift in "
        "midtone memory colors."
    ),
    "wool_felt_style": (
        "A stop-motion felt diorama: rolled hills and trees as layered felt sheets, needle-felting tools, "
        "soft macro photography lighting, miniature scale clarity—tactile and handmade, Wes-craft without "
        "copying specific IP."
    ),
    "macaron_color": (
        "A patisserie color story: blush pink, pistachio, lemon, and lavender planes with airy negative space, "
        "soft global illumination, sugar-dust sparkle—sweet but refined, never neon."
    ),
    "plaster": (
        "A sculptor's studio or museum alcove: unfinished plaster busts, marble dust in light beams, "
        "Renaissance window light with deep soft shadows—timeless European art-historical atmosphere."
    ),
    "plush_texture": (
        "A child's reading nook or toy corner: stacked plush, warm bedside lamp, shallow depth, velvety "
        "occlusion—inviting, soft, domestic."
    ),
    "cartoon_c4d": (
        "A playful CG exterior: candy gradients in sky, balloon-like clouds, rolling green hills, clean sun "
        "disc, bounce light color bleed—Saturday-morning optimism with crisp air perspective."
    ),
    "cg_rendering": (
        "A premium productviz stage: neutral HDRI with crisp reflections, subtle floor contact shadow, "
        "minimal props suggesting high-end tech or automotive hero lighting—benchmark CGI clarity."
    ),
    "steampunk": (
        "A brass-clad workshop interior: pressure gauges, vented pipes, coiled springs, steam wisps backlit, "
        "copper warmth against sooty shadows—dense but readable industrial romance."
    ),
    "pixel_art": (
        "A retro platformer parallax: tiled sky gradient, pixel-cloud layers, distant mountain silhouette, "
        "16-color discipline—authentic low-res game world continuation behind the title."
    ),
    "ghibli": (
        "A pastoral anime countryside: cumulus stacks, rice-field or meadow path, distant village roofs, "
        "gentle afternoon sun with soft green-yellow warmth—peaceful, hand-painted, wind-swept."
    ),
    "anime_cartoon": (
        "A dramatic anime skyscape: bold cloud sculpting, city silhouette or sakura park foreground, "
        "speed-line energy in background layers, saturated twilight gradient—TV production polish."
    ),
    "impasto_oil": (
        "A painter's garret: stacked canvases, palette knives, pigment jars, north-light window with "
        "dusty beams—thick paint culture surrounding the letters."
    ),
    "monet": (
        "A Giverny-inspired garden bridge: shimmering lily pond, broken reflections, pollen-soft light, "
        "plein-air haze—impressionist color vibration in environment."
    ),
    "dunhuang_murals": (
        "A Mogao cave chamber: mineral red and green pigments, gold leaf halos, flying ribbon patterns, "
        "weathered plaster cracks, low tungsten conservation lighting—sacred mural depth."
    ),
    "design_draft": (
        "An architect's daylight studio: tilted drafting board, parallel bar, trace layers, scale figures, "
        "calm cool window fill—precision and calm focus."
    ),
    "watercolor_painting": (
        "A botanical wash environment: wet paper texture in sky, loose leaf shapes bleeding at edges, "
        "granulating pigment pools—airy traditional media space."
    ),
    "cyberpunk": (
        "A rainy neo-Tokyo or generic megacity alley: stacked kanji-free signage shapes, holographic strips, "
        "puddle reflections, volumetric smog, cyan-magenta split—no readable fake text in background."
    ),
    "pencil_sketch": (
        "A draftsman's still-life corner: crumpled paper, wood grain desk, single desk lamp, graphite dust, "
        "eraser crumbs—observational academic mood."
    ),
    "chinese_ink_wash": (
        "A shan shui mist sequence: layered ink ridges dissolving into void, pine punctuation marks, distant "
        "fishing boat dot—breathing negative space."
    ),
    "surrealism": (
        "A desert horizon with impossible scale: levitating rocks or soft clocks as abstract shapes, long "
        "shadows, painterly sky gradient—dream logic without trademarked imagery."
    ),
    "art_nouveau": (
        "A Paris metro or boutique interior suggestion: curling iron florals, stained-glass color patches, "
        "asymmetrical elegance, brass and enamel gleam—organic jewelry architecture."
    ),
    "baroque_painting": (
        "A candlelit palace antechamber: velvet drapes, gilded stucco, deep chiaroscuro, single window "
        "knife of light—Caravaggio-adjacent drama."
    ),
    "gothic": (
        "A moonlit cathedral silhouette: flying buttresses in fog, wrought iron fence, wet cobblestones, "
        "violet night sky—romantic melancholy, not gore."
    ),
    "minimalist": (
        "A designed architectural void: one plane of warm plaster, one sculptural object or shadow line, "
        "single accent color block—intentional emptiness with real spatial photography."
    ),
    "abstract_expressionism": (
        "A Pollock-adjacent arena: large canvas floor, energetic drips frozen mid-air suggestion, raw "
        "canvas tooth—mid-century New York studio energy."
    ),
    "ukiyo_e": (
        "An Edo harbor or wave composition space: flat color bands, stylized crest foam, distant Fuji cone, "
        "woodgrain print texture—strong silhouette design."
    ),
    "vector_flat_illustration": (
        "A contemporary editorial landscape: geometric sun, two-tone hills, simple tree icons, long-shadow "
        "ground—SaaS marketing illustration clarity."
    ),
    "low_poly": (
        "A stylized outdoor low-poly: faceted mountains, gradient sky triangulation, sharp shadow polygons, "
        "crystalline atmosphere—game art environment kit."
    ),
    "papercut_art": (
        "A paper theater depth: stacked pastel sheets with gap shadows, craft knife and ruler on desk, "
        "directional LED raking—tangible paper storytelling."
    ),
    "embroidery_texture": (
        "A textile studio: embroidery hoop, thread spools, linen weave macro, soft daylight—needlecraft "
        "culture as environment."
    ),
    "blueprint_sketch": (
        "An engineer's vault table: cyanotype rolls, parallel rulers, calipers, cool fluorescent top light—"
        "technical authority."
    ),
    "film_noir": (
        "A 1940s urban night exterior: venetian blind shadow stripes across stucco, wet asphalt sheen, "
        "single streetlamp pool, fog rolling low—high-contrast silver print."
    ),
    "vintage_polaroid": (
        "A sun-bleached beach or birthday table memory: SX-70 frame suggestion, warm shift, crushed blacks "
        "lifted, uneven development—intimate snapshot nostalgia."
    ),
    "pixar_3d_animation": (
        "A suburban storybook street or family kitchen: rounded props, warm bounce, soft global illumination, "
        "appealing scale—feature animation sincerity."
    ),
    "comic_book_style": (
        "A four-color metropolis rooftop: halftone sky treatment, dynamic perspective grid, energy burst "
        "shapes, spotted blacks—Silver Age heroic readability."
    ),
}

PROMPT_TEMPLATE = (
    "Role: You are an elite key-art director creating a square 1:1 library thumbnail for a professional AI "
    "image-style catalog.\n\n"
    "COMPOSITION: Center-weighted hero. Single clear focal read at small UI size. No clutter at the edges.\n\n"
    "BACKGROUND — mandatory: Avoid flat neutral gray, empty white infinity, or a plain cyclorama with no story. "
    "Instead, build a cohesive thematic environment with depth cues (foreground/midground/background), "
    "supporting props or landscape, and lighting that sells the genre. Scene brief:\n"
    "{thematic_bg}\n\n"
    "TYPOGRAPHY — hero subject: Large stacked wordmark reading exactly \"METAPROMPT\" with \"META\" on the "
    "first line and \"PROMPT\" on the second line. Letters must remain highly legible at thumbnail scale, "
    "with consistent baseline and kerning intent. Integrate typography into the scene lighting (shadows, "
    "reflections, atmospheric occlusion) — never a flat pasted overlay.\n\n"
    "STYLE LOCK for letter materials and rendering (apply strictly):\n"
    "{style_full}\n"
    "{adaptation}\n\n"
    "QUALITY BAR: Commercial catalog sharpness, controlled noise, no banding, no watermark, no logos, no "
    "extra readable text besides METAPROMPT, no gibberish signage. Cohesive color science across subject "
    "and environment."
)


def thematic_background(row: dict) -> str:
    sid = row["id"]
    label = row.get("label", sid)
    return THEMATIC_BACKGROUNDS.get(
        sid,
        f"A rich, genre-authentic environment for «{label}»: clear depth, motivated light, and recognizable "
        f"mood—never a plain gray backdrop.",
    )


def style_full_text(label: str) -> str:
    return (
        f"Global aesthetic anchor: authentic «{label}» treatment across materials, lighting model, "
        f"palette discipline, and atmosphere. Letter-specific execution:"
    )


def build_prompt(row: dict) -> str:
    return PROMPT_TEMPLATE.format(
        thematic_bg=thematic_background(row),
        style_full=style_full_text(row["label"]),
        adaptation=row["adaptation"].strip(),
    )


def extract_image_bytes(data: dict) -> tuple[bytes, str]:
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"No choices in response: {data}")
    msg = (choices[0].get("message") or {})
    images = msg.get("images")
    if not images:
        err = data.get("error")
        raise RuntimeError(f"No images in message. error={err} content={msg.get('content')!r}")

    first = images[0]
    url = None
    if isinstance(first, dict):
        url = (first.get("image_url") or first.get("imageUrl") or {}).get("url")
        if not url and "url" in first:
            url = first["url"]
    if not url or not isinstance(url, str):
        raise RuntimeError(f"Unexpected image entry: {first!r}")

    m = re.match(r"data:image/(png|jpeg|jpg|webp);base64,(.+)", url, re.DOTALL)
    if not m:
        raise RuntimeError(f"Unexpected image data URL prefix: {url[:80]}...")
    ext = m.group(1)
    if ext == "jpeg":
        ext = "jpg"
    raw = base64.b64decode(m.group(2))
    return raw, ext


def run_one(client: httpx.Client, api_key: str, prompt: str, sid: str) -> dict:
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": "1:1"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/prompt-engineer-agent",
        "X-Title": "metaprompt-style-thumbnails",
    }
    print(f"  [{sid}] POST OpenRouter …", flush=True)
    r = client.post(OPENROUTER_URL, json=payload, headers=headers, timeout=180.0)
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:2000]}")
    return r.json()


def process_one(
    client: httpx.Client,
    api_key: str,
    row: dict,
    idx: int,
    total: int,
    skip_existing: bool,
) -> tuple[str, dict | None, str | None]:
    """Returns (status, manifest_entry_or_none, error). status: ok | skip | err"""
    sid = row["id"]
    out_path = OUT_DIR / f"{sid}.png"

    if skip_existing and out_path.is_file():
        print(f"[{idx}/{total}] skip existing {sid}", flush=True)
        return (
            "skip",
            {
                "id": sid,
                "label": row["label"],
                "file": f"/image-styles/{sid}.png",
                "adaptation": row["adaptation"],
            },
            None,
        )

    print(f"[{idx}/{total}] generating {sid} …", flush=True)
    try:
        data = run_one(client, api_key, build_prompt(row), sid)
        raw, ext = extract_image_bytes(data)
        if ext != "png":
            out_path = OUT_DIR / f"{sid}.{ext}"
        else:
            out_path = OUT_DIR / f"{sid}.png"
        out_path.write_bytes(raw)
        print(f"  -> {out_path.relative_to(ROOT)} ({len(raw)} bytes)", flush=True)
        return (
            "ok",
            {
                "id": sid,
                "label": row["label"],
                "file": f"/image-styles/{out_path.name}",
                "adaptation": row["adaptation"],
            },
            None,
        )
    except Exception as e:
        print(f"  FAILED {sid}: {e}", file=sys.stderr, flush=True)
        return "err", None, str(e)


def main() -> int:
    print("generate_style_thumbnails.py: старт", flush=True)

    load_dotenv(ROOT / ".env")
    import os

    api_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    parser = argparse.ArgumentParser(description="Generate METAPROMPT style thumbnails via OpenRouter")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts only")
    parser.add_argument("--only", metavar="ID", default="", help="Single style id")
    parser.add_argument("--workers", type=int, default=4, help="Parallel requests per batch (default 4)")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between batches (default 1.0)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip if PNG exists")
    args = parser.parse_args()

    workers = max(1, args.workers)

    if not args.dry_run and not api_key:
        print("OPENROUTER_API_KEY is not set.", file=sys.stderr)
        return 1

    styles: list[dict] = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    if args.only:
        styles = [s for s in styles if s["id"] == args.only]
        if not styles:
            print(f"Unknown id: {args.only}", file=sys.stderr)
            return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not args.dry_run:
        print("", flush=True)
        print(f"=== Генерация: {MODEL} | пакеты по {workers} | пауза {args.delay}s между пакетами ===", flush=True)
        print(f"    Файлов: {len(styles)}  →  {OUT_DIR}", flush=True)
        print("", flush=True)

    manifest: list[dict] = []
    if args.dry_run:
        for row in styles:
            p = build_prompt(row)
            print(f"=== {row['id']} ===\n{p}\n")
        return 0

    ok = 0
    with httpx.Client() as client:
        for batch_start in range(0, len(styles), workers):
            batch = styles[batch_start : batch_start + workers]
            futures = []
            with ThreadPoolExecutor(max_workers=len(batch)) as ex:
                for k, row in enumerate(batch):
                    idx = batch_start + k + 1
                    futures.append(
                        ex.submit(process_one, client, api_key, row, idx, len(styles), args.skip_existing)
                    )
                for fut in futures:
                    status, entry, _ = fut.result()
                    if status in ("ok", "skip") and entry:
                        manifest.append(entry)
                        ok += 1

            if batch_start + len(batch) < len(styles) and args.delay > 0:
                time.sleep(args.delay)

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. {ok}/{len(styles)} entries. Manifest: {manifest_path.relative_to(ROOT)}")
    return 0 if ok == len(styles) else 2


if __name__ == "__main__":
    raise SystemExit(main())

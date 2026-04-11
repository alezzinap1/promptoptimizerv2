"""
Prompt Engineer — FastAPI backend.
API for prompt generation (streaming), library, techniques.

API собрано в отдельном под-приложении и смонтировано на /api, чтобы catch-all SPA
(/{path:path} → index.html) никогда не перехватывал запросы к /api/*.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
FRONTEND_DIST = ROOT / "frontend" / "dist"

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

from backend.api import (
    agent_route,
    auth,
    community,
    compare,
    config,
    generate,
    preview_edit,
    image_meta,
    library,
    metrics,
    models,
    playground,
    presets,
    prompt_ide,
    sessions,
    settings,
    simple_improve,
    skills,
    techniques,
    tokenizer,
    user_info,
    workspaces,
)

api_app = FastAPI(
    title="Prompt Engineer API",
    description="Professional prompt engineering tool",
    version="1.0.0",
)

api_app.include_router(config.router, tags=["config"])
api_app.include_router(auth.router, tags=["auth"])
api_app.include_router(settings.router, tags=["settings"])
api_app.include_router(user_info.router, tags=["user-info"])
api_app.include_router(models.router, tags=["models"])
api_app.include_router(playground.router, tags=["playground"])
api_app.include_router(workspaces.router, tags=["workspaces"])
api_app.include_router(presets.router, tags=["presets"])
api_app.include_router(metrics.router, tags=["metrics"])
api_app.include_router(sessions.router, tags=["sessions"])
api_app.include_router(prompt_ide.router, tags=["prompt-ide"])
api_app.include_router(agent_route.router, tags=["agent"])
api_app.include_router(generate.router, tags=["generate"])
api_app.include_router(preview_edit.router, tags=["generate"])
api_app.include_router(simple_improve.router, tags=["simple-improve"])
api_app.include_router(compare.router, tags=["compare"])
api_app.include_router(library.router, tags=["library"])
api_app.include_router(community.router, tags=["community"])
api_app.include_router(skills.router, tags=["skills"])
api_app.include_router(techniques.router, tags=["techniques"])
api_app.include_router(tokenizer.router, tags=["tokenizer"])
api_app.include_router(image_meta.router, tags=["meta"])


@api_app.get("/health")
def health():
    return {"status": "ok"}


app = FastAPI(
    title="Prompt Engineer",
    description="MetaPrompt — UI + mounted API at /api",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
# Узкий mount — должен быть раньше общего /api, иначе uploads уйдут в api_app и дадут 404.
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.mount("/api", api_app)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def serve_spa(path: str):
        file_path = FRONTEND_DIST / path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")

"""
Prompt Engineer — FastAPI backend.
API for prompt generation (streaming), library, techniques.
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
    auth,
    compare,
    config,
    generate,
    library,
    metrics,
    models,
    prompt_ide,
    sessions,
    settings,
    simple_improve,
    techniques,
    user_info,
    workspaces,
)

app = FastAPI(
    title="Prompt Engineer API",
    description="Professional prompt engineering tool",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config.router, prefix="/api", tags=["config"])
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(user_info.router, prefix="/api", tags=["user-info"])
app.include_router(models.router, prefix="/api", tags=["models"])
app.include_router(workspaces.router, prefix="/api", tags=["workspaces"])
app.include_router(metrics.router, prefix="/api", tags=["metrics"])
app.include_router(sessions.router, prefix="/api", tags=["sessions"])
app.include_router(prompt_ide.router, prefix="/api", tags=["prompt-ide"])
app.include_router(generate.router, prefix="/api", tags=["generate"])
app.include_router(simple_improve.router, prefix="/api", tags=["simple-improve"])
app.include_router(compare.router, prefix="/api", tags=["compare"])
app.include_router(library.router, prefix="/api", tags=["library"])
app.include_router(techniques.router, prefix="/api", tags=["techniques"])


@app.get("/api/health")
def health():
    return {"status": "ok"}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def serve_spa(path: str):
        file_path = FRONTEND_DIST / path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")

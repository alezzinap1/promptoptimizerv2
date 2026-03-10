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

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from backend.api import generate, library, techniques, config, compare

app = FastAPI(
    title="Prompt Engineer API",
    description="Professional prompt engineering tool",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config.router, prefix="/api", tags=["config"])
app.include_router(generate.router, prefix="/api", tags=["generate"])
app.include_router(compare.router, prefix="/api", tags=["compare"])
app.include_router(library.router, prefix="/api", tags=["library"])
app.include_router(techniques.router, prefix="/api", tags=["techniques"])


@app.get("/api/health")
def health():
    return {"status": "ok"}

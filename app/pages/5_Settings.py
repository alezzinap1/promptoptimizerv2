"""
Настройки — тема, шрифт и другие параметры оформления.
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.shared_styles import render_theme_controls

st.title("Настройки")

st.subheader("Оформление")
render_theme_controls()

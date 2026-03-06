"""
Prompt Engineer — Web App Entrypoint
Top navigation (header), shared styles, page router.

Run: streamlit run app/main.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.shared_styles import inject_styles

st.set_page_config(
    page_title="Prompt Engineer",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={"About": "Professional prompt engineering tool"},
)

inject_styles()

# Сначала регистрируем страницы
pages = [
    st.Page("Home.py", title="Home"),
    st.Page("pages/2_Compare.py", title="Сравнение"),
    st.Page("pages/3_Library.py", title="Библиотека"),
    st.Page("pages/4_Techniques.py", title="Техники"),
    st.Page("pages/5_Settings.py", title="Настройки"),
]
pg = st.navigation(pages, position="hidden")

# Навигация НАД контентом страницы
nav_cols = st.columns(6)
with nav_cols[0]:
    st.page_link("Home.py", label="Home")
with nav_cols[1]:
    st.page_link("pages/2_Compare.py", label="Сравнение")
with nav_cols[2]:
    st.page_link("pages/3_Library.py", label="Библиотека")
with nav_cols[3]:
    st.page_link("pages/4_Techniques.py", label="Техники")
with nav_cols[4]:
    st.page_link("pages/5_Settings.py", label="Настройки")
with nav_cols[5]:
    pass
st.divider()

pg.run()

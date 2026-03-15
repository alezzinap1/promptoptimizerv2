"""
Prompt Engineer — Web App Entrypoint
Registers pages, applies shared styles, runs the router.

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

# Config and observability (Phase 1)
from app.config import APP_ENV, DB_PATH
from app.logging_config import setup_logging

setup_logging()

from app.config import SENTRY_DSN
from app.auth import require_auth, render_user_menu
from db.manager import DBManager

if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=APP_ENV,
        traces_sample_rate=0.1,
    )

from app.shared_styles import inject_styles, _render_theme_select, _render_font_select
from app.user_prefs import load_prefs
from app.nav import NAV_ITEMS


@st.cache_resource
def load_db() -> DBManager:
    db = DBManager(db_path=DB_PATH)
    db.init()
    return db

st.set_page_config(
    page_title="Prompt Engineer",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="collapsed",
    menu_items={"About": "Professional prompt engineering tool"},
)

db = load_db()
current_user = require_auth(db)

pages = [
    st.Page("Home.py", title="Home"),
    st.Page("pages/2_Compare.py", title="Сравнение"),
    st.Page("pages/3_Library.py", title="Библиотека"),
    st.Page("pages/4_Techniques.py", title="Техники"),
    st.Page("pages/5_Metrics.py", title="Метрики"),
    st.Page("pages/6_Workspaces.py", title="Workspaces"),
]
pg = st.navigation(pages, position="hidden")
inject_styles()

# Nav in entrypoint — always rendered, theme/font survive navigation (Streamlit docs)
prefs = load_prefs()
st.session_state.setdefault("sb_theme", prefs["theme"])
st.session_state.setdefault("sb_font", prefs["font"])
st.session_state.setdefault("session_id", str(__import__("uuid").uuid4()))
st.session_state.setdefault("generation_count", 0)
st.session_state.setdefault("auth_user_id", int(current_user["id"]))
st.session_state.setdefault("auth_username", str(current_user["username"]))
url_path = getattr(pg, "url_path", "") or ""
url_to_current = {
    "": "Home.py", "2_Compare": "2_Compare.py", "Compare": "2_Compare.py",
    "3_Library": "3_Library.py", "Library": "3_Library.py",
    "4_Techniques": "4_Techniques.py", "Techniques": "4_Techniques.py",
    "5_Metrics": "5_Metrics.py", "Metrics": "5_Metrics.py",
    "6_Workspaces": "6_Workspaces.py", "Workspaces": "6_Workspaces.py",
}
current = url_to_current.get(url_path, "Home.py")
cols = st.columns([1, 1, 1, 1, 1, 1, 2, 1, 1])
for i, (label, page) in enumerate(NAV_ITEMS):
    is_active = page.endswith(current)
    with cols[i]:
        if is_active:
            st.markdown(f'<p class="nav-item-active">{label}</p>', unsafe_allow_html=True)
        else:
            st.page_link(page, label=label, use_container_width=True)
with cols[7]:
    _render_theme_select()
with cols[8]:
    _render_font_select()
st.markdown('<hr class="nav-divider" />', unsafe_allow_html=True)
render_user_menu(db)

pg.run()

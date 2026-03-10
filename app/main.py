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

from app.shared_styles import inject_styles, _render_theme_select, _render_font_select
from app.user_prefs import load_prefs
from app.nav import NAV_ITEMS

st.set_page_config(
    page_title="Prompt Engineer",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="collapsed",
    menu_items={"About": "Professional prompt engineering tool"},
)

pages = [
    st.Page("Home.py", title="Home"),
    st.Page("pages/2_Compare.py", title="Сравнение"),
    st.Page("pages/3_Library.py", title="Библиотека"),
    st.Page("pages/4_Techniques.py", title="Техники"),
]
pg = st.navigation(pages, position="hidden")
inject_styles()

# Nav in entrypoint — always rendered, theme/font survive navigation (Streamlit docs)
prefs = load_prefs()
st.session_state.setdefault("sb_theme", prefs["theme"])
st.session_state.setdefault("sb_font", prefs["font"])
url_path = getattr(pg, "url_path", "") or ""
url_to_current = {
    "": "Home.py", "2_Compare": "2_Compare.py", "Compare": "2_Compare.py",
    "3_Library": "3_Library.py", "Library": "3_Library.py",
    "4_Techniques": "4_Techniques.py", "Techniques": "4_Techniques.py",
}
current = url_to_current.get(url_path, "Home.py")
cols = st.columns([1, 1, 1, 1, 2, 1, 1])
for i, (label, page) in enumerate(NAV_ITEMS):
    is_active = page.endswith(current)
    with cols[i]:
        if is_active:
            st.markdown(f'<p class="nav-item-active">{label}</p>', unsafe_allow_html=True)
        else:
            st.page_link(page, label=label, use_container_width=True)
with cols[5]:
    _render_theme_select()
with cols[6]:
    _render_font_select()
st.markdown('<hr class="nav-divider" />', unsafe_allow_html=True)

pg.run()

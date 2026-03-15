"""
Shared top navigation bar component.
Call render_nav(current) as the first thing in every page's main content area.
Includes theme + font selectors on the right (persistent across pages).
"""
from __future__ import annotations

import streamlit as st

from app.shared_styles import _render_theme_select, _render_font_select
from app.user_prefs import load_prefs

NAV_ITEMS: list[tuple[str, str]] = [
    ("Home",       "Home.py"),
    ("Сравнение",  "pages/2_Compare.py"),
    ("Библиотека", "pages/3_Library.py"),
    ("Техники",    "pages/4_Techniques.py"),
    ("Метрики",    "pages/5_Metrics.py"),
]


def render_nav(current: str = "") -> None:
    """
    Render a horizontal navigation bar in the main content area.
    Nav links on the left, theme + font selectors on the right.

    Args:
        current: filename of the active page, e.g. "Home.py" or "2_Compare.py"
    """
    prefs = load_prefs()
    # Persistent keys — Streamlit does not clear them on page switch
    if "_prefs_theme" not in st.session_state:
        st.session_state["_prefs_theme"] = prefs["theme"]
    if "_prefs_font" not in st.session_state:
        st.session_state["_prefs_font"] = prefs["font"]
    # Restore widget keys only when missing (after navigation)
    st.session_state.setdefault("sb_theme", st.session_state["_prefs_theme"])
    st.session_state.setdefault("sb_font", st.session_state["_prefs_font"])

    cols = st.columns([1, 1, 1, 1, 1, 2, 1, 1])
    for i, (label, page) in enumerate(NAV_ITEMS):
        is_active = page.endswith(current)
        with cols[i]:
            if is_active:
                st.markdown(
                    f'<p class="nav-item-active">{label}</p>',
                    unsafe_allow_html=True,
                )
            else:
                st.page_link(page, label=label, use_container_width=True)
    with cols[6]:
        _render_theme_select()
    with cols[7]:
        _render_font_select()
    st.markdown('<hr class="nav-divider" />', unsafe_allow_html=True)

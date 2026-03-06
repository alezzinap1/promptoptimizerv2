"""
Shared theme palettes and font config for all app pages.
Uses CSS custom properties override to fix themes on all pages.
"""
from __future__ import annotations

import streamlit as st

# ── Theme palettes ────────────────────────────────────────────────────────────
THEMES = {
    "slate": {
        "label": "Slate",
        "bg": "#0f172a",
        "secondary": "#1e293b",
        "text": "#f1f5f9",
        "primary": "#6366f1",
        "accent": "#22d3ee",
    },
    "midnight": {
        "label": "Midnight",
        "bg": "#0a0a0f",
        "secondary": "#14141c",
        "text": "#e4e4e7",
        "primary": "#818cf8",
        "accent": "#38bdf8",
    },
    "forest": {
        "label": "Forest",
        "bg": "#0d1117",
        "secondary": "#161b22",
        "text": "#c9d1d9",
        "primary": "#3fb950",
        "accent": "#58a6ff",
    },
    "amber": {
        "label": "Amber",
        "bg": "#1c1917",
        "secondary": "#292524",
        "text": "#faf5f0",
        "primary": "#ea580c",
        "accent": "#f59e0b",
    },
    "ocean": {
        "label": "Ocean",
        "bg": "#0c1929",
        "secondary": "#132f4c",
        "text": "#e3f2fd",
        "primary": "#2196f3",
        "accent": "#00bcd4",
    },
    "light": {
        "label": "Light",
        "bg": "#f8fafc",
        "secondary": "#e2e8f0",
        "text": "#0f172a",
        "primary": "#4f46e5",
        "accent": "#0891b2",
    },
}

# ── IT design fonts ───────────────────────────────────────────────────────────
FONTS = {
    "inter": {
        "label": "Inter",
        "family": "Inter, system-ui, sans-serif",
        "url": "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    },
    "ibmplex": {
        "label": "IBM Plex Sans",
        "family": "'IBM Plex Sans', system-ui, sans-serif",
        "url": "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
    },
    "plusjakarta": {
        "label": "Plus Jakarta Sans",
        "family": "'Plus Jakarta Sans', system-ui, sans-serif",
        "url": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
    },
    "spacegrotesk": {
        "label": "Space Grotesk",
        "family": "'Space Grotesk', system-ui, sans-serif",
        "url": "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap",
    },
    "manrope": {
        "label": "Manrope",
        "family": "'Manrope', system-ui, sans-serif",
        "url": "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap",
    },
    "outfit": {
        "label": "Outfit",
        "family": "'Outfit', system-ui, sans-serif",
        "url": "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap",
    },
    "jetbrains": {
        "label": "JetBrains Mono",
        "family": "'JetBrains Mono', monospace",
        "url": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap",
    },
    "firacode": {
        "label": "Fira Code",
        "family": "'Fira Code', monospace",
        "url": "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&display=swap",
    },
}


def get_theme_css(theme_id: str, font_id: str) -> str:
    t = THEMES.get(theme_id, THEMES["slate"])
    f = FONTS.get(font_id, FONTS["jetbrains"])
    ff = f["family"]
    font_import = f"@import url('{f['url']}');\n" if font_id != "jetbrains" else ""
    return f"""
{font_import}
/* Override Streamlit CSS custom properties — fixes theme on ALL pages */
:root {{
    --primary-color: {t['primary']} !important;
    --background-color: {t['bg']} !important;
    --secondary-background-color: {t['secondary']} !important;
    --text-color: {t['text']} !important;
}}

/* Background — high specificity to override Streamlit */
[data-testid="stAppViewContainer"],
[data-testid="stAppViewContainer"] > div,
[data-testid="stMain"],
[data-testid="stMain"] > div,
section.main,
section.main > div {{
    background-color: {t['bg']} !important;
}}
[data-testid="stSidebar"],
[data-testid="stSidebar"] > div:first-child,
[data-testid="stSidebar"] [data-testid="stMarkdown"] {{
    background-color: {t['secondary']} !important;
}}

/* Font */
html, body, [data-testid="stAppViewContainer"],
[data-testid="stSidebar"], p, label,
.stMarkdown, button, input, textarea, select {{
    font-family: {ff} !important;
}}
/* Не трогаем иконочный шрифт Streamlit */
.material-symbols-rounded,
[data-testid="stPageLink"] span[data-testid="stIconMaterial"],
span.material-symbols-rounded {{
    font-family: 'Material Symbols Rounded' !important;
}}
p, span, label, .stMarkdown {{ font-size: 16px !important; }}
.stTextArea textarea {{ font-size: 15px !important; }}
h1 {{ font-size: 2rem !important; }}
h2 {{ font-size: 1.5rem !important; }}
div[data-testid="stMetricValue"] {{ font-size: 1.15rem !important; }}

/* Fix _arrow_right text artifact in expanders */
details > summary > span:first-child {{
    display: none !important;
}}
details > summary::before {{
    content: "▸";
    font-size: 1rem;
    margin-right: 8px;
    display: inline-block;
    transition: transform 0.15s ease;
    font-family: system-ui, sans-serif !important;
}}
details[open] > summary::before {{
    content: "▾";
}}

/* Metric colors */
.metric-good {{ color: #22c55e; font-weight: 600; }}
.metric-warn {{ color: #f59e0b; font-weight: 600; }}
.metric-bad  {{ color: #ef4444; font-weight: 600; }}

/* Empty state placeholder */
.empty-state {{
    padding: 40px 20px;
    text-align: center;
    border-radius: 8px;
    border: 2px dashed {t['primary']};
    color: {t['text']};
    opacity: 0.8;
}}

/* Cards: shadows, rounded corners, hover */
[data-testid="stVerticalBlockBorderWrapper"] {{
    border-radius: 12px !important;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2), 0 2px 4px -2px rgba(0,0,0,0.1) !important;
    transition: box-shadow 0.2s ease, transform 0.2s ease !important;
}}
[data-testid="stVerticalBlockBorderWrapper"]:hover {{
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.25), 0 4px 6px -4px rgba(0,0,0,0.15) !important;
}}

/* Primary buttons: accent */
.stButton > button[kind="primary"] {{
    border-radius: 8px !important;
    font-weight: 600 !important;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
}}

/* Sidebar: subtle separation */
[data-testid="stSidebar"] {{
    border-right: 1px solid rgba(255,255,255,0.06) !important;
}}

/* Header / top nav */
[data-testid="stHeader"] {{
    background: {t['secondary']} !important;
    border-bottom: 1px solid rgba(255,255,255,0.08) !important;
}}
"""


def inject_styles(theme_key: str = "sb_theme", font_key: str = "sb_font") -> None:
    """Inject theme CSS. Called at top of every page."""
    theme_id = st.session_state.get(theme_key, "slate")
    font_id = st.session_state.get(font_key, "jetbrains")
    st.markdown(f"<style>{get_theme_css(theme_id, font_id)}</style>", unsafe_allow_html=True)


def render_theme_controls(theme_key: str = "sb_theme", font_key: str = "sb_font") -> None:
    """Theme + font selectors — call in main content or sidebar."""
    st.caption("Оформление")
    col_t, col_f = st.columns(2)
    with col_t:
        st.selectbox(
            "Тема",
            options=list(THEMES.keys()),
            format_func=lambda x: THEMES[x]["label"],
            key=theme_key,
            label_visibility="collapsed",
        )
    with col_f:
        st.selectbox(
            "Шрифт",
            options=list(FONTS.keys()),
            format_func=lambda x: FONTS[x]["label"],
            key=font_key,
            label_visibility="collapsed",
        )

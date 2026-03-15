"""
Product metrics page — makes usage and outcome signals visible inside Streamlit.
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.config import DB_PATH
from app.shared_styles import inject_styles
from app.auth import get_current_user_id, require_auth
from db.manager import DBManager


@st.cache_resource
def load_db() -> DBManager:
    db = DBManager(db_path=DB_PATH)
    db.init()
    return db


db = load_db()
current_user = require_auth(db)
user_id = get_current_user_id()
summary = db.get_product_metrics_summary(user_id=user_id)
recent_events = db.get_recent_events(limit=25, user_id=user_id)

inject_styles()
st.title("Продуктовые метрики")
st.caption("Локальная телеметрия для demo-версии. Помогает оценивать не только качество промпта, но и реальное использование сценариев.")

top1, top2, top3, top4 = st.columns(4)
top1.metric("Запросов на генерацию", summary["generate_requests"])
top2.metric("Готовых промптов", summary["generated_prompts"])
top3.metric("Сохранений", summary["saved_prompts"])
top4.metric("A/B запусков", summary["compare_runs"])

mid1, mid2, mid3, mid4 = st.columns(4)
mid1.metric("Acceptance rate", f"{summary['prompt_acceptance_rate']:.1f}%")
mid2.metric("Save-to-library", f"{summary['save_to_library_rate']:.1f}%")
mid3.metric("Q&A response", f"{summary['questions_response_rate']:.1f}%")
mid4.metric("Средний completeness", f"{summary['avg_prompt_completeness']:.1f}%")

perf1, perf2, perf3 = st.columns(3)
perf1.metric("Средняя latency", f"{summary['avg_generation_latency_ms']:.0f} ms")
perf2.metric("P95 latency", f"{summary['p95_generation_latency_ms']:.0f} ms")
perf3.metric("Итераций запущено", summary["iterations_started"])

with st.expander("Как трактовать эти метрики", expanded=False):
    st.markdown(
        """
- **Acceptance rate** — пока считается через сохранение в библиотеку; это proxy-метрика, а не окончательная product truth.
- **Q&A response** — доля случаев, когда пользователь либо ответил на уточняющие вопросы, либо сознательно пропустил их.
- **Completeness** — эвристика структуры промпта, а не гарантия лучшего результата модели.
- **Latency** — локальная оценка времени полного generation flow.
"""
    )

with st.expander("События", expanded=True):
    counts = summary.get("event_counts", {})
    if not counts:
        st.info("События пока не накоплены. Сгенерируй первый промпт, чтобы заполнить метрики.")
    else:
        for event_name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
            st.markdown(f"- `{event_name}`: {count}")

st.subheader("Последние события")
if recent_events:
    st.dataframe(
        [
            {
                "when": event["created_at"],
                "event": event["event_name"],
                "session_id": event["session_id"],
                "payload": str(event["payload"])[:180],
            }
            for event in recent_events
        ],
        use_container_width=True,
        hide_index=True,
    )
else:
    st.info("История событий пуста.")

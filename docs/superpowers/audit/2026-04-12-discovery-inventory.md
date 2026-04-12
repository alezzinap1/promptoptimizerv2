# Discovery inventory — 2026-04-12

## `app/` directory

- **Exists:** True
- **Notes:** Каталог присутствует, содержимое пустое (или только скрытые служебные элементы не отображены в листинге). Исторический Streamlit UI **не** входит в поддерживаемый контур; дерево в README не перечисляет `app/`.

## Streamlit references outside `docs/archive/` (to remove or rewrite)

Исключены из списка действий: `docs/archive/**`, `docs/superpowers/**` (мета-документация плана).

| Path | Line | Action |
|------|------|--------|
| `config/__init__.py` | 2 | rewrite docstring — neutral |
| `services/auth_service.py` | 2 | rewrite docstring |
| `services/llm_client.py` | 3, 90, 208 | rewrite docstrings — no Streamlit / st.write_stream |
| `core/__init__.py` | 1 | rewrite comment |
| `core/parsing.py` | 3 | rewrite module header |
| `README.md` | several | remove Streamlit product line, tree row, whole archive run section |
| `docs/current/IMPROVEMENT_PLAN.md` |3, 12, 40 | rewrite intro and version-history bullet |
| `docs/current/PRODUCTION_CHECKLIST.md` | 73 | remove Streamlit contour line |
| `docs/current/PRODUCT_VISION.md` | 25 | single UI = React |
| `docs/current/PROMPT_IDE_ARCHITECTURE.md` | 30 | React-only reference |
| `docs/current/PORTFOLIO_CASE.md` | 28, 39, 47 | historical framing only |
| `docs/user/PROJECT_FULL_REPORT.md` | 3, 50, 287–289 | tree + §19 — no supported Streamlit |

## Thin-spot candidates (optional follow-up)

- `backend/api/generate.py` (if future PR): проверить размер хендлеров при следующем изменении генерации.
- Пустой `app/`: при желании удалить каталог отдельным коммитом после согласования (не в текущем плане).

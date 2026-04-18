# Каталог `docs/user/`

**Встроенная справка** приложения (`/help`) живёт только в [`frontend/src/docs/user/`](../../frontend/src/docs/user/) — не дублировать markdown здесь.

Здесь лежит **developer**-материал, который не должен дублировать встроенную `/help`:

- [`PROJECT_FULL_REPORT.md`](PROJECT_FULL_REPORT.md) — длинный обзор репозитория (маршруты, API, пайплайны). Индекс остальной актуальной документации: [`../current/README.md`](../current/README.md).
- [`reports/metaprompt_full_analysis_v5.html`](reports/metaprompt_full_analysis_v5.html) — статический HTML-отчёт (вне бандла фронта); на него ссылается матрица в `frontend/src/docs/user/REPORT_V5_CODE_MATRIX.md`.

# Актуальная документация (вне архива)

Материалы здесь описывают **текущий** продукт **FastAPI + React** и процессы вокруг него. Исторические планы и аудиты — в [`../archive/`](../archive/README.md).

| Файл | Назначение |
|------|------------|
| [Полный обзор репозитория](../user/PROJECT_FULL_REPORT.md) | Архитектура, маршруты, API, данные, пайплайны (единственный длинный developer-обзор) |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | Короткое резюме продуктовых идей и что уже в коде |
| [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) | Приоритизированный бэклог улучшений |
| [PROMPT_IDE_ARCHITECTURE.md](PROMPT_IDE_ARCHITECTURE.md) | PromptSpec, Evidence, Debugger, связь с UI и файлами |
| [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md) | Продуктовые и технические метрики, события |
| [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) | Go/no-go перед публичным продом |
| [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) | Чеклист инфраструктуры и деплоя |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Сценарий демо на 5–10 минут |
| [PORTFOLIO_CASE.md](PORTFOLIO_CASE.md) | Как рассказывать проект на собеседовании |

**Пользовательская справка в приложении** (`/help`): только [`frontend/src/docs/user/`](../../frontend/src/docs/user/) — не дублировать в `docs/user/`.

**Аналитика / токены:** [`../analytics/`](../analytics/).

**Скриншоты для корневого README:** [`../screenshots/README.md`](../screenshots/README.md).

## Индексация в Cursor

Рекомендуется корневой `.cursorignore` с строками `docs/archive/` и `.pytest_cache/`. Если создание `.cursorignore` недоступно, см. правило [`.cursor/rules/documentation-context.mdc`](../../.cursor/rules/documentation-context.mdc).

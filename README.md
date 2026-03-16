# Prompt Engineer

`Prompt Engineer` — ассистент для проектирования промптов, который не просто отправляет запрос в LLM, а:

- классифицирует задачу;
- подбирает техники промптинга из собственной базы знаний;
- учитывает целевую модель, под которую готовится промпт;
- показывает reasoning по выбору техник;
- хранит версии и библиотеку удачных промптов.

**Основной рабочий продукт** — **FastAPI + React** (web-приложение). Streamlit — законсервирован для архивной памяти.

## Эволюция проекта

- `v1`: Telegram-бот (архив).
- `v2`: Streamlit (архив, законсервирован).
- `v3`: **FastAPI + React** — основной runtime.

## Почему это не просто обёртка над API

- `knowledge base` техник в YAML;
- выбор техник привязан к типу задачи и сложности;
- guidance под конкретные модели;
- цикл `generate -> inspect -> iterate -> save`;
- локальная библиотека промптов и история версий.

## Архитектура

```text
user -> React frontend -> FastAPI backend -> core/ + services/ + db/
                                    -> techniques/ knowledge base
                                    -> OpenRouter LLM
```

### Основные директории

```text
prompt-engineer-agent/
├── backend/          # FastAPI API
├── frontend/         # React SPA
├── config/           # Общие настройки (app + backend)
├── core/             # Доменная логика
├── db/               # SQLite-менеджер
├── services/         # LLM-клиент, OpenRouter
├── techniques/       # YAML-база техник
├── app/              # Streamlit (архив, законсервирован)
└── docs/             # Исследования и заметки
```

## Быстрый старт

### FastAPI + React (рекомендуется)

```bash
git clone <repo>
cd prompt-engineer-agent

python -m venv venv
# Windows: .\venv\Scripts\activate
# Linux/Mac: source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Заполни `OPENROUTER_API_KEY` в `.env`, затем:

**Терминал 1 — backend:**
```bash
uvicorn backend.main:app --reload --port 8000
```

**Терминал 2 — frontend:**
```bash
cd frontend && npm install && npm run dev
```

Открой `http://localhost:5173`. Frontend проксирует `/api` на `localhost:8000`.

### Streamlit (архив, законсервирован)

```bash
streamlit run app/main.py
```

Открой `http://localhost:8501`. См. `docs/STREAMLIT_ARCHIVE.md` для контекста.

## Docker

Текущий `Dockerfile` ориентирован на Streamlit. Для production FastAPI+React см. `docs/PRODUCTION_PLAN.md`.

```bash
docker build -t prompt-engineer .
docker run --rm -p 8501:8501 --env-file .env -v $(pwd)/data:/app/data prompt-engineer
```

## Health check

**Backend:**
```bash
curl http://localhost:8000/api/health
```

**Streamlit health server:**
```bash
uvicorn app.health_server:app --host 0.0.0.0 --port 8502
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `OPENROUTER_API_KEY` | API-ключ OpenRouter |
| `DB_PATH` | Путь к SQLite (по умолчанию `data/web_agent.db`) |
| `APP_ENV` | `dev` \| `demo` \| `prod` |
| `CORS_ORIGINS` | CORS origins через запятую (для production) |
| `MAX_INPUT_CHARS` | Лимит символов ввода (50000) |
| `RATE_LIMIT_REQUESTS` | Запросов в минуту (30) |
| `BUDGET_GENERATIONS_PER_SESSION` | Лимит генераций в сессии (50) |
| `LLM_TIMEOUT_SEC` | Таймаут LLM (120) |
| `SENTRY_DSN` | DSN для Sentry (опционально) |
| `POSTGRES_DSN` | DSN для миграции SQLite → Postgres |

## Storage operations

- Backup: `python scripts/backup_sqlite.py --db data/web_agent.db --out backups`
- Migration: `python scripts/migrate_sqlite_to_postgres.py --sqlite data/web_agent.db --postgres "$POSTGRES_DSN"`

## Добавление новых техник

Создай YAML-файл в `techniques/` по шаблону:

```yaml
id: my_technique
name: "Название техники"
when_to_use:
  task_types: [code, analysis]
  complexity: [medium, high]
core_pattern: "Шаблон с {переменными}"
why_it_works: "Объяснение..."
```

## Ключевые файлы

- `backend/main.py` — точка входа FastAPI
- `frontend/src/pages/Home.tsx` — основной сценарий генерации
- `core/context_builder.py` — сборка system prompt
- `core/prompt_spec.py` — структурированная спецификация
- `core/technique_registry.py` — база и выбор техник
- `db/manager.py` — версии и библиотека промптов
- `services/llm_client.py` — OpenRouter

## Документы проекта

- `docs/IMPROVEMENT_PLAN.md` — план дальнейших улучшений
- `docs/PRODUCTION_PLAN.md` — план перехода в production
- `docs/STREAMLIT_ARCHIVE.md` — Streamlit законсервирован
- `docs/METRICS_FRAMEWORK.md` — метрики
- `docs/PROMPT_IDE_ARCHITECTURE.md` — IDE-слой
- `docs/PRODUCTION_CHECKLIST.md` — чеклист production

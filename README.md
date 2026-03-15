# Prompt Engineer

`Prompt Engineer` — это ассистент для проектирования промптов, который не просто отправляет запрос в LLM, а:

- классифицирует задачу;
- подбирает техники промптинга из собственной базы знаний;
- учитывает целевую модель, под которую готовится промпт;
- показывает reasoning по выбору техник;
- хранит версии и библиотеку удачных промптов.

Сейчас основной рабочий продукт в репозитории — `Streamlit`-приложение. Исторические прототипы и заготовки могут оставаться в репозитории как архивный контекст, но не считаются поддерживаемыми runtime-поверхностями.

## Почему это не просто обёртка над API

Проект решает задачу `prompt design workflow`, а не только генерации текста:

- у него есть `knowledge base` техник в `YAML`;
- выбор техник привязан к типу задачи и сложности;
- есть guidance под конкретные модели;
- есть цикл `generate -> inspect -> iterate -> save`;
- есть локальная библиотека промптов и история версий.

## Эволюция проекта

- `v1`: Telegram-бот для проверки продуктовой гипотезы.
- `v2`: рабочая `Streamlit`-версия для demo и portfolio use case.
- `v3`: заготовка под `FastAPI + React` для более зрелой web-архитектуры.

Сейчас поддерживается и развивается в первую очередь `v2`.

## Текущий статус

### Что работает сейчас

- `Streamlit`-интерфейс для генерации и итеративного улучшения промптов
- `Workspace`-контекст для reusable prompt design
- `PromptSpec` как структурированная спецификация задачи
- `Prompt IDE`-панель с `Intent`, `Debugger` и `Evidence`
- локальная auth-модель (username/password) с изоляцией данных по пользователям
- база техник промптинга
- выбор техник под задачу и целевую модель
- сохранение версий и prompt library
- справочник техник

## Ключевые возможности

- **Автоматическая классификация задачи** — определяет тип задачи и сложность без LLM-вызова.
- **База знаний техник** — техники хранятся в `YAML` и могут расширяться без переписывания core.
- **Умный выбор техник** — проект подбирает набор техник под задачу и target model.
- **Reasoning для пользователя** — система объясняет, почему были выбраны именно эти техники.
- **Итеративное улучшение** — можно дорабатывать уже созданный промпт.
- **Prompt history и library** — есть история версий и библиотека сохранённых промптов.
- **Workspace profiles** — можно задавать reusable glossary, style rules и reference snippets.
- **Prompt IDE preview** — перед генерацией система показывает structured spec, evidence и debugger issues.
- **Поддержка нескольких моделей** через OpenRouter.

## Архитектура

```text
user -> Streamlit UI -> core/ + services/ + db/
                     -> techniques/ knowledge base
                     -> OpenRouter LLM
```

### Основные директории

```text
prompt-engineer-agent/
├── app/              # Основной рабочий Streamlit UI
├── core/             # Общая доменная логика
├── db/               # SQLite-менеджер для web/Streamlit
├── services/         # LLM-клиент
├── techniques/       # YAML-база техник промптинга
├── docs/             # Исследования и заметки по UX/архитектуре
└── requirements.txt
```

## Быстрый старт

### Локальный запуск Streamlit

```bash
git clone <repo>
cd prompt-engineer-agent

python -m venv venv
source venv/bin/activate  # Linux/Mac
# или: .\\venv\\Scripts\\activate  # Windows

pip install -r requirements.txt
cp .env.example .env
```

Заполни `OPENROUTER_API_KEY` в `.env`, затем запусти:

```bash
streamlit run app/main.py
```

Открой `http://localhost:8501`.

## Docker

Текущий `Dockerfile` ориентирован на `Streamlit` demo runtime:

```bash
docker build -t prompt-engineer .
docker run --rm -p 8501:8501 --env-file .env -v $(pwd)/data:/app/data prompt-engineer
```

## Health check (production)

Для readiness/liveness probe можно запустить отдельный сервер:

```bash
uvicorn app.health_server:app --host 0.0.0.0 --port 8502
```

- `GET /health` — liveness
- `GET /ready` — readiness (проверка DB)

## Переменные окружения

| Переменная | Описание |
|---|---|
| `OPENROUTER_API_KEY` | API-ключ OpenRouter для `Streamlit` |
| `DB_PATH` | Путь к SQLite базе приложения |
| `APP_ENV` | `dev` \| `demo` \| `prod` |
| `MAX_INPUT_CHARS` | Лимит символов ввода (по умолчанию 50000) |
| `RATE_LIMIT_REQUESTS` | Запросов в минуту на сессию (30) |
| `BUDGET_GENERATIONS_PER_SESSION` | Лимит генераций в сессии (50) |
| `LLM_TIMEOUT_SEC` | Таймаут LLM-вызова (120) |
| `SENTRY_DSN` | DSN для Sentry (опционально) |
| `POSTGRES_DSN` | DSN для миграции SQLite → Postgres скриптом |

## Storage operations

- Backup SQLite:
  - `python scripts/backup_sqlite.py --db data/web_agent.db --out backups`
- Migration SQLite -> Postgres:
  - `python scripts/migrate_sqlite_to_postgres.py --sqlite data/web_agent.db --postgres "$POSTGRES_DSN"`

## Добавление новых техник

Создай `YAML`-файл в `techniques/` по шаблону:

```yaml
id: my_technique
name: "Название техники"

when_to_use:
  task_types: [code, analysis]
  complexity: [medium, high]
  not_for: [simple_facts]

why_it_works: >
  Объяснение почему техника работает...

core_pattern: "Шаблон промпта с {переменными}"

variants:
  - name: "Вариант 1"
    pattern: "..."
    cost_tokens: low
    use_when: "когда применять"

anti_patterns:
  - "Когда НЕ использовать"

compatibility:
  combines_well_with: [role_prompting]
```

Новая техника будет доступна после перезапуска приложения.

## Что смотреть в репозитории в первую очередь

- `app/main.py` — точка входа `Streamlit`
- `app/Home.py` — основной инженерный сценарий
- `core/context_builder.py` — сборка system prompt
- `core/prompt_spec.py` — структурированная спецификация задачи
- `core/prompt_debugger.py` — rule-based debugger для Prompt IDE
- `core/evidence.py` — происхождение ключевых полей PromptSpec
- `core/intent_graph.py` — lightweight intent graph
- `core/technique_registry.py` — база и выбор техник
- `core/quality_metrics.py` — эвристическая оценка промптов
- `db/manager.py` — версии и библиотека промптов
- `services/llm_client.py` — работа с OpenRouter

## Документы проекта

- `docs/STREAMLIT_AUDIT.md` — честный аудит текущей рабочей версии
- `docs/METRICS_FRAMEWORK.md` — какие метрики собирать и как их трактовать
- `docs/DEMO_SCRIPT.md` — сценарий для демо и собеседований
- `docs/PORTFOLIO_CASE.md` — framing проекта как portfolio case
- `docs/PRODUCTION_CHECKLIST.md` — что обязательно нужно до production
- `docs/PRODUCTION_ANALYSIS.md` — приоритизированный анализ и план перехода в production
- `docs/PROMPT_IDE_ARCHITECTURE.md` — что уже реализовано в новом IDE-слое
- `docs/PRODUCT_IDEA_DEEP_DIVE.md` — продуктовый deep dive по следующим большим идеям

## Ограничения текущего этапа

- основной runtime сейчас только `Streamlit`;
- проект подходит для demo, portfolio и controlled beta, но ещё не production-ready.

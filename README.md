# Prompt Engineer

`Prompt Engineer` — это ассистент для проектирования промптов, который не просто отправляет запрос в LLM, а:

- классифицирует задачу;
- подбирает техники промптинга из собственной базы знаний;
- учитывает целевую модель, под которую готовится промпт;
- показывает reasoning по выбору техник;
- хранит версии и библиотеку удачных промптов.

Сейчас основной рабочий продукт в репозитории — `Streamlit`-приложение. Telegram-бот сохранён как `v1` проекта: он нужен как исторический предшественник и proof of concept, но не является основной точкой входа.

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
- база техник промптинга
- выбор техник под задачу и целевую модель
- сохранение версий и prompt library
- справочник техник

### Что в репозитории есть как следующий шаг

- `backend/` — `FastAPI` API
- `frontend/` — `React + Vite` интерфейс
- `bot/` — legacy Telegram v1

Эти части важны для эволюции проекта, но не считаются основной рабочей demo-версией на текущем этапе.

## Ключевые возможности

- **Автоматическая классификация задачи** — определяет тип задачи и сложность без LLM-вызова.
- **База знаний техник** — техники хранятся в `YAML` и могут расширяться без переписывания core.
- **Умный выбор техник** — проект подбирает набор техник под задачу и target model.
- **Reasoning для пользователя** — система объясняет, почему были выбраны именно эти техники.
- **Итеративное улучшение** — можно дорабатывать уже созданный промпт.
- **Prompt history и library** — есть история версий и библиотека сохранённых промптов.
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
├── backend/          # FastAPI заготовка для следующего этапа
├── frontend/         # React frontend для следующего этапа
├── bot/              # Legacy Telegram v1
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

### FastAPI backend

Этот runtime пока не является основной рабочей версией, но может использоваться для следующего этапа миграции:

```bash
python run_backend.py
```

### Legacy Telegram bot

Telegram-бот сохранён как `v1` и запускается отдельно при наличии `TELEGRAM_BOT_TOKEN`:

```bash
python -m bot.main
```

## Docker

Текущий `Dockerfile` ориентирован на `Streamlit` demo runtime:

```bash
docker build -t prompt-engineer .
docker run --rm -p 8501:8501 --env-file .env -v $(pwd)/data:/app/data prompt-engineer
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `OPENROUTER_API_KEY` | API-ключ OpenRouter для `Streamlit` и web-части |
| `DB_PATH` | Путь к SQLite базе для web/Streamlit |
| `TELEGRAM_BOT_TOKEN` | Только для legacy Telegram v1 |

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
- `core/technique_registry.py` — база и выбор техник
- `core/quality_metrics.py` — эвристическая оценка промптов
- `db/manager.py` — версии и библиотека промптов
- `services/llm_client.py` — работа с OpenRouter

## Документы проекта

- `docs/STREAMLIT_AUDIT.md` — честный аудит текущей рабочей версии
- `docs/METRICS_FRAMEWORK.md` — какие метрики собирать и как их трактовать
- `docs/DEMO_SCRIPT.md` — сценарий для демо и собеседований
- `docs/PORTFOLIO_CASE.md` — framing проекта как portfolio case
- `docs/WEB_MIGRATION_PATH.md` — условия и путь миграции в `FastAPI + React`
- `docs/PRODUCTION_CHECKLIST.md` — что обязательно нужно до production

## Ограничения текущего этапа

- основной runtime сейчас только `Streamlit`;
- web-архитектура в репозитории есть, но ещё не является основной рабочей поставкой;
- проект подходит для demo, portfolio и controlled beta, но ещё не production-ready.

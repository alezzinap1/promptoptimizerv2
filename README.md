# Prompt Optimizer

**Prompt Optimizer** — веб-приложение для осмысленного проектирования промптов: оно не просто пересылает текст в LLM, а структурирует задачу, подбирает техники из базы знаний, учитывает целевую модель и помогает итерировать результат до сохранения в библиотеку.

**Актуальный продукт:** **FastAPI + React** (SPA).

---

## Зачем это нужно

- **Классификация задачи** — тип и сложность влияют на выбор техник.
- **База техник** — YAML-карточки с паттернами, ограничениями и примерами (`techniques/`).
- **Целевая модель** — в system prompt подмешиваются подсказки под GPT, Claude, Gemini и др.
- **Объяснение (reasoning)** — модель генерации описывает, почему выбраны техники.
- **Режим уточняющих вопросов** — при недостатке контекста сначала `[QUESTIONS]`, затем `[PROMPT]`.
- **Prompt IDE** — превью структурированной спецификации (цель, формат, ограничения, evidence) до вызова LLM (`/api/prompt-ide/preview`).
- **Сравнение (A/B техник)** — страница Compare: одна задача и одна модель генерации, два набора техник (A/B) для сопоставления промптов.
- **Версии и библиотека** — история правок по сессии, сохранение удачных промптов в SQLite.
- **Workspaces** — профили с глоссарием, правилами стиля и сниппетами для контекста.
- **Метрики и модели** — учёт событий, справочник моделей OpenRouter, лимиты trial при общем ключе хоста.
- **Целевая модель** — карточки подсказок по семейству (OpenRouter id → шаблон); **классификация задачи** — эвристика или LLM (настройки); **Compare** — опционально LLM-судья (`/compare/judge`).
- **Простой режим** — одна кнопка: улучшить вставленный промпт (пресеты и мета-промпт в настройках).
- **Stability evaluation** — на странице `/compare`, вкладка «Стабильность»: прогон одного промпта N раз с одинаковым входом, оценка LLM-судьёй по рубрике, эмбеддинги для diversity-score, опциональное pair-сравнение A vs B. После прогона — **мета-анализ**: один вызов LLM по всем ответам и промпту (слабые места, паттерны сбоев, что усилить в формулировке). Опционально **второй судья** (MVP-1.5): вторая модель независимо ставит баллы; в отчёте — среднее \|Δ\| между судьями. Перед запуском — превью стоимости (в т.ч. синтез и второй судья); дневной бюджет в `/settings` ($5/день по умолчанию). **Eval Studio** (`/eval`) — список прогонов, мини-лидерборд по p50 (MVP-3-lite), скачивание отчёта `.md` (MVP-4-lite).
- **Зачем в перспективе MVP-2 (датасеты + программные проверки)** — это не «ещё судья», а возможность гонять промпт **на многих разных входах** из сохранённого набора и автоматически проверять ответы **правилами** (например «валидный JSON по схеме», regex, иногда безопасный песочничный код). Смысл: дешевле и **воспроизводимее**, чем звать LLM на каждый кейс; субъективное качество по-прежнему можно добирать рубрикой-судьёй.
- **Справка** — обзор, онбординг, главный поток Home, разделы приложения, простой режим, глоссарий (`/help`; исходники в [`frontend/src/docs/user/`](frontend/src/docs/user/)).

Поток в общих чертах (студия **`/home`**): **описать задачу → (опционально) уточнить в IDE → сгенерировать → при необходимости итерировать → сохранить в библиотеку**.

---

## Интерфейс (скриншоты)

Добавьте файлы в каталог [`docs/screenshots/`](docs/screenshots/) (имена ниже). Пока файлов нет, картинки в GitHub не отобразятся — это нормально.

Рекомендуемая ширина исходника: **920–960 px** по горизонтали (или 2× для чёткости на Retina).

<p align="center">
  <img src="docs/screenshots/01-home.png" alt="Главная страница: формулировка задачи и генерация" width="920" />
</p>
<p align="center"><em>Рис. 1 — Главная: ввод задачи, structured spec и генерация промпта с reasoning.</em></p>

<p align="center">
  <img src="docs/screenshots/02-compare.png" alt="Сравнение ответов нескольких моделей" width="920" />
</p>
<p align="center"><em>Рис. 2 — Compare: одна задача, два набора техник (A/B), сопоставление промптов.</em></p>

<p align="center">
  <img src="docs/screenshots/03-library.png" alt="Библиотека сохранённых промптов" width="920" />
</p>
<p align="center"><em>Рис. 3 — Библиотека: поиск, теги, сохранённые промпты и метаданные.</em></p>

<p align="center">
  <img src="docs/screenshots/04-techniques.png" alt="Каталог техник промптинга" width="920" />
</p>
<p align="center"><em>Рис. 4 — Техники: база знаний и пользовательские переопределения.</em></p>

<p align="center">
  <img src="docs/screenshots/05-settings.png" alt="Настройки, тема и API-ключ" width="920" />
</p>
<p align="center"><em>Рис. 5 — Настройки: тема, шрифты, предпочитаемые модели, ключ OpenRouter (опционально).</em></p>

Подсказки по именам файлов — в [`docs/screenshots/README.md`](docs/screenshots/README.md).

---

## Страницы приложения (React)

| Маршрут | Назначение |
|---------|------------|
| `/` | Редирект: гость → `/welcome`, пользователь → `/home` |
| `/welcome` | Публичная витрина: описание продукта, вход, демо |
| `/home` | Студия: генерация, IDE-превью, ответы на уточняющие вопросы |
| `/onboarding` | После регистрации: короткие предпочтения (можно пропустить) |
| `/admin`, `/admin/users/:id` | Админка (только `is_admin=1` в БД): пользователи, лимиты, события без текста промптов |
| `/compare` | Сравнение моделей |
| `/library` | Библиотека промптов |
| `/techniques` | Список и редактирование техник (в т.ч. кастомные) |
| `/metrics` | Редирект на **User Info** → блок «Продуктовые метрики» (`#product-metrics`) |
| `/workspaces` | Рабочие профили |
| `/models` | Модели OpenRouter |
| `/settings` | Настройки UI и API-ключа |
| `/user-info` | Информация о пользователе, trial и **продуктовые метрики** (внизу страницы) |

Вход по логину/паролю; сессия передаётся заголовком `X-Session-Id` (хранится на клиенте после login/register).

**Администратор:** выставить флаг в SQLite — `python scripts/set_admin_user.py --username <логин>` (можно несколько раз `--username`; путь к БД из `DB_PATH` в `.env`).

---

## Стек и архитектура

| Слой | Технологии |
|------|------------|
| Frontend | React, Vite, TypeScript |
| Backend | FastAPI, Uvicorn |
| БД | SQLite (`db/manager.py`), опционально Postgres (скрипты миграции) |
| LLM | OpenRouter (OpenAI-совместимый API) |
| Семантика агента (студия) | `fastembed` + ONNX-модель `paraphrase-multilingual-MiniLM-L12-v2` (`POST /api/agent/semantic-route`). Отключение: `SEMANTIC_AGENT_ROUTER=0`. Пороги: `SEMANTIC_ROUTE_MIN_CONFIDENCE`, `SEMANTIC_ROUTE_MIN_MARGIN` в `config/settings.py`. На Windows без symlink для кэша HF см. [документацию huggingface_hub](https://huggingface.co/docs/huggingface_hub/how-to-cache#limitations) или режим разработчика. |

```text
user → React (Vite) → FastAPI /api → core/ + services/ + db/
                              ├── techniques/*.yaml
                              └── OpenRouter
```

Сборка фронта: `frontend/dist` может отдаваться тем же FastAPI (`backend/main.py`) для единого origin в production.

### Основные директории

```text
prompt-engineer-agent/
├── backend/           # FastAPI, роутеры API
├── frontend/          # React SPA
├── config/            # Настройки, rate limit, лимиты
├── core/              # Классификация, context builder, техники, prompt spec
├── db/                # SQLite-менеджер
├── services/          # LLM, auth, шифрование ключей, workflow
├── techniques/        # YAML-база техник
├── scripts/           # backup / миграции
└── docs/              # current/ — актуальные планы и гайды; archive/ — история; analytics/; screenshots/
```

---

## Быстрый старт (разработка)

```bash
git clone <repo-url>
cd prompt-engineer-agent

python -m venv venv
# Windows: .\venv\Scripts\activate
# Linux/macOS: source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Укажите в `.env` как минимум **`OPENROUTER_API_KEY`** (общий ключ хоста для trial или разработки). Для публичного сервера задайте **`USER_API_KEY_FERNET_SECRET`** (шифрование пользовательских ключей в БД) — см. таблицу ниже.

**Терминал 1 — backend:**

```bash
uvicorn backend.main:app --reload --port 8000
```

**Терминал 2 — frontend:**

```bash
cd frontend && npm install && npm run dev
```

Откройте [http://localhost:5173](http://localhost:5173). Запросы к `/api` проксируются на [http://localhost:8000](http://localhost:8000) (см. `frontend/vite.config.ts`).

В приложении: **Справка** (`/help`) — встроенная пользовательская документация; исходные markdown лежат в [`frontend/src/docs/user/`](frontend/src/docs/user/) (импорт в `Help.tsx`).

Зарегистрируйте пользователя через UI или вызовите `/api/auth/register`.

---

## Docker (FastAPI + React)

`Dockerfile` собирает фронтенд (Node) и подкладывает `frontend/dist` в образ с Python; контейнер поднимает Uvicorn на порту **8000**.

```bash
docker build -t prompt-engineer .
docker run --rm -p 8000:8000 --env-file .env -v "%cd%/data:/app/data" prompt-engineer
```

На Linux/macOS замените том на `-v "$(pwd)/data:/app/data"`. После запуска откройте `http://localhost:8000` (статика SPA + API).

---

## Health check

```bash
curl http://localhost:8000/api/health
```

---

## Дополнительные API (студия и библиотека)

Базовый префикс в dev: **`/api`** (прокси с Vite на бэкенд).

### `POST /api/image/try`

Пробная генерация изображения через OpenRouter (модели с выходом `image`: запрос с `modalities` и при необходимости `image_config`). Нужен валидный ключ OpenRouter (пользовательский или хоста в пределах trial).

**Тело (JSON):**

| Поле | Тип | Описание |
|------|-----|----------|
| `prompt_text` | string | Текст промпта к изображению |
| `gen_model` | string, optional | Короткое имя из `PROVIDER_MODELS` (например `nano_banana`) или полный id вида `google/...` |
| `aspect_ratio` | string, optional | Например `1:1`, `16:9` (зависит от модели) |

**Ответ:** `image_url` (data URL), `gen_model` (фактический id), `saved_path` — относительный URL сохранённого WebP-превью под `data/uploads/library_previews/` или `null`, если сохранение не удалось.

**Переменная окружения:** `IMAGE_TRY_MODEL` — полный OpenRouter id по умолчанию, если в запросе не передан подходящий `gen_model` (в коде дефолт — `google/gemini-2.5-flash-image`; при ответе 404 о несовместимых modalities запрос повторяется с `["image"]` вместо `["image","text"]`).

### `POST /api/library/llm-review`

Краткая текстовая оценка промпта отдельным вызовом LLM («судья»). Тело: `prompt`, `prompt_type` (`text` \| `image` \| `skill`), опционально `original_task`, `judge_model`.

### Сохранение превью в библиотеку

В **`POST /api/library`** опциональное поле **`cover_image_path`**: передайте значение `saved_path` из ответа `/image/try`, чтобы к записи библиотеки привязать превью (колонка `cover_image_path` в SQLite).

---

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `OPENROUTER_API_KEY` | Ключ OpenRouter на стороне сервера (trial / дефолт, если у пользователя нет своего ключа) |
| `IMAGE_TRY_MODEL` | (Опционально) Полный OpenRouter id для `POST /api/image/try`, если клиент не передал модель |
| `USER_API_KEY_FERNET_SECRET` | Ключ Fernet (base64) для шифрования пользовательских OpenRouter-ключей в SQLite; для публичного деплоя задавать обязательно |
| `DB_PATH` | Путь к SQLite (по умолчанию `data/web_agent.db`) |
| `APP_ENV` | `dev` \| `demo` \| `prod` |
| `CORS_ORIGINS` | Origins через запятую (production: ваш HTTPS-URL фронта) |
| `SESSION_TTL_HOURS` | Срок жизни сессии после login/register (по умолчанию 24) |
| `AUTH_REGISTER_RATE_LIMIT_REQUESTS` | Лимит регистраций с одного IP за окно |
| `AUTH_REGISTER_RATE_WINDOW_SEC` | Окно для лимита регистраций (сек) |
| `AUTH_LOGIN_RATE_LIMIT_REQUESTS` | Лимит попыток входа с одного IP за окно |
| `AUTH_LOGIN_RATE_WINDOW_SEC` | Окно для лимита входа (сек) |
| `MAX_INPUT_CHARS` | Макс. длина ввода (по умолчанию 50000) |
| `RATE_LIMIT_REQUESTS` | Запросов к генерации/compare за окно на ключ сессии/IP |
| `RATE_LIMIT_WINDOW_SEC` | Окно rate limit генерации (сек) |
| `BUDGET_GENERATIONS_PER_SESSION` | Макс. генераций на auth-сессию |
| `TRIAL_TOKENS_LIMIT` | Лимит токенов trial на пользователя при использовании ключа хоста |
| `TRIAL_MAX_COMPLETION_PER_M` | Порог $/1M (completion) для моделей в trial (по умолчанию 3.0) |
| `OPENROUTER_PROVIDER_SORT` | Маршрутизация провайдеров: `throughput` (по умолчанию), `latency`, `price`; `off` — отключить |
| `LLM_TIMEOUT_SEC` | Таймаут запросов к LLM |
| `SENTRY_DSN` | Sentry (опционально) |
| `LOG_LEVEL` | Уровень логирования |
| `POSTGRES_DSN` | DSN для миграции SQLite → Postgres |

Полный шаблон: [`.env.example`](.env.example).

---

## Безопасность и публичный деплой (кратко)

- Сессии **истекают** по времени (`SESSION_TTL_HOURS`); идентификатор передаётся в `X-Session-Id`.
- Регистрация и вход ограничены **rate limit по IP** (in-memory; при одном воркере за прокси важен корректный `X-Forwarded-For`).
- Пользовательские ключи OpenRouter в БД хранятся **в зашифрованном виде**, если задан `USER_API_KEY_FERNET_SECRET`.
- Пароли — **PBKDF2** (см. `services/auth_service.py`).

Это не замена аудиту и HTTPS: в production используйте TLS, сужайте `CORS_ORIGINS`, ограничивайте доступ к хосту и бэкапам БД.

---

## Операции с данными

- Резервная копия SQLite: `python scripts/backup_sqlite.py --db data/web_agent.db --out backups`
- Миграция в Postgres: `python scripts/migrate_sqlite_to_postgres.py --sqlite data/web_agent.db --postgres "$POSTGRES_DSN"`

---

## Добавление техник

Создайте YAML в `techniques/`:

```yaml
id: my_technique
name: "Название техники"
when_to_use:
  task_types: [code, analysis]
  complexity: [medium, high]
core_pattern: "Шаблон с {переменными}"
why_it_works: "Объяснение..."
```

---

## Ключевые файлы

| Файл | Роль |
|------|------|
| `backend/main.py` | FastAPI, CORS, статика `frontend/dist`, роутеры |
| `backend/deps.py` | Сессия, БД, реестр техник |
| `backend/api/generate.py` | Генерация промпта |
| `backend/api/auth.py` | Регистрация, вход, logout |
| `frontend/src/pages/Home.tsx` | Основной сценарий |
| `core/context_builder.py` | System/user контент для LLM |
| `core/prompt_spec.py` | Спецификация и brief |
| `core/technique_registry.py` | Реестр техник |
| `db/manager.py` | Пользователи, сессии, библиотека, шифрование полей |
| `services/llm_client.py` | OpenRouter |
| `services/api_key_crypto.py` | Fernet для ключей пользователей |

---

## Документация в `docs/`

- **Актуально:** [`docs/current/README.md`](docs/current/README.md) — индекс планов, продуктового видения, production checklist, demo script и т.д.
- **Архив (история, не источник истины о продукте):** [`docs/archive/README.md`](docs/archive/README.md) — снимки прошлых решений и планов, сжатый брейнсторм идей.
- **Аналитика:** [`docs/analytics/`](docs/analytics/).
- **Скриншоты для README:** [`docs/screenshots/README.md`](docs/screenshots/README.md).

Файлы **`docs/*.md` в корне `docs/`** (не в подпапках) по-прежнему в [`.gitignore`](.gitignore) — локальные черновики. Подпапки `docs/current/`, `docs/archive/`, `docs/analytics/` **не** попадают под это правило и могут коммититься.

Рекомендуется добавить в **корень** репозитория `.cursorignore` со строкой `docs/archive/`, чтобы Cursor не индексировал архив (если создание файла не блокируется средой).

**Длинный developer-обзор** (маршруты, API, пайплайны): [`docs/user/PROJECT_FULL_REPORT.md`](docs/user/PROJECT_FULL_REPORT.md).

---

## Что игнорируется Git

В [`.gitignore`](.gitignore) в том числе: `.env`, `venv`, `node_modules`, `data/`, **`docs/*.md`** (только файлы **непосредственно** в `docs/`, без подпапок), офисные форматы (`*.pdf`, `*.docx`, …), папка `documents/`, вложения такого типа под `docs/**`, служебные `.cursor/`, `*.log`. Пути вроде **`docs/current/*.md`**, **`docs/archive/*.md`**, **`docs/user/*.md`**, **`docs/analytics/*.md`** правило `docs/*.md` **не** скрывает. Скриншоты для README — **`docs/screenshots/*.png`** и **`docs/screenshots/README.md`**; закоммитьте PNG, когда будут готовы.

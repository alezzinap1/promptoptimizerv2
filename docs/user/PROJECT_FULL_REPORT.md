# MetaPrompt / Prompt Engineer — обзор проекта (developer)

Документ описывает **текущую реализацию** в репозитории: идею, архитектуру, техники, автоматизацию по этапам, экраны и API. Актуальный продукт — **FastAPI + React (SPA)** — единственный поддерживаемый клиент. Индекс актуальной документации: [`docs/current/README.md`](../current/README.md).

---

## 1. Идея продукта

**Задача:** не «просто отправить текст в LLM», а **спроектировать промпт**: структурировать запрос, учесть целевую модель, применить проверенные приёмы (техники), при необходимости уточнить недостающее у пользователя, итерировать и сохранить результат в библиотеку.

**Роль приложения:** промежуточный «инженер промптов» — в system prompt зашиты контракт ответа (`[REASONING]`, `[QUESTIONS]` или `[PROMPT]`), подсказки под семейства моделей, YAML-карточки техник; пользователь работает с формулировкой задачи, настройками и превью спецификации (Prompt IDE).

**Брендинг в UI:** логотип и название **metaprompt**; в части README и старых текстах может встречаться «Prompt Optimizer» — то же приложение.

---

## 2. Стек и развёртывание

| Слой | Технологии |
|------|------------|
| Frontend | React 18, Vite, TypeScript, react-router-dom, react-markdown |
| Backend | FastAPI, Uvicorn |
| БД | SQLite по умолчанию (`db/manager.py`, путь из `DB_PATH` / `data/web_agent.db`) |
| LLM | OpenRouter (OpenAI-совместимый API) |
| Семантический роутер агента | `fastembed` + ONNX `paraphrase-multilingual-MiniLM-L12-v2` (`POST /api/agent/semantic-route`), отключается `SEMANTIC_AGENT_ROUTER=0` |

**Сборка:** `frontend/dist` может отдаваться одним процессом с API (`backend/main.py`) — единый origin в production.

**Разработка:** Vite проксирует `/api` на backend (порт по умолчанию 8000). Переменные окружения — см. `.env.example` и корневой `README.md`.

---

## 3. Структура репозитория (главное)

```
prompt-engineer-agent/
├── backend/           # FastAPI: main.py, api/* — роутеры
├── frontend/          # React SPA; встроенная справка: src/docs/user/*.md
├── config/            # Лимиты, rate limit, настройки окружения
├── core/              # Классификация задач, prompt spec, context builder, парсинг ответа LLM, реестр техник, метрики
├── db/                # SQLite-менеджер, схемы таблиц
├── services/          # LLM-клиент, auth, workflow промпта, семантический роутер, каталог техник пользователя
├── techniques/        # YAML-база техник (дефолтный набор)
├── scripts/           # backup, миграции
├── docs/
│   ├── current/       # актуальная документация (people + agents)
│   ├── archive/       # история; не использовать как источник истины
│   ├── analytics/
│   └── screenshots/
```

---

## 4. Пользовательский путь: маршруты React

Оболочка: `AuthProvider` → `ThemeProvider` → `Layout` (кроме `/login`).

| Маршрут | Доступ | Назначение |
|---------|--------|------------|
| `/` | Публично | Лендинг; вход / демо |
| `/login` | Без Layout | Логин и регистрация |
| `/home` | Auth | **Студия:** классический 3-колоночный режим или режим агента (чат + генерация) |
| `/simple` | Auth | **Простой режим:** вставить готовый промпт → улучшить (пресеты + мета из настроек) |
| `/compare` | Auth | **A/B сравнение техник:** одна задача, два набора техник, опционально «судья» |
| `/library` | Auth | **Библиотека-хаб:** вкладки Промпты / Техники / Скиллы |
| `/techniques` | Auth | Редирект на `/library?tab=techniques` |
| `/workspaces` | Auth | Рабочие области (глоссарий, правила, сниппеты) |
| `/models` | Auth | Каталог OpenRouter, избранные модели из настроек |
| `/settings` | Auth | Тема, шрифты, ключ OpenRouter, классификатор задачи, простой режим |
| `/user-info` | Auth | Пользователь, trial, продуктовые метрики |
| `/help` | Auth | Встроенная справка (`frontend/src/docs/user/*.md`, импорт в `Help.tsx`) |
| `/metrics` | — | Редирект на `/user-info#product-metrics` |
| `*` | — | Редирект на `/` |

**Аутентификация:** после login в `localStorage` хранится сессия; запросы к `/api` отправляют заголовок **`X-Session-Id`**.

---

## 5. Backend: подключённые роутеры

Файл `backend/main.py` монтирует (префикс `/api`):

| Роутер | Назначение |
|--------|------------|
| `config` | Публичная конфигурация |
| `auth` | Регистрация, вход, logout, `me` |
| `settings` | Настройки пользователя (модели, тема, классификатор, simple improve) |
| `user_info` | Инфо о пользователе и usage |
| `models` | Список моделей OpenRouter |
| `workspaces` | CRUD workspace |
| `metrics` | Продуктовые метрики / события (по реализации роутера) |
| `sessions` | Сессии промптов и версии |
| `prompt_ide` | Превью спецификации без полной генерации |
| `agent` | `POST /agent/semantic-route` — намерения чата студии |
| `generate` | Основная генерация промпта |
| `simple_improve` | Улучшение текста промпта в один шаг |
| `compare` | Сравнение A/B и опционально judge |
| `library` | Библиотека сохранённых промптов |
| `techniques` | Список техник (дефолт + пользовательские), CRUD кастомных |
| `tokenizer` | Подсчёт токенов для UI |

**Health:** `GET /api/health` → `{ "status": "ok" }`.

---

## 6. Данные в SQLite (основные сущности)

Инициализация в `db/manager.py` (`init()`):

- **users** — учётные записи, хэш пароля (PBKDF2).
- **user_sessions** — сессии после login (`X-Session-Id`), TTL из настроек.
- **prompt_sessions** — логическая сессия генерации (связь с версиями промпта).
- **prompt_library** — сохранённые промпты пользователя.
- **app_events** — продуктовые события (генерации, исходы и т.д.).
- **workspaces** — профили контекста (JSON-конфиг: глоссарий, правила, сниппеты и т.д.).
- **prompt_specs** — сохранённые спецификации/снимки для аналитики и отладки.
- **user_preferences** — UI, предпочитаемые модели, **режим классификации задачи** (`heuristic` / `llm`), модель классификатора, пресеты simple improve.
- **user_techniques** — **пользовательские переопределения/дополнения** к техникам (хранятся в БД, мержатся с YAML).
- **user_usage** — учёт токенов/стоимости при использовании **общего ключа хоста** (trial).

Пользовательские ключи OpenRouter при наличии `USER_API_KEY_FERNET_SECRET` хранятся **зашифрованными** (Fernet).

---

## 7. Техники: что это и как устроено

### 7.1. Источник истины

- **Файлы:** каталог `techniques/*.yaml` — по одному файлу на технику.
- **В репозитории сейчас 13 файлов:**  
  `chain_of_thought`, `constraints_prompting`, `few_shot`, `generated_knowledge`, `least_to_most`, `meta_prompting`, `negative_prompting`, `react_prompting`, `role_prompting`, `self_consistency`, `step_back`, `structured_output`, `tree_of_thoughts`.

- **Пользовательский слой:** таблица `user_techniques`; `services/technique_catalog.get_user_registry()` строит `TechniqueRegistry` с `extra_techniques` из БД — кастомные карточки **добавляются** к дефолтным (тот же `id` может переопределяться логикой списка).

### 7.2. Схема карточки (логическая)

Типичные поля YAML: `id`, `name`, `why_it_works`, `core_pattern`, `variants[]`, `anti_patterns`, `when_to_use` (`task_types`, `complexity`, `not_for`), `compatibility`, `priority` (используется при сортировке).

### 7.3. Класс `TechniqueRegistry` (`core/technique_registry.py`)

- Загружает все `*.yaml` из `techniques/`.
- **`get_by_task_type`** — фильтр по типу задачи, сложности, `not_for`, исключения для «малых» моделей (`AVOID_ON_SMALL_MODELS`).
- **`select_techniques(task_types, complexity, max_techniques, target_model)`** — проходит по списку `task_types` из классификации, собирает кандидатов без дубликатов, сортирует (для id с подстрокой `claude` — приоритет `CLAUDE_PREFERRED`), обрезает до лимита (в генерации обычно **4**). Если пусто — **fallback** на `role_prompting`, `structured_output`, `constraints_prompting`.
- **`build_technique_context(technique_ids)`** — собирает **текст для system prompt**: название, «почему работает», шаблон / первый variant, антипаттерны (укороченно). Это основной объём токенов «техник» в запросе.

### 7.4. Таксономия целевой модели (`core/model_taxonomy.py`)

- Модель по строке id классифицируется как `reasoning` / `standard` / `small`.
- Для **reasoning** часть тяжёлых техник **не подмешивается** в авто-режиме (`SUPPRESS_FOR_REASONING` в `services/prompt_workflow.resolve_techniques`).
- Для **small** отфильтровываются техники из `AVOID_ON_SMALL_MODELS`.

---

## 8. Классификация задачи (до выбора техник)

Два режима (настройки пользователя, `user_preferences.task_classification_mode`):

1. **Эвристика** (`core/task_classifier.py`): ключевые слова → список `task_types`, эвристика `complexity` (длина текста, сигналы «сложно/просто», признаки кода). Быстро, без дополнительного вызова LLM.
2. **LLM** (`core/task_llm_classifier.py`): один запрос к модели (модель из настроек или дефолт), ответ — JSON с `task_types`, `complexity`, `confidence`. При ошибке парсинга — откат на эвристику.

Результат используется в **`resolve_techniques`** и в **`build_preview_payload`** (Prompt IDE / превью).

---

## 9. Пайплайн генерации (`POST /api/generate`)

Краткая последовательность:

1. **Проверки:** размер ввода, rate limit, бюджет генераций на сессию, наличие API-ключа (серверный или пользовательский), trial-лимиты при общем ключе.
2. **Workspace** (если передан `workspace_id`) — загрузка и нормализация профиля.
3. **Классификация задачи** — см. §8.
4. **`build_preview_payload`** (`services/prompt_workflow.py`):  
   - `resolve_techniques` (ручной режим техник или авто);  
   - сборка **prompt_spec** (цель, формат, ограничения и т.д.);  
   - **evidence** и **debug_issues** для IDE;  
   - **intent_graph**.
5. Сохранение **prompt_spec** в БД (событие/запись сессии).
6. Повторный **`resolve_techniques`** для финального списка (в т.ч. `max_techniques=4`). Опционально **домен** (`req.domain`): если не `auto` и не ручные техники — подмена набора через `core/domain_templates.get_domain_techniques`.
7. **`build_generation_brief`** + ответы на уточняющие вопросы + feedback итерации → **user content**.
8. **`ContextBuilder.build_system_prompt`** — базовый системный промпт, блок подсказек **целевой модели** (`core/target_model_cards.py`), при необходимости доменный чеклист, режим вопросов, **активные техники** (полный контекст карточек).
9. **Стриминг** ответа LLM (`services/llm_client`), сбор полного текста.
10. **Парсинг:** `core/parsing` — извлечение `[REASONING]`, `[QUESTIONS]`, `[PROMPT]`; диагностика формата; метрики качества промпта (`core/quality_metrics`).
11. **Сохранение версии** промпта в БД при успешном `[PROMPT]`; логирование событий; возврат клиенту полей: техники, метрики, spec, evidence, `session_id`, флаги проблем генерации.

**Автоматизация на этом этапе:** классификация → подбор техник → сбор system/user контента → один вызов генерации → парсинг и учёт метрик.

---

## 10. Prompt IDE (превью без полной генерации)

- Эндпоинт **`/api/prompt-ide/preview`** (`backend/api/prompt_ide.py`, логика в `services/prompt_workflow.build_preview_payload` и связанных модулях).
- Даёт структурированное превью спецификации и связанных артефактов **до** или **параллельно** с основным потоком на клиенте (на Home — блок «Разбор задачи»).

---

## 11. Простой режим (`/api/simple-improve`)

- Отдельный сценарий: пользователь вставляет **уже готовый промпт**.
- Не проходит полная цепочка техник как в Studio; используется **`simple_improve`** с пресетами и опциональным мета-промптом из настроек.
- Подходит для быстрого «отполировать текст» без task classification / библиотеки техник в том же виде, что у основной генерации.

---

## 12. Compare (A/B техник)

- **`POST /api/compare`:** одна задача, общая классификация (`classify_task`), два набора техник.  
  - Ручной режим — явные списки id.  
  - Авто — `registry.select_techniques` с пулом кандидатов, для B исключаются id A, чтобы наборы разошлись; иначе ошибка 400 «identical technique sets».
- Два последовательных стрим-прохода с разными `build_system_prompt`.
- Опционально **`/api/compare/judge`** — третий вызов LLM как «судья» для сравнения двух промптов.

---

## 13. Библиотека и техники в UI

- **`/library`** = `LibraryHub`: три вкладки — **Промпты**, **Техники**, **Скиллы**.
- **Промпты:** серверная библиотека (`/api/library`), поиск, теги, сохранение из студии.
- **Техники:** встроенный каталог (`Techniques.tsx`), те же данные что `/api/techniques` — дефолтные YAML + пользовательские записи из БД; создание/редактирование кастомных карточек.
- **Скиллы:** **`frontend` only** — `localStorage` ключ `prompt-engineer-skills-v1`, структура «заголовок, описание, теги, body». **Не участвуют** в `/generate` на backend; это локальная записная книжка шаблонов. Счётчик в сайдбаре читает длину массива из `localStorage`.

---

## 14. Workspaces

- API: `backend/api/workspaces.py`, хранение в таблице **workspaces**.
- Конфиг может включать: предпочитаемую целевую модель, глоссарий, правила стиля, ограничения по умолчанию, reference snippets.
- На Home workspace подмешивается в спецификацию и контекст генерации; выбор сохраняется в `localStorage` (`prompt-engineer-active-workspace`), синхронизируется с сайдбаром через событие `metaprompt-workspace`.

---

## 15. Студия на Home: классика vs агент

Файл: `frontend/src/pages/Home.tsx` (крупная страница).

### 15.1. Классический режим

- Три колонки (splittable): **Задача** | **Разбор (Prompt IDE / spec)** | **Результат** (промпт, вопросы, сырой fallback).
- Переключатель режима агента — отдельная кнопка в заголовке «Задача».

### 15.2. Режим агента

- Чат слева, генерация/промпт справа (свой split).
- Черновик чата и полей хранится в **`agentDraft`** (localStorage) — восстановление при возврате.
- **`conversationalGate.ts`:** решает, считать ли сообщение «болтовнёй» (без вызова генерации) или задачей на промпт — по маркерам и эвристикам.
- **`agentPlanResolver` / follow-up:** после появления промпта — намерения: итерация, сохранение в библиотеку, навигация, «оцени промпт» и т.д.
- **Семантический роутер:** `POST /api/agent/semantic-route` — эмбеддинги и косинус к центроидам примеров; при низкой уверенности клиент использует **rule-based** fallback (`semantic_agent_router.py`, пороги в `config/settings.py`).

**Автоматизация:** маршрутизация намерений + при явной задаче — тот же `/generate`, что и в классике (с передачей контекста чата по логике клиента).

---

## 16. Настройки (существенное для поведения)

- Предпочитаемые модели **генерации** и **целевых** моделей (списки id OpenRouter).
- **Классификация задачи:** heuristic vs LLM, модель классификатора.
- **Простой режим:** пресет (`simple_improve_preset`), дополнительный мета-текст (`simple_improve_meta`).
- Тема, шрифты — UI.

---

## 17. Ограничения и злоупотребления

- Rate limit на IP/сессию, лимит длины ввода (`MAX_INPUT_CHARS`).
- Лимит генераций на auth-сессию (`BUDGET_GENERATIONS_PER_SESSION`).
- Trial: потолок токенов и верхняя цена completion за 1M токенов при использовании ключа хоста.

---

## 18. Связь компонентов (схема)

```
Пользователь (React)
    → X-Session-Id + JSON
        → FastAPI роутер
            → get_current_user / DB
            → TechniqueRegistry (YAML + user_techniques)
            → classify_task | classify_task_with_llm
            → resolve_techniques → build_system_prompt + build_user_content
            → LLMClient.stream → OpenRouter
            → parse_reply / metrics / save_prompt_version / events
    ← JSON (промпт, вопросы, техники, метрики, session_id, …)
```

---

## 19. Исторические материалы

- Снимки прошлых решений и контуров UI — в [`docs/archive/`](../archive/README.md); не использовать как источник истины о текущем продукте.

---

## 20. Ключевые файлы для чтения кода

| Область | Файлы |
|---------|--------|
| Генерация | `backend/api/generate.py`, `services/prompt_workflow.py`, `services/llm_client.py` |
| Техники | `core/technique_registry.py`, `techniques/*.yaml`, `services/technique_catalog.py`, `backend/api/techniques.py` |
| Контекст LLM | `core/context_builder.py`, `core/target_model_cards.py`, `core/domain_templates.py` |
| Классификация | `core/task_classifier.py`, `core/task_llm_classifier.py` |
| Парсинг ответа | `core/parsing.py`, `core/quality_metrics.py` |
| Сессии и библиотека | `backend/api/sessions.py`, `backend/api/library.py`, `db/manager.py` |
| Фронт студии | `frontend/src/pages/Home.tsx`, `frontend/src/lib/conversationalGate.ts`, `frontend/src/lib/agentPlanResolver.ts` |
| Семантика агента | `backend/api/agent_route.py`, `services/semantic_agent_router.py` |

---

## 21. Дополнения (UX / продукт)

- На **лендинге** карточка сравнения описывает **A/B техник** (одна задача, одна модель генерации), а не «несколько моделей».
- На **Home** при первом визите показывается сворачиваемая подсказка «Студия vs простой режим» (ключ `localStorage`: `metaprompt-home-tip-v1-dismissed`).
- В **простом режиме** после улучшения доступно **построчное сравнение** исходного и результата (LCS по строкам, без внешних зависимостей).
- Кнопка «В чат» у промпта открывает меню: **ChatGPT, Claude, Grok, Gemini** — полный текст копируется в буфер, открывается сайт; для части сервисов в URL добавляется укороченный `?q=` (см. `frontend/src/lib/externalChatProviders.ts`).

---

*Документ сгенерирован как снимок архитектуры репозитория; при смене кода отдельные детали (имена полей, лимиты) сверяйте с актуальными файлами и `README.md`.*

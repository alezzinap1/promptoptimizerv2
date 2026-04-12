# Image Pipeline & Studio UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить фото-режим (язык вопросов, учёт пресета стиля, UI), добавить пробную генерацию через дешёвую OpenRouter image-модель (Nano Banana: `google/gemini-3.1-flash-image-preview`), сохранение превью в библиотеку, LLM-оценку промпта, улучшить сообщество и внешние чаты, обновить дефолтные модели уровней.

**Architecture:** Единый каталог стилей: `frontend/public/image-styles/manifest.json` подхватывается в `core/image_presets.get_image_preset` как `raw_text` для блока ACTIVE STYLE PRESET. Политика контекста и repair-pass вопросов учитывают русский язык задачи (`generate._context_policy_block`, расширенный `contract_user`). Проба картинки: `POST /api/image/try` → `services/openrouter_image.generate_image_data_url` (OpenRouter `extra_body`: modalities + image_config). Превью пишется в `data/uploads/library_previews/*.webp`, путь в `prompt_library.cover_image_path`. Оценка: `POST /api/library/llm-review`.

**Tech Stack:** FastAPI, OpenAI Python SDK + OpenRouter, React/TS, SQLite migrations в `db/manager.py`, Pillow.

---

## File map (сделано в этой итерации)

| Файл | Назначение |
|------|------------|
| `core/image_presets.py` | Fallback пресетов из `manifest.json` по `id` |
| `backend/api/generate.py` | RU/EN CONTEXT POLICY; repair-pass с пресетом и языком |
| `prompts/backend/image_questions_rules.txt` | Не спрашивать стиль при ACTIVE PRESET; язык задачи |
| `prompts/backend/questions_contract_image_system.txt` | Язык вопросов = язык задачи |
| `services/openrouter_image.py` | Вызов OpenRouter image completions |
| `backend/api/image_try.py` | `POST /image/try`, сохранение webp превью |
| `backend/main.py` | Роутер `image_try` |
| `services/llm_client.py` | `nano_banana` → `google/gemini-3.1-flash-image-preview` |
| `backend/api/library.py` | `cover_image_path`, `POST /library/llm-review` |
| `db/manager.py` | Миграция `cover_image_path`, save/update |
| `backend/image_utils.py` | `COMMUNITY_CARD_SIZE` 512 для загрузок сообщества |
| `frontend/...` | Home toolbar, проба картинки, LLM-модалка, библиотека, внешние чаты |
| `frontend/src/lib/expertLevelPresets.ts` | Mid/Senior/Creative → Gemini 2.5 / GPT-4o mini |
| `tests/test_image_preset_manifest.py` | Регрессия `pixel_art` |

---

### Task 1: Проверка OpenRouter id моделей

**Files:**
- Modify: `frontend/src/lib/expertLevelPresets.ts`
- Modify: `services/llm_client.py` (при необходимости)

- [ ] **Step 1:** Открыть [OpenRouter models](https://openrouter.ai/models) и убедиться, что существуют id: `google/gemini-2.5-flash-lite`, `google/gemini-2.5-flash` (или заменить на актуальные с тем же ценовым классом).

- [ ] **Step 2:** При расхождении — обновить `EXPERT_DEFAULT_GEN_MODEL` и задокументировать в `frontend/src/docs/user/EXPERT_LEVELS_AND_GENERATION_MODELS.md`.

- [ ] **Step 3:** Commit.

---

### Task 2: E2E пробы картинки с пользовательским ключом

**Files:**
- Manual: настройки приложения, OpenRouter ключ

- [ ] **Step 1:** Запустить бэкенд и фронт; в image-режиме сгенерировать промпт, нажать «Проба картинки».

- [ ] **Step 2:** Убедиться в ответе с `image_url` (data URL) и при успехе — в файле под `data/uploads/library_previews/`.

- [ ] **Step 3:** Сохранить в библиотеку и открыть `/library` — видно превью.

---

### Task 3: Расширенные описания стилей (продуктовое)

**Files:**
- Modify: `frontend/public/image-styles/manifest.json` (поле `adaptation` или новое поле `style_brief_ru`)

- [ ] **Step 1:** Для каждого id добавить 2–4 предложения профессионального описания (свет, палитра, типичные негативы, линзы/камера где уместно), не только короткий adaptation.

- [ ] **Step 2:** При необходимости в `format_active_style_preset_system_block` подмешивать новое поле.

- [ ] **Step 3:** Commit.

---

### Task 4: Документация API

**Files:**
- Modify: `README.md` или `frontend/src/docs/user/EXPERT_LEVELS_AND_GENERATION_MODELS.md`

- [ ] **Step 1:** Описать `POST /api/image/try` (тело, ответ, env `IMAGE_TRY_MODEL`).

- [ ] **Step 2:** Описать `POST /api/library/llm-review`.

- [ ] **Step 3:** Commit.

---

## Self-review (план vs реализация)

| Требование | Задача в плане / коде |
|------------|------------------------|
| Вопросы на русском | `generate._context_policy_block`, contract_user, правила в prompts |
| Пресет стиля известен модели | manifest + `get_image_preset`, repair-pass `preset_extra` |
| «Песочница» обрезка | `toolbarTextBtn` для текста; для фото — отдельная кнопка пробы |
| Проба дешёвой image + либа | `/image/try`, `cover_image_path`, UI |
| Кнопка библиотеки заметнее | текст «В библиотеку» в тулбаре |
| Убрать устаревшую спецификацию | заменено на «Оценка модели (LLM-судья)» |
| Модели уровней 2026 | `expertLevelPresets` — проверить id (Task 1) |
| Больше «В чат» | `externalChatProviders` +7 сервисов |
| Сообщество качество картинки | 512 webp + больший hero в CSS |
| Сильнее стиль в промпте | manifest sync; полное расширение — Task 3 |

**Plan complete and saved to `docs/superpowers/plans/2026-04-12-image-pipeline-ux.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — отдельный субагент на задачу, ревью между задачами.

**2. Inline Execution** — выполнять чеклисты в этой сессии через executing-plans, пакетами с чекпоинтами.

**Which approach?**

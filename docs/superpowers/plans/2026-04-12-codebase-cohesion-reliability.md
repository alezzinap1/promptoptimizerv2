# Codebase cohesion, reliability & dev-velocity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Инкрементально (**вариант A**) усилить **D** и **B** по спецификации [`../specs/2026-04-12-codebase-cohesion-reliability-design.md`](../specs/2026-04-12-codebase-cohesion-reliability-design.md): убрать **весь активный хвост Streamlit** (код и актуальные доки), синхронизировать README/дерево каталогов, добавить политику слоёв и smoke-тест API. **Streamlit не поддерживается** — не оставлять формулировок «архивный, но запускай».

**Architecture (исполнение):** маленькие PR по задачам ниже. **Точечный рефакторинг «тонких мест»** — только когда уже правишь файл/модуль и видишь очевидную проблему (дубль, перегруженный хендлер) **в том же или следующем крошечном PR**; без отдельного «большого взрыва».

**Tech Stack:** Python 3.x, FastAPI, `pytest` / `unittest`, PowerShell, `rg` при наличии.

---

## Ожидаемые артефакты и файлы

| Файл | Роль |
|------|------|
| `docs/superpowers/audit/2026-04-12-discovery-inventory.md` | Результаты Discovery (в т.ч. полный список вхождений Streamlit вне `docs/archive/`) |
| `docs/current/LAYER_POLICY.md` | Политика слоёв; стек без Streamlit |
| `config/__init__.py` | Докстринг без Streamlit |
| `services/llm_client.py` | Модульный/классовый/метод `stream` — без Streamlit и `st.write_stream` |
| `services/auth_service.py` | Докстринг: только FastAPI / общие хелперы |
| `core/__init__.py`, `core/parsing.py` | Комментарии без Streamlit и `app/` |
| `README.md` | Нет `app/` в дереве, нет секции запуска Streamlit |
| `docs/current/*.md` (см. Task 5) | Актуальные формулировки без Streamlit как живого контура |
| `docs/user/PROJECT_FULL_REPORT.md` | Раздел про UI без Streamlit/`app/` |
| `docs/archive/README.md` | Явный дисклеймер: материалы исторические, Streamlit не поддерживается |
| `tests/test_api_health.py` | Smoke `GET /api/health` |

`requirements.txt` уже **без** `streamlit` — зависимость не добавлять.

---

### Task 1: Discovery — инвентаризация и чеклист вычистки

**Files:**
- Create: `docs/superpowers/audit/2026-04-12-discovery-inventory.md`
- Test: не применимо

- [ ] **Step 1: Проверить наличие `app/`**

```powershell
Set-Location "c:\Users\AstraA\PycharmProjects\prompt-engineer-agent"
Test-Path .\app
Get-ChildItem -Path .\app -ErrorAction SilentlyContinue | Select-Object -First 30 Name
```

- [ ] **Step 2: Полный список вхождений `streamlit` вне архива**

```powershell
rg -i "streamlit" --glob "!docs/archive/**" --glob "!**/node_modules/**" --glob "!docs/superpowers/**"
```

(Папку `docs/superpowers/` при повторном прогоне можно исключить, чтобы не ловить сам план; главное — **код и актуальные доки**.)

Fallback без `rg`:

```powershell
Get-ChildItem -Recurse -Include *.py,*.md -File |
  Where-Object { $_.FullName -notmatch '\\docs\\archive\\' } |
  Select-String -Pattern "streamlit" -CaseSensitive:$false |
  ForEach-Object { "$($_.Path):$($_.LineNumber):$($_.Line.Trim())" }
```

- [ ] **Step 3: Заполнить `docs/superpowers/audit/2026-04-12-discovery-inventory.md`**

Структура:

```markdown
# Discovery inventory — 2026-04-12

## `app/` directory
- Exists: <True|False>
- Notes: <…>

## Streamlit references outside `docs/archive/` (to remove or rewrite)
| Path | Line | Action |
|------|------|--------|
| … | … | remove / rewrite to neutral |

## Thin-spot candidates (optional follow-up)
- <file>: <one-line note>
```

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/audit/2026-04-12-discovery-inventory.md
git commit -m "docs: discovery inventory for Streamlit purge and cohesion audit"
```

---

### Task 2: Политика слоёв (без Streamlit)

**Files:**
- Create: `docs/current/LAYER_POLICY.md`

- [ ] **Step 1: Создать файл** с содержимым:

```markdown
# Политика слоёв репозитория

Каноничный продукт: **FastAPI** (`backend/`) + **React SPA** (`frontend/`). Отдельный UI на Streamlit **не поддерживается** и не входит в контур разработки.

## Разрешённые зависимости (импорты)

- `backend/api/*` → `core`, `services`, `db`, `config`.
- `core/*` — без FastAPI-типов в новом коде; без импортов из `backend`.
- `services/*` → `core`, `config`, внешние SDK.
- `db/*` → `config`, драйверы БД.

## Исключения

Существующие нарушения снимаются инкрементальными PR; новые не вводить без обоснования в ревью.

## Проверка в PR

Автор перечисляет затронутые модули и подтверждает соответствие политике или называет исключение.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/current/LAYER_POLICY.md
git commit -m "docs: layer policy; stack without Streamlit"
```

---

### Task 3: Вычистка Streamlit из Python (один маленький PR)

**Files:**
- Modify: `config/__init__.py`, `services/llm_client.py`, `services/auth_service.py`, `core/__init__.py`, `core/parsing.py`
- Test: `pytest tests/test_parsing.py tests/test_db_manager.py -q`

- [ ] **Step 1: `config/__init__.py`** — заменить модульный докстринг на:

```python
"""
Shared configuration for the Prompt Optimizer stack: FastAPI backend, core domain logic, and scripts.
"""
```

- [ ] **Step 2: `services/auth_service.py`** — заменить первую строку докстринга на:

```python
"""
Auth helpers used by the FastAPI backend and shared user/session flows.
"""
```

- [ ] **Step 3: `services/llm_client.py`** — обновить верхний докстринг (первые строки до `Примечание`):

  - Убрать «Streamlit», `st.write_stream`.
  - Смысл: синхронный OpenAI-клиент под OpenRouter; стриминг — итератор чанков для любых потребителей (в т.ч. SSE/HTTP в FastAPI).

  Пример формулировок:

 - Вместо `Uses synchronous OpenAI SDK for Streamlit compatibility.` → `Uses the synchronous OpenAI SDK (blocking calls; suitable for sync call sites and streaming via chunk iterator).`
  - Вместо `Supports streaming for st.write_stream integration.` → `Streaming yields text chunks for consumers that iterate over tokens (e.g. API streaming endpoints).`

- [ ] **Step 4: `services/llm_client.py` — класс `LLMClient`** — докстринг класса: вместо `for Streamlit compatibility` → `for synchronous call sites (no async event loop required).`

- [ ] **Step 5: `services/llm_client.py` — метод `stream`** — докстринг метода: убрать `Compatible with Streamlit's st.write_stream().` → например `Yields text chunks for streaming HTTP responses or other consumers.`

- [ ] **Step 6: `core/__init__.py`** — комментарий в первой строке: убрать упоминание Streamlit/`app/`; оставить FastAPI + React как единственные поверхности.

- [ ] **Step 7: `core/parsing.py`** — шапка: убрать «archived Streamlit UI (`app/`)»; указать, что модуль разделяется между **FastAPI** и другими внутренними потребителями (без UI-фреймворка).

- [ ] **Step 8: Регрессия**

```powershell
pytest tests/test_parsing.py tests/test_db_manager.py -q
```

- [ ] **Step 9: Commit**

```powershell
git add config/__init__.py services/llm_client.py services/auth_service.py core/__init__.py core/parsing.py
git commit -m "chore: remove Streamlit-oriented wording from core and services"
```

---

### Task 4: Smoke-тест — `GET /api/health`

**Files:**
- Create: `tests/test_api_health.py`

- [ ] **Step 1: Создать файл**

```python
from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from backend.main import app


class ApiHealthTests(unittest.TestCase):
    def test_api_health_returns_ok(self) -> None:
        client = TestClient(app)
        response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запуск**

```powershell
pytest tests/test_api_health.py -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add tests/test_api_health.py
git commit -m "test: add API health smoke test for mounted /api"
```

---

### Task 5: README и актуальные доки — без Streamlit и `app/`

**Files:**
- Modify: `README.md`, перечисленные `docs/current/*.md`, `docs/user/PROJECT_FULL_REPORT.md`
- Test: `pytest tests/test_api_health.py tests/test_db_manager.py tests/test_parsing.py -q`

- [ ] **Step 1: `README.md`**
  - В блоке «Основные директории» **удалить** строку `└── app/               # Streamlit (архив)`.
  - **Удалить целиком** секцию `## Streamlit (архив)` (команды `streamlit run`, health-сервер, ссылка на запуск).
  - В абзаце про архив в `docs/` можно оставить формулировку вроде: исторические материалы (включая снимки эпохи до SPA) — в `docs/archive/`, **без** инструкций по запуску устаревшего UI.
  - Первый абзац продукта: не описывать Streamlit как доступный вариант; только **FastAPI + React**.

- [ ] **Step 2: `docs/current/IMPROVEMENT_PLAN.md`** — вводный абзац: убрать «Streamlit (`app/`) — архив»; заменить на то, что единственный UI — web (React), legacy Streamlit не поддерживается. Пункт про version history vs Streamlit сформулировать как «исторический UX» или переформулировать без обязательной отсылки к Streamlit, если контекст позволяет.

- [ ] **Step 3: `docs/current/PRODUCTION_CHECKLIST.md`** — убрать предложение про Streamlit как несущий контур.

- [ ] **Step 4: `docs/current/PRODUCT_VISION.md`** — заменить пункт про «единственный UI на Streamlit» на актуальное утверждение: один продуктовый UI — React SPA.

- [ ] **Step 5: `docs/current/PROMPT_IDE_ARCHITECTURE.md`** — убрать или переписать строки про `app/Home.py` / Streamlit-страницы; указать, что эталон — React.

- [ ] **Step 6: `docs/current/PORTFOLIO_CASE.md`** — narrative про demo-shell на Streamlit сжать до **исторической** роли или убрать, если документ про текущий кейс; не создавать впечатление, что Streamlit сопровождается.

- [ ] **Step 7: `docs/user/PROJECT_FULL_REPORT.md`** — дерево репозитория и § про архив Streamlit: убрать `app/` как часть дерева; описать только FastAPI + React; историю при желании отослать к `docs/archive/`.

- [ ] **Step 8: Регрессия тестов**

```powershell
pytest tests/test_api_health.py tests/test_db_manager.py tests/test_parsing.py -q
```

- [ ] **Step 9: Commit**

```powershell
git add README.md docs/current/IMPROVEMENT_PLAN.md docs/current/PRODUCTION_CHECKLIST.md docs/current/PRODUCT_VISION.md docs/current/PROMPT_IDE_ARCHITECTURE.md docs/current/PORTFOLIO_CASE.md docs/user/PROJECT_FULL_REPORT.md
git commit -m "docs: remove Streamlit as supported surface from README and current docs"
```

(Если какой-то файл не менялся — убрать из `git add`.)

---

### Task 6: Дисклеймер в индексе архива

**Files:**
- Modify: `docs/archive/README.md`

- [ ] **Step 1: В начало файла** добавить короткий блок:

```markdown
> **Устаревший контур.** Документы ниже описывают прошлые решения (в т.ч. эпоху отдельного UI на Streamlit). **Streamlit не поддерживается**; каноничный продукт — FastAPI + React (`README.md`, `docs/current/`).
```

- [ ] **Step 2: Commit**

```powershell
git add docs/archive/README.md
git commit -m "docs: archive index disclaimer for unsupported Streamlit era"
```

---

### Task 7 (опционально, в рамках A): «Тонкие места» в затронутом коде

**Правило:** не открывать отдельный mega-PR. Если при Task 3–5 видно **очевидное** дублирование или 300+ строк в одном хендлере **в том же файле**, который уже редактируешь:

- вынести 1 функцию в `core/` или локальный helper **с тестом**, если логика нетривиальна;
- или оставить одну строку в `discovery-inventory.md` как follow-up.

- [ ] **Step 1: Либо «ничего не делаем в этом спринте»**, либо один микро-коммит с пометкой `refactor:` и узкой областью.

---

## Self-review (план ↔ спека)

1. **Подход A:** все задачи — отдельные небольшие коммиты/PR.  
2. **Streamlit:** активный код и актуальные доки — вычистка в Task 3 и 5; архив — дисклеймер в Task 6, **без** удаления исторических MD (по умолчанию).  
3. **Тонкие места:** Task 7 явно ограничен.  
4. **Плейсхолдеры:** нет «TBD» в шагах — пути файлов заданы.

---

## Execution handoff

**План:** `docs/superpowers/plans/2026-04-12-codebase-cohesion-reliability.md`.

1. **Subagent-Driven** — по задаче отдельный прогон.  
2. **Inline** — executing-plans с чекпоинтами.

После всех задач: полный `pytest`; при изменениях во `frontend/` — `npm run build`.

# Codebase cohesion, reliability & dev-velocity audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выполнить поэтапный аудит и зачистку репозитория по спецификации [`../specs/2026-04-12-codebase-cohesion-reliability-design.md`](../specs/2026-04-12-codebase-cohesion-reliability-design.md), с фокусом на **D** (надёжность, тесты, меньше наследия) и **B** (ясные границы модулей, меньше шума в доках и комментариях).

**Architecture:** Фаза **Discovery** фиксирует факты (дерево `app/`, вхождения Streamlit, крупные файлы). Фаза **Policy** добавляет короткий документ политики слоёв. Фаза **Guardrails** вводит минимальный API smoke-тест. Фаза **Docs/code sync** выравнивает комментарии и README с каноном FastAPI+React.

**Tech Stack:** Python 3.x, FastAPI, `pytest` / `unittest` (в репо уже есть `unittest`-стиль в `tests/`), PowerShell на Windows, `rg` (ripgrep) если установлен.

---

## Файлы плана (ожидаемые)

| Файл | Роль |
|------|------|
| `docs/superpowers/audit/2026-04-12-discovery-inventory.md` | Артефакт Discovery (создать) |
| `docs/current/LAYER_POLICY.md` | Политика импортов и слоёв (создать) |
| `config/__init__.py` | Уточнить докстринг (модифицировать) |
| `services/llm_client.py` | Уточнить комментарии про «Streamlit» (модифицировать) |
| `core/parsing.py` | Уточнить шапку модуля при необходимости (модифицировать) |
| `README.md` | Синхронизировать описание `app/` с фактом на диске (модифицировать при расхождении) |
| `tests/test_api_health.py` | Smoke-тест mounted API (создать) |

---

### Task 1: Discovery — инвентаризация наследия и несоответствий док ↔ дерево

**Files:**
- Create: `docs/superpowers/audit/2026-04-12-discovery-inventory.md`
- Modify: (нет до фиксации фактов)
- Test: не применимо

- [ ] **Step 1: Проверить наличие каталога `app/`**

Run (PowerShell, из корня репозитория):

```powershell
Set-Location "c:\Users\AstraA\PycharmProjects\prompt-engineer-agent"
Test-Path .\app
Get-ChildItem -Path .\app -ErrorAction SilentlyContinue | Select-Object -First 20 Name
```

Expected: булево `True` или `False`; при `True` — список имён; при `False` — пустой вывод без ошибки.

- [ ] **Step 2: Найти вхождения Streamlit / архивного UI вне `docs/archive/`**

Run:

```powershell
rg -i "streamlit" --glob "!docs/archive/**" --glob "!**/node_modules/**"
```

Expected: список путей (может включать `README.md`, `config/__init__.py`, `services/llm_client.py`, `core/parsing.py`). Если `rg` не установлен, использовать поиск IDE или:

```powershell
Get-ChildItem -Recurse -Include *.py,*.md -File |
  Where-Object { $_.FullName -notmatch '\\docs\\archive\\' } |
  Select-String -Pattern "streamlit" -CaseSensitive:$false |
  Select-Object -First 40 Path, LineNumber, Line
```

- [ ] **Step 3: Записать инвентаризацию в markdown**

Create `docs/superpowers/audit/2026-04-12-discovery-inventory.md` with this structure (заполнить фактическими результатами шагов 1–2):

```markdown
# Discovery inventory — 2026-04-12

## `app/` directory- Exists: <True|False>
- Notes: <what was found>

## Non-archive references to Streamlit / legacy UI
| Path | Line | Snippet |
|------|------|---------|
| ... | ... | ... |

## Recommended classification (initial)
- <file>: keep / update docstring / remove / move to docs/archive
```

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/audit/2026-04-12-discovery-inventory.md
git commit -m "docs: add discovery inventory for cohesion audit"
```

---

### Task 2: Политика слоёв (документ для PR и ревью)

**Files:**
- Create: `docs/current/LAYER_POLICY.md`
- Modify: none
- Test: не применимо

- [ ] **Step 1: Создать документ политики**

Create `docs/current/LAYER_POLICY.md` with the following full content (при необходимости после ревью можно уточнить исключения списком):

```markdown
# Политика слоёв репозитория

Каноничный продукт: **FastAPI** (`backend/`) + **React SPA** (`frontend/`).

## Разрешённые зависимости (импорты)

- `backend/api/*` может импортировать `core`, `services`, `db`, `config`.
- `core/*` не должен импортировать FastAPI-типы в новом коде; избегать прямых импортов из `backend`.
- `services/*` может импортировать `core`, `config`, внешние SDK.
- `db/*` может импортировать `config` и драйверы БД.

## Исключения

Существующие нарушения фиксируются в PR рефакторинга; новые нарушения не вводить без явного обоснования в ревью.

## Проверка в PR

Автор перечисляет затронутые модули и подтверждает соответствие политике или называет исключение.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/current/LAYER_POLICY.md
git commit -m "docs: add layer import policy for backend/core/services"
```

---

### Task 3: Выровнять докстринги конфигурации и LLM-клиента с каноном

**Files:**
- Modify: `config/__init__.py`, `services/llm_client.py`
- Test: `pytest tests/test_db_manager.py -q` (быстрая регрессия: конфиг тянет тот же модуль)

- [ ] **Step 1: Обновить `config/__init__.py`**

Replace the first4 lines (module docstring) with:

```python
"""
Shared configuration for the Prompt Optimizer stack: FastAPI backend, core logic, and scripts.

Primary user interface is the React SPA; any archived Streamlit tree is not the main development surface (see root README).
"""
```

Keep all remaining imports and `__all__` unchanged below the docstring.

- [ ] **Step 2: Обновить шапку `services/llm_client.py`**

Locate the module docstring / opening comments that state Streamlit compatibility. Replace that sentence with wording equivalent to:

```text
Synchronous OpenAI-compatible client for callers that require a blocking API (e.g. legacy scripts or non-async contexts); not tied to a specific UI framework.
```

(Implement as a single-line or multi-line comment/docstring consistent with the file’s current style.)

- [ ] **Step 3: Регрессия**

Run:

```powershell
Set-Location "c:\Users\AstraA\PycharmProjects\prompt-engineer-agent"
pytest tests/test_db_manager.py -q
```

Expected: all passed (or same count as on main before edits).

- [ ] **Step 4: Commit**

```powershell
git add config/__init__.py services/llm_client.py
git commit -m "docs: clarify config and llm_client docs for non-Streamlit canon"
```

---

### Task 4: Smoke-тест HTTP — `GET /api/health`

**Files:**
- Create: `tests/test_api_health.py`
- Modify: none
- Test: новый файл

- [ ] **Step 1: Добавить smoke-тест (маршрут `/api/health` уже реализован — ожидается PASS с первого запуска)**

Create `tests/test_api_health.py`:

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

- [ ] **Step 2: Запустить тест**

Run:

```powershell
pytest tests/test_api_health.py -v
```

Expected: **PASS** (маршрут уже есть в `backend/main.py`).

- [ ] **Step 3: Commit**

```powershell
git add tests/test_api_health.py
git commit -m "test: add API health smoke test for mounted /api"
```

---

### Task 5: Синхронизировать `README.md` с фактом наличия `app/`

**Files:**
- Modify: `README.md`
- Test: `pytest tests/test_api_health.py tests/test_db_manager.py -q`

- [ ] **Step 1: Сверить с Discovery**

Open `docs/superpowers/audit/2026-04-12-discovery-inventory.md`. If `app/` **does not exist**, adjust the README section that claims `app/` as the Streamlit archive so it matches reality (например: указать, что архивный UI удалён из дерева или вынесен, и сослаться на `docs/archive/` для истории). If `app/` **exists**, оставить структуру как есть или уточнить только при несоответствии.

Конкретный текст правки зависит от результата Task 1 — **не оставлять** противоречие «в README есть `app/`, на диске каталога нет».

- [ ] **Step 2: Регрессия тестов**

Run:

```powershell
pytest tests/test_api_health.py tests/test_db_manager.py -q
```

Expected: all passed.

- [ ] **Step 3: Commit**

```powershell
git add README.md
git commit -m "docs: align README with actual app/ tree per discovery"
```

---

### Task 6 (опционально): `core/parsing.py` — шапка модуля

**Files:**
- Modify: `core/parsing.py` (только докстринг вверху файла)
- Test: `pytest tests/test_parsing.py -q`

- [ ] **Step 1: Если в шапке явно «архивный Streamlit»**

Replace with a neutral line: primary consumers are FastAPI backend and any CLI/scripts; archived UI is not a dependency for core behavior.

- [ ] **Step 2: `pytest tests/test_parsing.py -q`**

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add core/parsing.py
git commit -m "docs: neutralize parsing module header vs archived UI"
```

---

## Self-review (план ↔ спека)

1. **Покрытие спеки:** цели D+B отражены в Task 1–4–5–6 (наследие, тесты, доки); политика слоёв — Task 2; границы `backend/core/services` — таблица в спеке и `LAYER_POLICY.md`.
2. **Плейсхолдеры:** единственная вариативная часть — точная формулировка README в Task 5, зависящая от факта Discovery; это явно указано.
3. **Согласованность типов:** N/A (нет новых публичных API).

---

## Execution handoff

**План сохранён в** `docs/superpowers/plans/2026-04-12-codebase-cohesion-reliability.md`.

**Два варианта выполнения:**

1. **Subagent-Driven (рекомендуется)** — отдельный субагент на задачу, ревью между задачами.  
2. **Inline Execution** — выполнение в этой сессии через executing-plans с чекпоинтами.

**Какой вариант выбираешь?** (После завершения всех задач прогнать полный `pytest` и при необходимости `npm run build` во `frontend/`.)

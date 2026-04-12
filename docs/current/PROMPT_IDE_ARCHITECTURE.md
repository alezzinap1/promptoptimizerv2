# Prompt IDE Architecture

## Что уже внедрено

Продукт больше не ограничен только `task_input -> prompt`. В коде и в React UI есть первый слой **Prompt IDE** вокруг `PromptSpec`, evidence и rule-based отладки.

## Основные сущности

### Workspace

Reusable контекст: glossary, style rules, default constraints, reference snippets, preferred target model. Пользователь работает внутри профиля, а не в пустом поле.

### PromptSpec

Структурированное представление задачи (`core/prompt_spec.py`): goal, task_types, complexity, target_model, workspace, output_format, constraints, success_criteria, source_of_truth, previous_prompt и др.

### Evidence (Evidence-Bound Prompting)

Происхождение полей spec (`core/evidence.py`): `user`, `workspace`, `inferred` / `assumed`, `missing`. Для `inferred` и `workspace` — **Принять** / **Отклонить**; отклонённые поля не попадают в генерацию.

### Prompt Debugger

Rule-based слой (`core/prompt_debugger.py`): structural issues — слабое grounding, конфликты инструкций, размытая цель, несоответствие модели, пробелы надёжности и т.д.

## Где это в UI (React)

- **Студия (Home):** `frontend/src/pages/Home.tsx` — выбор workspace, панели разбора задачи (spec / intent / debugger / evidence), сохранение spec при генерации.
- **Workspaces:** `frontend/src/pages/Workspaces.tsx` (и связанные компоненты) — CRUD профилей.

Эталон UX и дальнейшее развитие — только **React** (`Home`, `Workspaces` и связанные страницы).

## Где в backend / core

- `core/prompt_spec.py`, `core/evidence.py`, `core/intent_graph.py`, `core/prompt_debugger.py`, `core/workspace_profile.py`
- `services/prompt_workflow.py` — сборка preview и брифа
- `backend/api/prompt_ide.py` — превью без полной генерации
- `db/manager.py` — сессии, specs, workspaces

## Что ещё не умеет (надстройки из продуктового видения)

- Полноценный **визуальный** intent graph UI.
- Редактирование на уровне секций как в «настоящем» IDE.
- **Prompt IR / components / slots** — отдельное промежуточное представление вместо компиляции одной строки.
- Scenario lab, adaptation matrix, полная provenance по каждой строке текста промпта.

## Зачем это ядро

Центр смещается с текста промпта на **`PromptSpec`**, откуда проще наращивать Intent Graph, Debugger и Evidence.

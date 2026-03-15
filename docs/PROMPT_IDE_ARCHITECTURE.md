# Prompt IDE Architecture

## Что уже внедрено

Текущая версия проекта больше не ограничивается только `task_input -> prompt`.
В кодовой базе появился первый слой будущего `Prompt IDE`.

## Основные сущности

### Workspace

Workspace — это reusable контекст для prompt design:

- glossary;
- style rules;
- default constraints;
- reference snippets;
- preferred target model.

Workspace нужен, чтобы пользователь работал не в пустом поле, а внутри устойчивой среды.

### PromptSpec

`PromptSpec` — это структурированное представление задачи.

Сейчас он хранит:

- `goal`
- `task_types`
- `complexity`
- `target_model`
- `workspace`
- `output_format`
- `constraints`
- `success_criteria`
- `source_of_truth`
- `previous_prompt`

### Evidence (Evidence-Bound Prompting)

Evidence показывает происхождение ключевых полей `PromptSpec`:

- `user` — явно от пользователя;
- `workspace` — из workspace;
- `inferred` / `assumed` — выведено эвристически;
- `missing` — не заполнено.

Для полей `inferred` и `workspace` доступны **Принять** / **Отклонить**. Отклонённые поля исключаются из spec при генерации.

### Prompt Debugger

Debugger — rule-based слой, который ищет structural issues:

- missing critical field, weak grounding, schema without grounding;
- missing constraints, success criteria;
- output schema ambiguity;
- model mismatch, iteration without direction;
- **instruction conflict** — противоречия (краткость vs подробность);
- **vague goal** — размытые формулировки («улучши», «оптимизируй»);
- **reliability gap** — нет fallback при ошибках/отсутствии данных;
- **overloaded for task** — слишком много ограничений для простой задачи;
- **audience without criteria** — аудитория без критериев успеха.

## Где это видно в UI

### Home

На `Home` теперь есть:

- выбор активного workspace;
- preview панели `Spec Editor / Intent / Debugger / Evidence`;
- сохранение PromptSpec при генерации;
- Prompt IDE секция у результата.

### Workspaces

Отдельная страница `Workspaces` позволяет:

- создавать workspace;
- редактировать их;
- активировать workspace для текущей сессии;
- удалять workspace.

## Где это лежит в коде

- `core/prompt_spec.py`
- `core/evidence.py`
- `core/intent_graph.py`
- `core/prompt_debugger.py`
- `core/workspace_profile.py`
- `db/manager.py`
- `app/Home.py`
- `app/pages/6_Workspaces.py`

## Что это ещё не умеет

Пока это только первый слой Prompt IDE, а не финальная система.

Ещё не реализованы:

- полноценный визуальный graph UI;
- section-level editing как в настоящем IDE;
- prompt components / slots;
- scenario lab;
- adaptation matrix;
- full provenance по каждой части prompt.

## Почему это правильный первый шаг

Потому что он меняет внутреннюю модель продукта:

- раньше центром был текстовый prompt;
- теперь центром становится `PromptSpec`.

Это позволяет дальше наращивать:

- Intent Graph;
- Debugger;
- Evidence-Bound Prompting;
- Prompt IDE shell.

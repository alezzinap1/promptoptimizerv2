# Portfolio Case Notes

## Problem

Обычный чат с LLM не сохраняет процесс prompt engineering как систему:

- нет явной базы техник;
- нет объяснения выбора подхода;
- нет repeatable workflow;
- нет истории и библиотеки промптов.

## Solution

Продукт превращает работу с промптами в управляемый цикл:

`task → classify → select techniques → generate → inspect (IDE) → iterate → save`

## Why the project is interesting

- доменная логика отделена от UI (`core/`, `services/`, `backend/`);
- техники — расширяемая YAML-база + пользовательские переопределения в БД;
- учёт целевой модели, не только модели генерации;
- версии в сессии, библиотека, reasoning;
- Prompt IDE: spec, evidence, debugger.

## Evolution (актуально)

- Ранний прототип UI (исторически) сменён на **SPA**; **FastAPI + React** — **основной** продукт: auth, rate limits, workspaces, compare, библиотека, метрики на User Info, Docker-сборка.

Ранний **Telegram**-эксперимент в этом репозитории не поддерживается.

## Good interview framing

### Что подчеркивать

- зачем выделен `core/`;
- почему техники в YAML;
- как эволюционировал UI до SPA на FastAPI + React;
- чем полезны эвристики качества промпта и чем они **не** являются;
- как устроены spec / evidence / debugger.

### Что не обещать

- что это уже enterprise SaaS «из коробки»;
- что `completeness score` гарантирует лучший бизнес-результат;
- что зрелый продуктовый контур — **React SPA**, а не экспериментальные старые клиенты.

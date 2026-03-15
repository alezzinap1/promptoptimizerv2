# Portfolio Case Notes

## Problem

Обычный чат с LLM не сохраняет процесс prompt engineering как систему:

- нет явной базы техник;
- нет объяснения выбора подхода;
- нет repeatable workflow;
- нет истории и библиотеки промптов.

## Solution

`Prompt Engineer` превращает работу с промптами в управляемый цикл:

`task -> classify -> select techniques -> generate -> inspect -> iterate -> save`

## Why the project is interesting

- отделяет доменную логику от интерфейса;
- хранит техники как расширяемую knowledge base;
- учитывает target model, а не только generation model;
- ведет историю версий;
- показывает reasoning, а не только итог.

## Evolution

- `Telegram v1`: проверка гипотезы и базового UX.
- `Streamlit v2`: текущий рабочий portfolio/demo продукт.
- `FastAPI + React v3`: следующий шаг к зрелой web-архитектуре.

## Good interview framing

### Что подчеркивать

- why `core/` выделен отдельно;
- почему техники вынесены в YAML;
- почему `Streamlit` был выбран как быстрый product shell;
- чем текущие эвристические prompt metrics полезны и чем они ограничены;
- как проект должен эволюционировать в полноценный web product.

### Что не обещать

- что это уже production-ready SaaS;
- что `completeness score` гарантирует лучший output;
- что все интерфейсы в репозитории одинаково готовы.

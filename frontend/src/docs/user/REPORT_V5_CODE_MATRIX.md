# Отчёт v5 ↔ код: матрица и чеклист

Сводка по [metaprompt_full_analysis_v5.html](./metaprompt_full_analysis_v5.html): ожидание отчёта, где это в репозитории, статус.

**Статусы:** done — соответствует; partial — частично; gap — нет / не совпадает.

## Вкладка «Уровни + модели»

| Тема отчёта | Код / файлы | Статус |
|-------------|-------------|--------|
| Пресеты Junior–Creative | `frontend/src/lib/expertLevelPresets.ts` | done |
| Потолок T0.85 (Creative) | Пресет + clamp + `backend/api/generate.py` | done |
| Две оси перегружают новичка | Уровень — компактный dropdown в строке с вкладками | partial |
| LevelBundle в продукте | `levelBundle.ts`; отдельный UI «бандлов» как в HTML нет | partial |
| target_model для фото/скилла | `Home.tsx` | done |
| Отдельное поле skill_target_env | `skill_target_env` в `/generate` + блок в system prompt; UI «Среда для скилла» в композере | done |
| Intent «Авто» уровень | Нет отдельного режима | gap |
| Reasoning-модели: мягкий пресет | `modelReasoning.ts` + эффект в `Home.tsx` | partial |
| Cost visibility | Ориентир из `levelBundle` у композера | partial |

## Вкладка «Скриншоты»

| Тема | Код | Статус |
|------|-----|--------|
| Diff + спарклайн | `Home.tsx` | done |
| Chips советов | `Home.tsx` | done |
| Компактный уровень | `SelectDropdown` в `Home.tsx` | done |
| Лейбл токенов задачи | «задача» + title | partial |
| Compare: Авто/Вручную | `Compare.tsx` | done |
| Скиллы локально + сервер | Экспорт/импорт JSON; **«С сервера»** + **«☁ Синхронизировать»** (`POST /skills/bulk-upsert`), autosync при сохранении скилла | done (без полного отказа от localStorage) |
| Подписи моделей `provider/id` | `generationModelLabel.ts` | done |

## Вкладка «Продукт»

| Тема | Код | Статус |
|------|-----|--------|
| Playground для любого промпта | `POST /api/playground/run` + кнопка **«Песочница»** у готового промпта (Текст/Фото) в `Home.tsx` | done |
| Онбординг | `FirstVisitHomeTip.tsx` (lead про value prop) + справка | partial |

## Чеклист «Обязательно до теста» (прогон)

| Пункт | Результат |
|-------|-----------|
| Скиллы на сервере | API `/skills` есть; локальная библиотека синхронизируется кнопкой «С сервера»; полный отказ от localStorage не делался |
| Disabled при генерации | `Home.tsx` |
| Онбординг | Баннер + lead |
| Имена моделей | `shortGenerationModelLabel` |
| FAQ по уровням | `EXPERT_LEVELS_FAQ.md` + Help |

## Сводка с брифом `metaprompt_programmer_brief` (Desktop HTML)

| Тема брифа | Реализация | Примечание |
|------------|------------|------------|
| P0 cheap LLM pre-router | `services/cheap_llm_pre_router.py`, `backend/api/agent_route.py` | Флаг `PRE_PROMPT_LLM_ENABLED` (по умолчанию вкл.), `CHEAP_PRE_ROUTER_PROVIDER`, пороги по уровню, fallback на embeddings при ошибке |
| clarify + «Продолжить без уточнения» | Ответ `is_clarification`, `router_log_id`, `Home.tsx` | `force_task` + `mark_pre_router_override` в `pre_router_logs` |
| P1 bulk-upsert скиллов | `POST /skills/bulk-upsert`, `client_local_id`, кнопка «☁ Синхронизировать» | Автосохранение при сохранении скилла из студии: `createSkill` + `client_local_id` |
| P2 LevelBundle + модель по умолчанию | `EXPERT_DEFAULT_GEN_MODEL`, `useCustomGenModel`, подсказка уровня | «к профилю» сбрасывает к рекомендованной модели |
| P3 reasoning tooltip | `span` вокруг выбора модели + `modelReasoning.ts` | Паттерн `openai/o3` |
| Промпты (оптимизация) | `prompts/core/base_system.txt`, `backend/skill_*`, `image_*`, `text_questions_strict`, `iteration_guard` | Согласовано с разделом «Оптимизация промптов» HTML |

## Всё ещё вне scope / gap

- **Уровень «Авто»** (intent routing как отдельный профиль).
- **Полная стоимость до клика** из прайсинга OpenRouter (сейчас только ориентир из бандла).
- **LevelBundle** как отдельный визуальный продукт (не только метаданные + dropdown уровня + рекомендованная модель).
- **Overlay-онбординг** «до/после» + `POST /users/onboarding-complete` из брифа P4.
- **Retention / проекты** и т.д. из продуктовой вкладки HTML.

Обновляйте этот файл при закрытии пунктов бэклога.

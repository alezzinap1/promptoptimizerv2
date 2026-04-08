# Metrics Framework

## Зачем нужны метрики

Оценивать продукт не только по тексту промпта, а по тому, помогает ли flow быстрее приходить к полезному результату.

## Product metrics

### P0

- **PromptAcceptanceRate** — proxy: доля сгенерированных промптов, сохранённых в библиотеку.
- **SaveToLibraryRate** — насколько часто результат «достаточно хорош», чтобы сохранить.
- **QuestionsResponseRate** — ответы на уточняющие вопросы или осознанный пропуск.

### P1

- **IterationsStarted** — первого ответа недостаточно.
- **CompareRuns** — потребность сравнить наборы техник.
- **LibraryOpenPrompt** — повторное использование библиотеки.
- **LatencyP50/P95** — комфорт по времени.

## Technical metrics

- `generation_error`, `invalid_model`, средний `latency_ms`, средний `completeness_score`

## Оговорка по completeness score

Это **структурная** эвристика (роль, формат, инструкции, ограничения, контекст), а не доказательство качества ответа модели в проде.

## Что логируется (события)

В коде встречаются в том числе:

`generate_requested`, `generation_result`, `generate_prompt_success`, `generate_questions`, `questions_answered`, `questions_skipped`, `iteration_started`, `prompt_saved_to_library`, `compare_run`, `library_open_prompt`

(точный список и поля — в `db/manager.py` / сервисах, пишущих `app_events`.)

## Где смотреть в приложении

- Маршрут **`/metrics`** редиректит на **`/user-info#product-metrics`** (см. корневой `README.md`).
- Дальнейшая зрелость: когорты, воронки, явное действие «принял промпт», связка с cost-per-generation, повторное использование между сессиями — см. [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md).

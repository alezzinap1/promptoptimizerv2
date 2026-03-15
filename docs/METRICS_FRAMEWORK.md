# Metrics Framework

## Зачем нужны метрики

Проект должен оцениваться не только по качеству текста промпта, но и по тому, помогает ли он пользователю быстрее приходить к полезному результату.

## Product metrics

### P0

- `PromptAcceptanceRate`
  Proxy-метрика на текущем этапе: доля сгенерированных промптов, сохранённых в библиотеку.
- `SaveToLibraryRate`
  Насколько часто результат считается достаточно полезным, чтобы его сохранить.
- `QuestionsResponseRate`
  Как часто пользователь отвечает на уточняющие вопросы или осознанно пропускает их.

### P1

- `IterationsStarted`
  Насколько часто первого результата недостаточно.
- `CompareRuns`
  Как часто пользователю нужен выбор между техниками.
- `LibraryOpenPrompt`
  Есть ли повторное использование сохранённых результатов.
- `LatencyP50/P95`
  Насколько комфортен flow по времени.

## Technical metrics

- `generation_error`
- `invalid_model`
- средний `latency_ms`
- средний `completeness_score`

## Важная оговорка

`Completeness score` не является основной product metric. Это только структурная эвристика:

- наличие роли;
- наличие формата вывода;
- наличие инструкций;
- наличие ограничений;
- наличие контекста и примеров.

## Что уже логируется

- `generate_requested`
- `generation_result`
- `generate_prompt_success`
- `generate_questions`
- `questions_answered`
- `questions_skipped`
- `iteration_started`
- `prompt_saved_to_library`
- `compare_run`
- `library_open_prompt`

## Следующий уровень зрелости

Когда появится активная web-версия, стоит добавить:

- user-level cohorts;
- session funnels;
- explicit “accepted prompt” action;
- manual evaluation dataset;
- cost-per-generation;
- prompt reuse tracking across sessions.

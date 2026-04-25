# Дизайн: «Стабильность» — оценка промптов и сравнение через множественный прогон (MVP-1)

- Дата: 2026-04-25
- Статус: черновик, ждёт ревью пользователя
- Авторы: brainstorm-сессия с владельцем продукта (по skill `brainstorming`)
- Скоуп: первый этап «Eval Studio» — оценка стабильности одного или двух промптов через N прогонов на одном тестовом запросе, с LLM-судьёй по анкете, разнообразием ответов и сохранением прогона в БД с привязкой к Library.
- Не в скоупе MVP-1: датасеты входов, автопроверки кодом (regex/JSON-schema полная), ансамбль судей, турниры версий, авто-перепрогон при сохранении версии, публичные ссылки на прогон, отдельная страница `/eval`.

---

## 1. Зачем это

Сегодня в продукте есть только страница «A/B Сравнение» с **одним** прогоном промпта на целевой модели и **одним** вызовом LLM-судьи. Это даёт ответ на вопрос «какой из двух промптов **сейчас** лучше», но не отвечает на вопросы, которыми реально занимается продвинутый prompt-engineer:

- «Насколько мой промпт **стабилен** — даёт ли он один и тот же результат при шуме модели?»
- «Каков **разброс качества** между лучшими и худшими ответами?»
- «Где конкретно мой промпт **проваливается** — на каком критерии?»
- «Стоит ли тратить деньги на дорогую модель, или **дешёвая такая же стабильная**?»

Идея пользователя — **запускать промпт N раз** (например 10–20) на одном тестовом запросе, **оценивать каждый ответ судьёй по анкете** и видеть распределение оценок, разнообразие ответов и провалы. Эта спека описывает первый этап такого инструмента (MVP-1) и закладывает место под будущие этапы (датасеты, турниры, дашборд).

---

## 2. Цели и не-цели

### Цели

1. Дать prompt-engineer'у **число с честным разбросом** для своего промпта: «4.2/5, ±0.6, разнообразие 0.12».
2. Показать **где промпт ломается** (по какому критерию, на каких ответах).
3. Дать **сравнение двух промптов** через тот же механизм (одновременно стабильность каждого + быстрая сверка «кто чаще лучше»).
4. Сделать стоимость **видимой до запуска** (коридор $) — чтобы дорогие прогоны не были сюрпризом.
5. Сохранять прогоны в БД и привязывать их к промптам в Library — чтобы в будущем строить регрессию по версиям.
6. Не сломать существующий поток A/B Сравнения.

### Не цели MVP-1

- Не делаем сохраняемые датасеты входов (это MVP-2).
- Не делаем автопроверки кодом (regex, JSON-схема полная) — только лёгкую проверку «парсится ли ответ как JSON».
- Не делаем ансамбль из нескольких судей (MVP-1.5).
- Не делаем рейтинг версий по типу Elo (MVP-3).
- Не делаем авто-перепрогон при сохранении новой версии промпта (MVP-3).
- Не делаем публичные ссылки на прогон (MVP-4 / B1).
- Не делаем отдельную страницу `/eval` — встраиваемся во вкладку существующей страницы `/compare`.

---

## 3. Кому это нужно (персоны и боли)

- **Максим, indie-dev**: хочет «честное» число для своего промпта, не одно ad-hoc мнение судьи. Хочет видеть на каких ответах модель проваливается.
- **Лиза, prompt engineer для клиентов**: хочет приносить клиенту отчёт «вот распределение, вот разброс, вот провалы», а не одну оценку.
- **Аня, новичок**: NOT primary persona. UX должен не пугать, но не оптимизирован под неё.

---

## 4. Где живёт фича

- Страница `/compare` переименовывается из «A/B Сравнение» в **«Сравнение и оценка»**.
- Внутри страницы появляется четвёртый segment-tab: `По техникам` · `По промптам` · `По моделям` (как сейчас) · **`Стабильность`** (новый).
- В Library у промпта появляется бейдж стабильности (если есть последний прогон).
- В Studio у завершённого промпта появляется action **«Прогнать стабильность»** — deep-link `/compare?mode=stability&prompt=…`.

---

## 5. Что считается «оценкой» одного ответа

### 5.1. Анкета (rubric)

Это набор из 3–5 критериев, каждый с пояснениями для шкалы 0/3/5. Пример (extraction):

```json
{
  "name": "Извлечение сущностей",
  "preset_key": "extraction",
  "scale_max": 5,
  "criteria": [
    {
      "key": "completeness",
      "label": "Полнота",
      "description": "Все требуемые поля присутствуют, ничего не выдумано.",
      "weight": 0.4,
      "anchors": {
        "0": "Большинство полей пропущены или выдуманы.",
        "3": "Половина полей есть, есть 1–2 фабрикации.",
        "5": "Все поля на месте, без фабрикаций."
      }
    }
    /* + format, concision */
  ]
}
```

Якоря (что значит 0, 3, 5) — **обязательное** поле каждого критерия. Без них судья «гуляет» в оценках при разных прогонах.

**4 пресета анкеты** на старте (хранятся в коде, копируются в БД при первом обращении пользователя):

| `preset_key` | Когда выбирать | Критерии |
|---|---|---|
| `extraction` | Структурированный вывод, JSON, fact-extraction | completeness, format, concision |
| `code` | Генерация кода | correctness, idiomatic, edge_cases, no_extra |
| `writing` | Свободный текст | task_fit, clarity, tone, no_padding |
| `classification` | Один тег/категория | accuracy, confidence_calibration |

`custom` — пользователь добавляет/редактирует свою анкету в простом UI «список критериев + якоря». Анкеты хранятся per-user.

### 5.2. Судья — одна LLM-модель в роли оценщика

Один LLM-вызов на каждый из N ответов. Промпт судьи (упрощённо):

```
Ты — беспристрастный оценщик. Используй ТОЛЬКО критерии ниже.
Якоря — твоя единственная шкала. Отвечай JSON.

КРИТЕРИИ:
- Полнота (0–5): 0 = …, 3 = …, 5 = …
- Формат  (0–5): 0 = …, 3 = …, 5 = …
- …

ЗАДАЧА ПОЛЬЗОВАТЕЛЯ: <task_input>
ПРОМПТ:                <prompt_text>
ОТВЕТ МОДЕЛИ:          <output_text>
{ЭТАЛОННЫЙ ОТВЕТ:       <reference_answer>}      ← опционально

Ответ:
{
  "scores": { "completeness": 4, "format": 5, "concision": 3 },
  "reasoning": { "completeness": "...", "format": "...", "concision": "..." },
  "overall_reasoning": "2–3 предложения о вердикте"
}
```

`response_format = json_object`. Если парсинг провалился — score=null, ошибка в `eval_results.error`, в агрегацию не идёт.

Один судья по умолчанию (Gemini Flash или аналог как самая дешёвая модель в каталоге). Пользователь может выбрать другого. Несколько судей одновременно — отложено в MVP-1.5.

### 5.3. Эталонный ответ — опционально

Если задан `reference_answer`, добавляем его в промпт судьи отдельным блоком: «Используй эталон как ориентир, но НЕ требуй дословного совпадения.» Семантическая близость к эталону (cosine на эмбеддингах) считается **отдельно** и кладётся в `eval_results.judge_overall_secondary` — для информации, в основной overall не миксуется.

### 5.4. Разнообразие ответов (отдельная метрика)

После завершения N прогонов:

1. Берём `output_text` всех `n_runs` ответов.
2. Считаем эмбеддинги через дешёвую embedding-модель (`text-embedding-3-small` или OpenRouter-совместимый аналог). Если провайдер поддерживает batch — одним вызовом, иначе — последовательно (внутри executor-параллельности 4).
3. `diversity_score = 1 − среднее_по_парам(cosine_similarity)` ∈ [0, 1].

Показываем как отдельный значок «Разнообразие: 0.12 — стабильный». **В overall rubric score не миксуется** — это вторая шкала.

Интерпретация:

- 0.05–0.15 — почти одинаковые ответы (хорошо для extraction/classification, тревожно для creative).
- 0.15–0.35 — варьирующиеся формулировки одного ответа.
- > 0.35 — модель «гуляет», ответы концептуально разные.

### 5.5. Голосование по структурным полям (для JSON-ответов)

Если все N ответов парсятся как JSON, дополнительно показываем majority-vote по top-level полям:

```
intent: "purchase" — 17 / 20 (85%)
sentiment: "positive" — 12 / 20 (60%) ← низкое согласие
```

Реализация в MVP-1 — упрощённая: `try-parse JSON`, majority по equal-string значениям top-level полей. Полный JSON-Schema валидатор — MVP-2.

### 5.6. Pair-mode — два промпта

В режиме «два промпта» поверх per-response rubric scoring добавляется **pairwise-сверка**:

- После всех 2×N прогонов берём 5 случайных пар: «вот A_i, вот B_j на тот же вход — какой лучше по этой анкете?». Это дополнительный judge-вызов (компактный промпт).
- Считаем доли побед: `winrate_a`, `winrate_b`, `tie_rate`.
- `pair_winner`: если `winrate_a − winrate_b ≥ 0.20` → 'a', аналогично 'b', иначе 'tie'.
- `pair_winner_confidence`: nижняя граница `winrate` по бутстрапу (1000 ресемплов из 5 наблюдений). В UI — три состояния: «уверенно лучше», «склоняется к», «ничья».

5 pairwise-вызовов добавляются к стоимости. Пользователь может выключить опцию «сравнение через пары» в advanced-секции.

---

## 6. Архитектура и data model

### 6.1. Компоненты

```
Frontend (React)                                 Backend (FastAPI)
─────────────────                                ────────────────────────────────────
/compare?mode=stability                          /api/eval/stability/preview-cost  POST
  StabilityComposer                              /api/eval/stability/runs           POST → {run_id}
  CostPreviewPanel                               /api/eval/stability/runs/{id}/stream  GET (SSE)
  RunningStream (SSE consumer)         ────────► /api/eval/stability/runs/{id}      GET
  ResultDistributionChart                        /api/eval/stability/runs/{id}/cancel POST
  JudgeBreakdown                                 /api/eval/stability/runs           GET (history)
  FailureTriagePanel                             /api/eval/stability/runs/{id}      DELETE
  HistoryDrawer                                  /api/eval/rubrics                  CRUD
                                                 /api/library/{prompt_id}/eval-summary GET
/library: badge "📊 4.2/5 · ±0.6"

Eval engine (services/eval/):
  run_executor (parallel, k=4)
  judge_rubric (G-Eval style)
  embedding_diversity
  aggregator (p10/p50/p90/var)
  cost_estimator (preview)

DB (sqlite, db/manager.py):
  eval_rubrics
  eval_runs
  eval_results
  eval_judge_scores
```

### 6.2. Data model

Новая миграционная фаза `_migrate_phase19_eval`:

```sql
CREATE TABLE eval_rubrics (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  preset_key TEXT,                 -- code|extraction|writing|classification|custom
  criteria_json TEXT NOT NULL,
  reference_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE eval_runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,            -- pending|running|done|failed|cancelled
  mode TEXT NOT NULL,              -- 'single' | 'pair'
  prompt_a_text TEXT NOT NULL,
  prompt_a_hash TEXT NOT NULL,
  prompt_a_library_id INTEGER,
  prompt_a_library_version INTEGER,
  prompt_b_text TEXT,
  prompt_b_hash TEXT,
  prompt_b_library_id INTEGER,
  prompt_b_library_version INTEGER,
  task_input TEXT NOT NULL,
  reference_answer TEXT,
  target_model_id TEXT NOT NULL,
  judge_model_id TEXT NOT NULL,
  embedding_model_id TEXT NOT NULL,
  rubric_id INTEGER,
  rubric_snapshot_json TEXT NOT NULL,
  n_runs INTEGER NOT NULL,
  parallelism INTEGER NOT NULL DEFAULT 4,
  temperature REAL NOT NULL,
  top_p REAL,
  pair_judge_samples INTEGER DEFAULT 5,
  cost_preview_usd REAL NOT NULL,
  cost_preview_tokens INTEGER NOT NULL,
  cost_actual_usd REAL,
  cost_actual_tokens INTEGER,
  duration_ms INTEGER,
  diversity_score REAL,
  agg_overall_p50 REAL,
  agg_overall_p10 REAL,
  agg_overall_p90 REAL,
  agg_overall_var REAL,
  pair_winner TEXT,                -- 'a'|'b'|'tie'|NULL
  pair_winner_confidence REAL,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE eval_results (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  prompt_side TEXT NOT NULL,       -- 'a' | 'b'
  run_index INTEGER NOT NULL,
  output_text TEXT NOT NULL,
  output_tokens INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  latency_ms INTEGER,
  status TEXT NOT NULL,            -- ok|error|skipped
  error TEXT,
  embedding_blob BLOB,
  judge_overall REAL,
  judge_overall_secondary REAL,    -- semantic similarity к reference, если задан
  judge_reasoning TEXT,
  parsed_as_json INTEGER,          -- 0/1 для majority-vote
  parsed_top_fields_json TEXT,     -- top-level пары для majority-vote
  created_at TEXT NOT NULL
);

CREATE TABLE eval_judge_scores (
  id INTEGER PRIMARY KEY,
  result_id INTEGER NOT NULL,
  criterion_key TEXT NOT NULL,
  score REAL NOT NULL,
  reasoning TEXT
);

CREATE INDEX idx_eval_runs_user     ON eval_runs(user_id, created_at DESC);
CREATE INDEX idx_eval_runs_lib_a    ON eval_runs(prompt_a_library_id);
CREATE INDEX idx_eval_runs_lib_b    ON eval_runs(prompt_b_library_id);
CREATE INDEX idx_eval_results_run   ON eval_results(run_id);
```

Ключевые решения:

- **`rubric_snapshot_json`** — иммутабельный снапшот анкеты на момент запуска. Если пользователь потом отредактирует анкету, прошлые прогоны останутся честными.
- Снапшот моделей (`target_model_id`, `judge_model_id`, `embedding_model_id`) фиксируется в `eval_runs`.
- `prompt_a_hash` (sha256) — для будущей ретроактивной привязки orphan-прогона к промпту в Library.

### 6.3. API surface

| Эндпоинт | Метод | Назначение |
|---|---|---|
| `/api/eval/stability/preview-cost` | POST | `{tokens_min, tokens_avg, tokens_max, usd_min, usd_avg, usd_max, breakdown}` без запуска |
| `/api/eval/stability/runs` | POST | Создаёт `eval_run` (status=pending), триггерит фоновый executor, возвращает `{run_id}` |
| `/api/eval/stability/runs/{id}/stream` | GET (SSE) | События `progress`, `result_added`, `judge_added`, `aggregate_update`, `done`, `error` |
| `/api/eval/stability/runs/{id}` | GET | Полный снапшот run + results |
| `/api/eval/stability/runs/{id}/cancel` | POST | Остановка |
| `/api/eval/stability/runs` | GET | История с фильтрами (prompt_id, model, status, range) |
| `/api/eval/stability/runs/{id}` | DELETE | Удаление |
| `/api/eval/rubrics` | GET/POST/PUT/DELETE | CRUD анкет |
| `/api/library/{prompt_id}/eval-summary` | GET | Для бейджа: `{p50, var, n_runs, last_run_id}` |

Все эндпоинты требуют **собственного OpenRouter ключа** (`user.api_key` непустой). Иначе 402 + ссылка в `/settings`.

---

## 7. Сценарий пользователя (UX)

### 7.1. Подготовка

1. Пользователь идёт на `/compare`, выбирает таб **«Стабильность»**.
2. Composer:
   - Поле «Промпт» (или 2 поля «A» / «B», переключатель «Сравнить два промпта»).
   - Поле «Тестовый запрос» — задача, на которой прогоняем.
   - Свёрнутое поле «Эталонный ответ» (опционально).
   - Дропдауны: «Целевая модель», «Модель-судья» (фильтр по дешёвым), «Анкета» (4 пресета + «Своя» → редактор).
   - Слайдер «N прогонов» (1–50, default 10).
   - Свёрнутые advanced: температура, top-p, parallelism (default 4), pair-judge samples (default 5), embedding model.
3. Пользователь жмёт **«Сколько это будет стоить»** → панель с коридором цен (см. §8).
4. Пользователь жмёт **«Запустить»**. Бэкенд создаёт `eval_run`, возвращает `run_id`, фронт открывает SSE.

### 7.2. Во время прогона

- Прогресс-бар «5 / 10 ответов готовы».
- Лента ответов: каждый новый ответ появляется сверху списка → через 1–2 сек рядом появляется его оценка от судьи. Можно раскрыть, прочитать рассуждение судьи.
- В реальном времени обновляется сводка вверху: median, p10/p90, variance.

### 7.3. Когда готово

- Сводка: «Полнота 4.2/5 · разброс ±0.6 · разнообразие 0.12 · стоимость $0.023 · 47 сек».
- Гистограмма распределения общей оценки.
- Разбивка по критериям: «Формат: всегда 5/5, Полнота: 3.8 в среднем, провалов 2/10».
- Таблица провалов (ответы с overall < median − var): развёртываются.
- В режиме pair: бейдж «A победил в 4 из 5 случаев — уверенно лучше».
- Кнопки:
  - «Перезапустить» (с теми же параметрами).
  - «Сохранить как новую версию промпта» (если промпт из Library — создаёт next version, привязывает прогон).
  - «Скопировать отчёт в Markdown» (клиентская сериализация).
  - «Сравнить с другим прогоном» (открывает дровер выбора).

### 7.4. История прогонов

- В навбаре дровер «История прогонов» (паттерн `compareRecent.ts`, но из БД через `/api/eval/stability/runs?limit=30`).
- В Library у каждого промпта — кнопка «История прогонов» → дровер с прогонами этого промпта по версиям.

### 7.5. Бейдж в Library

- На карточке промпта: `📊 4.2/5 · ±0.6` (если есть `done` прогон последней версии).
- Если последняя версия не оценена — серый «не оценён».
- Клик по бейджу — открывает последний прогон.

---

## 8. Бюджет до запуска

Перед стартом показываем коридор:

```
1 промпт × 10 прогонов на gpt-4o-mini:
  Ответы целевой модели:    ≈ 17 000 токенов  ≈ $0.018
  Оценщик (gemini flash):   ≈ 31 000 токенов  ≈ $0.005
  Эмбеддинги:               ≈  5 000 токенов  ≈ $0.0001
ИТОГО: примерно $0.023 (±40% если ответы будут длиннее)
```

Логика расчёта:

- **Input tokens** считаем точно: длина промпта + длина task_input + (если задан) reference_answer.
- **Output tokens** — пользователь выбирает «короткий 200 / средний 800 / длинный 2000» (default средний).
- **Judge tokens** = (input + output) на каждый ответ + длина rubric snapshot. На pair-сравнение — ещё 5 коротких вызовов.
- **Embedding tokens** = N × длина output.
- **min / avg / max** = ×0.6 / ×1.0 / ×1.4 относительно avg.

Hard-cap: если `usd_max > daily_eval_budget_remaining` пользователя, кнопка «Запустить» disabled, текст подсказывает «Дневной лимит $X исчерпан, увеличь в Настройках».

---

## 9. Streaming, фон, отмена

- При нажатии «Запустить» бэкенд создаёт `eval_run` (status=pending) и запускает background-task. Возвращает `{run_id}` сразу.
- Фронт открывает SSE `/runs/{id}/stream`. События:
  - `progress {n_done, n_total}`
  - `result_added {result_id, prompt_side, run_index, output_text, latency_ms, tokens}`
  - `judge_added {result_id, scores, overall, reasoning}`
  - `aggregate_update {p50, p10, p90, var, diversity}`
  - `pair_summary {winrate_a, winrate_b, tie_rate, winner, confidence}` (только в pair-mode, после 2×N + 5 pair-вызовов)
  - `done {finished_at, cost_actual_usd, cost_actual_tokens}`
  - `error {message}`
- **Параллелизм**: max 4 одновременных вызова на одной целевой модели (rate-limit OpenRouter). Конфигурируемо в advanced.
- **Закрытая вкладка**: бэкенд продолжает прогон. На навбаре — индикатор «1 прогон в работе» (опрос `/api/eval/stability/runs?status=running`).
- **Отмена**: `/cancel` ставит флаг, executor останавливается на следующем доступном break-point (не делает новых OpenRouter-вызовов). Уже сделанные результаты сохраняются. status=cancelled.
- **Краш сервера**: незавершённые runs при старте сервера переводятся в `failed` (FastAPI lifespan startup hook делает `UPDATE eval_runs SET status='failed', error='server restarted' WHERE status IN ('pending','running')`). Уже сохранённые результаты остаются видимы. Resume не делаем в MVP-1.

---

## 10. Persistence + связь с Library

- `eval_runs` живут вечно. Удаление — только пользователем.
- Если промпт пришёл из Library (`library_id` известен) — `eval_runs.prompt_a_library_id` + `prompt_a_library_version` заполнены. Бейдж в Library показывает оценку **последней версии**. Если для последней версии оценок нет — серый «не оценён».
- При сохранении новой версии промпта в Library старые прогоны висят на старой версии (через `prompt_a_library_version`). Это и есть будущая регрессия.
- Orphan-прогон (промпт не из Library) живёт без `library_id`. После сохранения промпта в Library — UI предложит «прицепить эти прогоны» (поиск по `prompt_a_hash`). Авто-линковки нет.

---

## 11. Безопасность и лимиты

- Только **собственный** OpenRouter ключ. Без ключа — 402 + ссылка в Settings.
- Лимиты:
  - Max 5 одновременных running-runs на пользователя.
  - Max 50 N runs в одном запуске.
  - Max 1 input в MVP-1.
  - Max 30 000 символов в `prompt_text`, 5 000 в `task_input`, 5 000 в `reference_answer`.
  - **Дневной бюджет** на eval — новый параметр в Settings, default $5/день. Использует существующий механизм `db.add_user_usage`. По исчерпании — блок до полуночи UTC.
- Судья и embedding-модель — **по умолчанию из дешёвого тира** в дропдауне. «Дешёвый тир» = whitelist в `services/eval/cheap_tier.py` (изначально захардкожен, в MVP-2 — расчёт из `data/models_cache.json` по `price_per_1m_tokens < $1`). Если пользователь явно раскроет «Все модели» и выберет дорогую — это разрешено, его ключ.
- В `db.log_event` пишем `eval_run_started`, `eval_run_done`, `eval_run_failed`, `eval_run_cancelled` (без содержимого).
- При выводе ошибок судьи — не транслируем raw error в UI пользователю, только «парсинг провалился, ответ не учтён».

---

## 12. Что НЕ делаем в MVP-1 (специально)

| Не делаем | Почему | Когда добавим |
|---|---|---|
| Ансамбль из 2–3 разных судей | Усложняет UX («у судей расхождение, кому верить?»), удваивает стоимость | MVP-1.5 |
| Полные programmatic checkers (regex, JSON-schema, Python-функции) | Нужен отдельный UI-редактор чеков, отдельный safe runner | MVP-2 |
| Несколько входов в одном run (mini-dataset) | Это уже Datasets — отдельная сущность, CRUD, sharing | MVP-2 |
| Турнир версий с рейтингом (Elo / Bradley–Terry) | Сложно объяснить пользователю и правильно посчитать | MVP-3 |
| Auto-rerun на сохранении версии промпта | Тратит деньги без явного клика — этический и финансовый риск | MVP-3 |
| Отдельная страница `/eval` + дашборд | Преждевременно при одном инструменте внутри | MVP-4 |
| Публичная ссылка на прогон (B1) | Требует sharing-инфраструктуру | MVP-4 |
| Reasoning-trace оценка для reasoning-моделей | Отдельная техника, нужны trace-aware промпты судьи | MVP-2/3 |
| Adversarial perturbations / prompt-fuzz | Нишевое, требует управляющего UI | Бэклог |

---

## 13. Дорожная карта после MVP-1

| Этап | Содержание |
|---|---|
| **MVP-1.5** | Ансамбль из двух судей, показатель «согласие судей», калибровка |
| **MVP-2**   | Datasets (CRUD тестовых задач, привязка к rubric), programmatic checkers (regex + JSON-Schema + Python sandbox), reasoning-trace eval |
| **MVP-3**   | Турнир: prompt-versions × models × dataset → таблица, рейтинг, diff провалов; auto-rerun на save с явным opt-in |
| **MVP-4**   | Eval Studio dashboard (lederboard моделей пользователя, экспорт отчётов в .md/.pdf), публичная ссылка (B1) |

---

## 14. Риски и митигации

| Риск | Митигация |
|---|---|
| Стоимость прогонов выйдет из-под контроля | Hard-cap дневного бюджета, обязательная оценка стоимости до запуска, дешёвые модели по умолчанию |
| LLM-судья нестабилен на repeat-запросах | Якоря в анкете (0/3/5), низкая температура судьи (0.0–0.2), `response_format=json_object`. Если нужно больше доверия — MVP-1.5 ансамбль. |
| Бэкенд упал во время прогона | startup-hook помечает все `running` как `failed`, частичные results остаются (видно как «прогон не завершён»). Resume — отдельный спец. |
| Embedding-модель недоступна | Diversity_score = NULL, остальное продолжается. UI показывает «разнообразие недоступно». |
| Пользователь массово удаляет прогоны → бейдж в Library исчезает «случайно» | Отдельная подтверждающая модалка при удалении прогона, который привязан к Library. |
| Длинные ответы выбивают context window судьи | Truncate output_text до 24 000 символов (как сейчас в `compare_judge.py`); если правда нужно — Streaming-judge (long context model) — MVP-2. |
| `eval_results.embedding_blob` раздувает БД | TTL по pruning (после 90 дней — обнуляем blob, оставляем агрегат) — не в MVP. В MVP закладываем индекс и ручной DELETE. |
| Запуск без своего ключа на проде | Жёсткий 402 на роуте + UI-блок с ссылкой в Settings. |

---

## 15. Open questions / решено по умолчанию

Эти решения приняты по умолчанию (можно поменять при ревью):

- **Имя страницы**: «Сравнение и оценка» (а не отдельная `/eval`).
- **Бренд таба**: «Стабильность» (рассмотренные альтернативы: «Прогон», «Анализ», «Оценка»).
- **Default N**: 10. Min 1, max 50.
- **Default judge**: первый дешёвый из каталога (Gemini Flash или аналог).
- **Default embedding**: `text-embedding-3-small` (или OpenRouter-аналог в дешёвом тире).
- **Default анкета**: `extraction` (если по эвристике входа похоже на JSON-задачу), иначе `writing`. Эвристика — простая: ищем `{ "` / `JSON` / `extract` в task_input.
- **Default judge temperature**: 0.0.
- **Default daily eval budget**: $5/день.
- **Удаление промпта в Library** не каскадит на `eval_runs` (`library_id` обнуляется, прогон становится orphan). Текст в UI: «прогоны останутся, но будут открепляются от промпта».
- **Pair-mode pair-judge samples**: 5. Можно выключить в advanced.

---

## 16. Чеклист готовности (definition of done MVP-1)

- [ ] Миграция `_migrate_phase19_eval` создаёт 4 таблицы.
- [ ] CRUD `/api/eval/rubrics`, 4 пресета доступны.
- [ ] `POST /api/eval/stability/preview-cost` возвращает корректный коридор.
- [ ] `POST /api/eval/stability/runs` создаёт run, фоновый executor выполняет до конца.
- [ ] SSE `/runs/{id}/stream` отдаёт правильную последовательность событий.
- [ ] Cancel останавливает прогон.
- [ ] Бейдж в Library показывает оценку последней версии.
- [ ] История прогонов открывается в дровере.
- [ ] Дневной бюджет блокирует запуск.
- [ ] Прогон без своего ключа невозможен (402).
- [ ] Отчёт экспортируется в Markdown.
- [ ] Тесты: cost preview math, aggregator (p10/p50/p90/var), judge JSON parse, executor cancel, бейдж API, лимиты.

---

## 17. Связь с предыдущими спеками

- `docs/superpowers/specs/2026-04-16-product-ux-visual-design.md` §13 (B3 batch eval, B4 reproducibility snapshot) — частично закрыто этой спекой (B4 — иммутабельный rubric_snapshot и model snapshot; B3 — отложено в MVP-2).
- `docs/superpowers/specs/2026-04-24-end-user-ux-friction-design.md` (волна 1, кэш оценки судьи на тот же текст) — этот эффект достигается автоматически, потому что в Library теперь висит «последний прогон»; повторно жать «оценить» имеет смысл только при изменении промпта или анкеты.
- `core/compare_judge.py` (текущий judge) — остаётся для существующего A/B Compare. Новый judge для Stability не пересекается, но использует ту же `LLMClient.generate_json`.

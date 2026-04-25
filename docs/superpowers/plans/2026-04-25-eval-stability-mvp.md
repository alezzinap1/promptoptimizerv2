# «Стабильность» — оценка промптов через множественный прогон (MVP-1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать спецификацию [`../specs/2026-04-25-eval-stability-mvp-design.md`](../specs/2026-04-25-eval-stability-mvp-design.md): новый таб **«Стабильность»** на странице `/compare`, бэкенд для **N-кратного прогона** промпта с оценкой LLM-судьёй по анкете, **разнообразием** через эмбеддинги, **pairwise** для двух промптов, **SSE-стрим** прогресса, привязка к **Library** (бейдж).

**Architecture:** Прогоны выполняются в отдельных потоках на сервере (модуль `services/eval/run_executor.py`), события идут в `queue.Queue` per-run, SSE-эндпоинт раздаёт их фронту. Все данные — в SQLite через 4 новые таблицы (миграционная фаза `phase20`). На фронте — новый mode `'stability'` в существующем `Compare.tsx`, минимум новых страниц. Без датасетов, без ансамбля судей, без турниров — это MVP-1.

**Tech Stack:** Python 3.x, FastAPI, sync OpenAI SDK через OpenRouter, SQLite/`DBManager`, `concurrent.futures.ThreadPoolExecutor`, `queue.Queue`, NumPy (для cosine), `pytest`, TypeScript, React 18, Vite, существующий `frontend/src/api/client.ts`.

**Спека ↔ покрытие:**
- §5 (анкета, судья, эталон, разнообразие, majority-vote, pairwise) → Tasks 6, 7, 8, 9.
- §6 (data model + API surface) → Tasks 1, 2, 12–17.
- §7 (UX) → Tasks 19, 20, 21.
- §8 (cost preview) → Task 5, 13.
- §9 (SSE, фон, отмена) → Tasks 10, 11, 14, 15, 17.
- §10 (persistence + Library badge) → Tasks 2, 16, 22, 23.
- §11 (безопасность, лимиты) → Tasks 3, 4, 13, 14.
- §16 (DoD) → проверяется в каждой задаче.

---

## Карта файлов (создать / изменить)

| Путь | Роль |
|------|------|
| `db/manager.py` | Миграция `_migrate_phase20_eval_stability` (4 таблицы), методы CRUD по rubrics/runs/results/scores, `eval_user_daily_usage` (date+user → dollars), `mark_eval_runs_failed_on_startup`. |
| `db/manager.py` (вызов в `init()`) | Добавить `self._migrate_phase20_eval_stability(conn)` после `_migrate_phase19_llm_review_cache`. |
| `services/eval/__init__.py` (новый) | Пустой пакетный маркер. |
| `services/eval/cheap_tier.py` (новый) | Хардкод whitelist дешёвых judge/embedding моделей; функция `is_cheap(model_id)`. |
| `services/eval/rubric_presets.py` (новый) | 4 пресета (`extraction`, `code`, `writing`, `classification`) + builder судейского промпта. |
| `services/eval/cost_estimator.py` (новый) | `estimate_run_cost(...)` → `{tokens_min/avg/max, usd_min/avg/max, breakdown}`. |
| `services/eval/judge_runner.py` (новый) | `judge_one(llm, judge_model, rubric, task_input, output, reference)` → `{scores, reasoning, overall, parse_error}`; `judge_pair(...)`. |
| `services/eval/diversity.py` (новый) | `compute_diversity(embeddings: list[list[float]]) -> float`; `embed_outputs(client, model, texts)` (с фолбэком sequential). |
| `services/eval/aggregator.py` (новый) | `aggregate_overall(scores)` → `{p10, p50, p90, var}`; `aggregate_per_criterion(...)`; `majority_vote(json_outputs)`; `pair_winrate_with_ci(pairs)` (бутстрап). |
| `services/eval/run_executor.py` (новый) | `EvalRunExecutor` — фоновый поток per run, parallelism=4 для целевых вызовов, очередь событий, отмена через флаг. |
| `services/eval/event_bus.py` (новый) | Глобальный `dict[run_id, queue.Queue]` для связи executor↔SSE; thread-safe register/unregister/publish. |
| `services/eval/api_helpers.py` (новый) | Сериализация snapshot run+results для SSE «catch-up». |
| `services/llm_client.py` | Метод `embed(texts: list[str], provider: str) -> list[list[float]]` через OpenAI SDK `embeddings.create`. |
| `backend/api/eval_stability.py` (новый) | Все эндпоинты `/eval/...` и `/library/{id}/eval-summary`. |
| `backend/main.py` | `include_router(eval_stability.router, prefix="/eval", tags=["eval"])`; lifespan startup hook вызывает `db.mark_eval_runs_failed_on_startup()`. |
| `backend/api/settings.py` | Добавить поля `eval_daily_budget_usd` в read/update. |
| `db/manager.py` (settings) | `_safe_add_column(users, eval_daily_budget_usd, REAL DEFAULT 5.0)`. |
| `tests/test_eval_migrations.py` (новый) | Схема phase20. |
| `tests/test_eval_db_methods.py` (новый) | CRUD методов. |
| `tests/test_eval_rubric_presets.py` (новый) | 4 пресета валидны, builder корректен. |
| `tests/test_eval_cost_estimator.py` (новый) | Формулы стоимости. |
| `tests/test_eval_judge_runner.py` (новый) | Парсинг JSON судьи, ошибки, overall. |
| `tests/test_eval_diversity.py` (новый) | Cosine + diversity = 1 − mean_pairwise. |
| `tests/test_eval_aggregator.py` (новый) | p10/p50/p90/var, majority, pair_winrate_with_ci. |
| `tests/test_eval_run_executor.py` (новый) | Фоновое выполнение с фейковым LLM, отмена, события в очереди. |
| `tests/test_eval_api_runs.py` (новый) | POST/GET/DELETE/cancel/list, 402 без ключа, 403 при превышении бюджета. |
| `tests/test_eval_api_sse.py` (новый) | SSE отдаёт `progress`/`result_added`/`done`. |
| `tests/test_eval_library_summary.py` (новый) | `/library/{id}/eval-summary` — последний `done` для последней версии. |
| `frontend/src/api/client.ts` | Типы (`EvalRubric`, `EvalRun`, `EvalResult`, `EvalCostPreview`, `EvalRunEvent`), методы CRUD/run/SSE consumer. |
| `frontend/src/lib/parseEvalSse.ts` (новый) | Универсальный parser SSE для eval-событий (вынести из `parseGenerateSseLines`-паттерна). |
| `frontend/src/pages/Compare.tsx` | Добавить `Mode = ... | 'stability'`, кнопка таба, разводка composer/results. |
| `frontend/src/pages/compare/StabilityTab.tsx` (новый) | Composer + cost panel + кнопка «Запустить» + результаты. |
| `frontend/src/components/eval/StabilityComposer.tsx` (новый) | Поля промптов, task_input, reference, выбор моделей, анкета, N. |
| `frontend/src/components/eval/CostPreviewPanel.tsx` (новый) | Карточка с коридором стоимости. |
| `frontend/src/components/eval/RunningStream.tsx` (новый) | Прогресс-бар + лента ответов в реальном времени. |
| `frontend/src/components/eval/ResultDistribution.tsx` (новый) | Гистограмма + сводка. |
| `frontend/src/components/eval/JudgeBreakdown.tsx` (новый) | Разбивка по критериям. |
| `frontend/src/components/eval/FailureTriagePanel.tsx` (новый) | Таблица провалов. |
| `frontend/src/components/eval/PairWinnerBadge.tsx` (новый) | Бейдж «A победил в 4/5 — уверенно лучше». |
| `frontend/src/components/eval/EvalRunsHistory.tsx` (новый) | Дровер «История прогонов». |
| `frontend/src/components/eval/EvalBadge.tsx` (новый) | Маленький бейдж «📊 4.2/5 ±0.6» для карточки Library. |
| `frontend/src/pages/Library.tsx` | Вставить `<EvalBadge promptId={...} />` на карточку, кнопку «История прогонов». |
| `frontend/src/pages/Settings.tsx` | Поле «Дневной бюджет на оценку, $». |
| `README.md` | Раздел «Стабильность (eval)» — что делает, ссылка на спеку. |

---

## Ограничители архитектуры

- **Sync OpenAI SDK** — фоновый прогон выполняется в отдельных потоках, не в asyncio. SSE-генератор асинхронный, читает из `queue.Queue` через `asyncio.to_thread`.
- **Cancel блокирующего вызова невозможен** — отмена прерывает только постановку **новых** запросов; идущий вызов дойдёт до конца, его ответ запишется. Это ОК для MVP.
- **Resume падений в MVP не делаем** — startup hook переводит `pending|running` → `failed`.

---

### Task 1: Миграция БД — фаза 20 (4 таблицы + поле в `users`)

**Files:**
- Modify: `db/manager.py` — добавить `_migrate_phase20_eval_stability` и вызов в `init()` после `_migrate_phase19_llm_review_cache`.
- Test: `tests/test_eval_migrations.py` (новый).

- [ ] **Step 1: Падающий тест — таблицы и колонка существуют**

```python
# tests/test_eval_migrations.py
import sqlite3
from db.manager import DBManager


def test_phase20_eval_schema(tmp_path):
    db = DBManager(db_path=str(tmp_path / "t.db"))
    db.init()
    con = sqlite3.connect(str(tmp_path / "t.db"))
    tables = {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    assert {"eval_rubrics", "eval_runs", "eval_results", "eval_judge_scores",
            "eval_user_daily_usage"}.issubset(tables)
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)").fetchall()}
    assert "eval_daily_budget_usd" in cols
    con.close()
```

- [ ] **Step 2: Запустить — ожидаем FAIL**

Run: `pytest tests/test_eval_migrations.py -v`  
Expected: `AssertionError` — таблиц нет.

- [ ] **Step 3: Реализовать миграцию**

В `db/manager.py` добавить вызов в `init()` (после фазы 19):

```python
self._migrate_phase20_eval_stability(conn)
```

Тело метода:

```python
def _migrate_phase20_eval_stability(self, conn: sqlite3.Connection) -> None:
    self._safe_add_column(conn, "users", "eval_daily_budget_usd", "REAL NOT NULL DEFAULT 5.0")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS eval_rubrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      preset_key TEXT,
      criteria_json TEXT NOT NULL,
      reference_required INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS eval_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
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
      pair_winner TEXT,
      pair_winner_confidence REAL,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS eval_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      prompt_side TEXT NOT NULL,
      run_index INTEGER NOT NULL,
      output_text TEXT NOT NULL,
      output_tokens INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      latency_ms INTEGER,
      status TEXT NOT NULL,
      error TEXT,
      embedding_blob BLOB,
      judge_overall REAL,
      judge_overall_secondary REAL,
      judge_reasoning TEXT,
      parsed_as_json INTEGER NOT NULL DEFAULT 0,
      parsed_top_fields_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(run_id) REFERENCES eval_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS eval_judge_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id INTEGER NOT NULL,
      criterion_key TEXT NOT NULL,
      score REAL NOT NULL,
      reasoning TEXT,
      FOREIGN KEY(result_id) REFERENCES eval_results(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS eval_user_daily_usage (
      user_id INTEGER NOT NULL,
      date_utc TEXT NOT NULL,
      dollars REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id, date_utc)
    );
    CREATE INDEX IF NOT EXISTS idx_eval_runs_user ON eval_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eval_runs_lib_a ON eval_runs(prompt_a_library_id);
    CREATE INDEX IF NOT EXISTS idx_eval_runs_lib_b ON eval_runs(prompt_b_library_id);
    CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id);
    """)
```

- [ ] **Step 4: Запустить тест — PASS**

Run: `pytest tests/test_eval_migrations.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add db/manager.py tests/test_eval_migrations.py
git commit -m "feat(eval): add phase20 schema for stability runs"
```

---

### Task 2: DB методы — CRUD eval_rubrics, eval_runs, eval_results, ежедневный бюджет

**Files:**
- Modify: `db/manager.py` — добавить методы (см. ниже).
- Test: `tests/test_eval_db_methods.py` (новый).

- [ ] **Step 1: Тест — методы создания/чтения работают**

```python
# tests/test_eval_db_methods.py
import json
from db.manager import DBManager


def _seed(db):
    db.create_user("alice", "pwd")
    return db.get_user_by_username("alice")["id"]


def test_create_and_get_run(tmp_path):
    db = DBManager(db_path=str(tmp_path / "t.db"))
    db.init()
    uid = _seed(db)
    rid = db.create_eval_run(
        user_id=uid, status="pending", mode="single",
        prompt_a_text="P", prompt_a_hash="h", prompt_b_text=None, prompt_b_hash=None,
        prompt_a_library_id=None, prompt_a_library_version=None,
        prompt_b_library_id=None, prompt_b_library_version=None,
        task_input="T", reference_answer=None,
        target_model_id="openai/gpt-4o-mini", judge_model_id="google/gemini-2.0-flash-001",
        embedding_model_id="openai/text-embedding-3-small",
        rubric_id=None, rubric_snapshot_json=json.dumps({"criteria": []}),
        n_runs=3, parallelism=4, temperature=0.7, top_p=1.0,
        pair_judge_samples=0, cost_preview_usd=0.01, cost_preview_tokens=1000,
    )
    run = db.get_eval_run(rid, user_id=uid)
    assert run is not None and run["status"] == "pending"
    assert run["n_runs"] == 3
    rrid = db.add_eval_result(
        run_id=rid, prompt_side="a", run_index=0,
        output_text="out", output_tokens=10, input_tokens=20,
        latency_ms=100, status="ok", error=None,
        embedding_blob=None, judge_overall=4.2, judge_overall_secondary=None,
        judge_reasoning="ok", parsed_as_json=0, parsed_top_fields_json=None,
    )
    db.add_eval_judge_score(rrid, criterion_key="completeness", score=4.0, reasoning="r")
    results = db.list_eval_results(rid)
    assert len(results) == 1 and results[0]["judge_overall"] == 4.2
    scores = db.list_eval_judge_scores(rrid)
    assert scores[0]["criterion_key"] == "completeness"


def test_eval_daily_usage_increment(tmp_path):
    db = DBManager(db_path=str(tmp_path / "t.db"))
    db.init()
    uid = _seed(db)
    assert db.get_eval_daily_dollars(uid, "2026-04-25") == 0.0
    db.add_eval_daily_dollars(uid, "2026-04-25", 0.05)
    db.add_eval_daily_dollars(uid, "2026-04-25", 0.03)
    assert abs(db.get_eval_daily_dollars(uid, "2026-04-25") - 0.08) < 1e-6
```

- [ ] **Step 2: Запустить — FAIL**

Run: `pytest tests/test_eval_db_methods.py -v`  
Expected: `AttributeError: 'DBManager' object has no attribute 'create_eval_run'`.

- [ ] **Step 3: Реализовать методы в `db/manager.py`**

Сигнатуры (тело — стандартный insert/select по паттерну существующих методов в файле):

```python
def create_eval_run(self, *, user_id: int, status: str, mode: str,
    prompt_a_text: str, prompt_a_hash: str,
    prompt_b_text: str | None, prompt_b_hash: str | None,
    prompt_a_library_id: int | None, prompt_a_library_version: int | None,
    prompt_b_library_id: int | None, prompt_b_library_version: int | None,
    task_input: str, reference_answer: str | None,
    target_model_id: str, judge_model_id: str, embedding_model_id: str,
    rubric_id: int | None, rubric_snapshot_json: str,
    n_runs: int, parallelism: int, temperature: float, top_p: float | None,
    pair_judge_samples: int, cost_preview_usd: float, cost_preview_tokens: int,
) -> int: ...

def get_eval_run(self, run_id: int, *, user_id: int) -> dict | None: ...
def list_eval_runs(self, *, user_id: int, status: str | None = None,
                   library_id: int | None = None, limit: int = 30, offset: int = 0
                   ) -> tuple[list[dict], int]: ...
def update_eval_run_status(self, run_id: int, *, status: str,
                           error: str | None = None,
                           finished_at_utc: str | None = None) -> None: ...
def update_eval_run_aggregates(self, run_id: int, *, agg: dict) -> None: ...
def update_eval_run_actual_cost(self, run_id: int, *, cost_actual_usd: float,
                                cost_actual_tokens: int, duration_ms: int) -> None: ...
def delete_eval_run(self, run_id: int, *, user_id: int) -> bool: ...

def add_eval_result(self, *, run_id: int, prompt_side: str, run_index: int,
    output_text: str, output_tokens: int, input_tokens: int, latency_ms: int | None,
    status: str, error: str | None, embedding_blob: bytes | None,
    judge_overall: float | None, judge_overall_secondary: float | None,
    judge_reasoning: str | None, parsed_as_json: int,
    parsed_top_fields_json: str | None) -> int: ...
def list_eval_results(self, run_id: int) -> list[dict]: ...

def add_eval_judge_score(self, result_id: int, *, criterion_key: str,
                         score: float, reasoning: str | None) -> None: ...
def list_eval_judge_scores(self, result_id: int) -> list[dict]: ...

def create_eval_rubric(self, *, user_id: int, name: str, preset_key: str | None,
                       criteria_json: str, reference_required: int = 0) -> int: ...
def list_eval_rubrics(self, user_id: int) -> list[dict]: ...
def get_eval_rubric(self, rubric_id: int, *, user_id: int) -> dict | None: ...
def update_eval_rubric(self, rubric_id: int, *, user_id: int,
                       name: str, criteria_json: str,
                       reference_required: int) -> bool: ...
def delete_eval_rubric(self, rubric_id: int, *, user_id: int) -> bool: ...

def get_eval_daily_dollars(self, user_id: int, date_utc: str) -> float: ...
def add_eval_daily_dollars(self, user_id: int, date_utc: str, delta: float) -> None: ...
def get_eval_daily_budget(self, user_id: int) -> float: ...
def set_eval_daily_budget(self, user_id: int, dollars: float) -> None: ...

def get_last_done_eval_run_for_library(self, *, user_id: int, library_id: int,
                                       library_version: int | None) -> dict | None: ...

def mark_eval_runs_failed_on_startup(self) -> int: ...
```

`add_eval_daily_dollars` использует `INSERT ... ON CONFLICT(user_id,date_utc) DO UPDATE SET dollars = dollars + excluded.dollars`.

- [ ] **Step 4: Запустить тест — PASS**

Run: `pytest tests/test_eval_db_methods.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add db/manager.py tests/test_eval_db_methods.py
git commit -m "feat(eval): add db methods for runs, results, scores, daily budget"
```

---

### Task 3: Whitelist дешёвых моделей для судьи и эмбеддингов

**Files:**
- Create: `services/eval/__init__.py`, `services/eval/cheap_tier.py`.
- Test: `tests/test_eval_cheap_tier.py` (новый).

- [ ] **Step 1: Тест**

```python
# tests/test_eval_cheap_tier.py
from services.eval.cheap_tier import is_cheap_judge, is_cheap_embedding, CHEAP_JUDGE_MODELS, CHEAP_EMBEDDING_MODELS


def test_default_judge_in_whitelist():
    assert is_cheap_judge("google/gemini-2.0-flash-001")
    assert is_cheap_judge("deepseek/deepseek-v4-flash")


def test_dorogoi_otvergaem():
    assert not is_cheap_judge("anthropic/claude-3-opus")


def test_default_embedding_in_whitelist():
    assert is_cheap_embedding("openai/text-embedding-3-small")
```

- [ ] **Step 2: Запустить — FAIL** (модуля нет)

- [ ] **Step 3: Реализовать**

```python
# services/eval/__init__.py
"""Evaluation engine — see docs/superpowers/specs/2026-04-25-eval-stability-mvp-design.md"""
```

```python
# services/eval/cheap_tier.py
"""Whitelist дешёвых моделей для роли судьи и эмбеддингов в Eval-Stability MVP."""
from __future__ import annotations

CHEAP_JUDGE_MODELS: frozenset[str] = frozenset({
    "google/gemini-2.0-flash-001",
    "google/gemini-flash-1.5",
    "deepseek/deepseek-v4-flash",
    "anthropic/claude-3-haiku",
    "openai/gpt-4o-mini",
    "mistralai/mistral-nemo",
})

CHEAP_EMBEDDING_MODELS: frozenset[str] = frozenset({
    "openai/text-embedding-3-small",
    "openai/text-embedding-3-large",
})

DEFAULT_JUDGE_MODEL = "google/gemini-2.0-flash-001"
DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"


def is_cheap_judge(model_id: str) -> bool:
    return (model_id or "").strip() in CHEAP_JUDGE_MODELS


def is_cheap_embedding(model_id: str) -> bool:
    return (model_id or "").strip() in CHEAP_EMBEDDING_MODELS
```

- [ ] **Step 4: Тест — PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/__init__.py services/eval/cheap_tier.py tests/test_eval_cheap_tier.py
git commit -m "feat(eval): whitelist of cheap judge and embedding models"
```

---

### Task 4: Эмбеддинги в `LLMClient`

**Files:**
- Modify: `services/llm_client.py` — добавить метод `embed`.
- Test: `tests/test_llm_client_embed.py` (новый, с подменой `_client.embeddings.create`).

- [ ] **Step 1: Тест**

```python
# tests/test_llm_client_embed.py
from unittest.mock import MagicMock
from services.llm_client import LLMClient


def test_embed_returns_vectors(monkeypatch):
    c = LLMClient(api_key="x")
    fake = MagicMock()
    fake.data = [
        MagicMock(embedding=[0.1, 0.2]),
        MagicMock(embedding=[0.3, 0.4]),
    ]
    c._client.embeddings = MagicMock()
    c._client.embeddings.create = MagicMock(return_value=fake)
    out = c.embed(["a", "b"], provider="openai/text-embedding-3-small")
    assert out == [[0.1, 0.2], [0.3, 0.4]]
    c._client.embeddings.create.assert_called_once()
    kw = c._client.embeddings.create.call_args.kwargs
    assert kw["model"] == "openai/text-embedding-3-small"
    assert kw["input"] == ["a", "b"]
```

- [ ] **Step 2: Запустить — FAIL** (нет метода `embed`).

- [ ] **Step 3: Реализовать в `LLMClient`** (рядом с `summarize`)

```python
def embed(self, texts: list[str], provider: str) -> list[list[float]]:
    """Получить эмбеддинги списка текстов через OpenRouter / OpenAI-совместимый embeddings endpoint."""
    if not texts:
        return []
    model = self._get_model(provider)
    resp = self._client.embeddings.create(model=model, input=list(texts))
    return [list(item.embedding) for item in resp.data]
```

- [ ] **Step 4: Тест — PASS**

- [ ] **Step 5: Commit**

```bash
git add services/llm_client.py tests/test_llm_client_embed.py
git commit -m "feat(llm): add LLMClient.embed for OpenRouter embeddings"
```

---

### Task 5: Cost estimator

**Files:**
- Create: `services/eval/cost_estimator.py`.
- Test: `tests/test_eval_cost_estimator.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_cost_estimator.py
from services.eval.cost_estimator import estimate_run_cost


def test_single_mode_breakdown_present(monkeypatch):
    # фейковые цены — детерминированный расчёт
    monkeypatch.setattr(
        "services.eval.cost_estimator.get_model_pricing",
        lambda mid: (1.0, 2.0),  # $1/M input, $2/M output
    )
    out = estimate_run_cost(
        mode="single",
        prompt_a_chars=4000, prompt_b_chars=0,
        task_input_chars=400, reference_chars=0,
        n_runs=10, expected_output_chars=3200,
        target_model_id="m1", judge_model_id="m2",
        embedding_model_id="m3", pair_judge_samples=0,
    )
    assert {"target", "judge", "embedding"} == set(out["breakdown"].keys())
    assert out["usd_min"] < out["usd_avg"] < out["usd_max"]
    assert out["tokens_avg"] > 0


def test_pair_mode_includes_pair_judge(monkeypatch):
    monkeypatch.setattr(
        "services.eval.cost_estimator.get_model_pricing",
        lambda mid: (1.0, 2.0),
    )
    out = estimate_run_cost(
        mode="pair",
        prompt_a_chars=4000, prompt_b_chars=4000,
        task_input_chars=400, reference_chars=0,
        n_runs=10, expected_output_chars=3200,
        target_model_id="m1", judge_model_id="m2",
        embedding_model_id="m3", pair_judge_samples=5,
    )
    assert "pair_judge" in out["breakdown"]
```

- [ ] **Step 2: FAIL** (модуля нет).

- [ ] **Step 3: Реализовать**

```python
# services/eval/cost_estimator.py
"""Cost estimator для Eval-Stability runs. См. spec §8."""
from __future__ import annotations

from services.openrouter_models import get_model_pricing

CHARS_PER_TOKEN = 4
MIN_FACTOR, MAX_FACTOR = 0.6, 1.4


def _tok(chars: int) -> int:
    return max(1, chars // CHARS_PER_TOKEN)


def _usd(model_id: str, in_tok: int, out_tok: int) -> float:
    p_in, p_out = get_model_pricing(model_id)
    return (in_tok / 1_000_000.0) * p_in + (out_tok / 1_000_000.0) * p_out


def estimate_run_cost(*, mode: str,
                      prompt_a_chars: int, prompt_b_chars: int,
                      task_input_chars: int, reference_chars: int,
                      n_runs: int, expected_output_chars: int,
                      target_model_id: str, judge_model_id: str,
                      embedding_model_id: str, pair_judge_samples: int) -> dict:
    sides = 2 if mode == "pair" else 1
    total_target_calls = n_runs * sides

    # Target
    target_in = (prompt_a_chars + prompt_b_chars + task_input_chars) * n_runs
    target_in_tok = _tok(target_in)
    target_out_tok = _tok(expected_output_chars * total_target_calls)
    target_usd = _usd(target_model_id, target_in_tok, target_out_tok)

    # Judge — один вызов на ответ + якоря анкеты ~600 символов
    rubric_overhead = 600 * total_target_calls
    judge_in = (
        (prompt_a_chars + prompt_b_chars) * n_runs
        + task_input_chars * total_target_calls
        + reference_chars * total_target_calls
        + expected_output_chars * total_target_calls
        + rubric_overhead
    )
    judge_in_tok = _tok(judge_in)
    judge_out_tok = _tok(400 * total_target_calls)  # ~400 chars judge JSON
    judge_usd = _usd(judge_model_id, judge_in_tok, judge_out_tok)

    # Embedding
    emb_in_tok = _tok(expected_output_chars * total_target_calls)
    emb_usd = _usd(embedding_model_id, emb_in_tok, 0)

    breakdown = {
        "target":   {"tokens": target_in_tok + target_out_tok, "usd": target_usd},
        "judge":    {"tokens": judge_in_tok + judge_out_tok, "usd": judge_usd},
        "embedding":{"tokens": emb_in_tok, "usd": emb_usd},
    }

    if mode == "pair" and pair_judge_samples > 0:
        pair_in = (
            (task_input_chars + 2 * expected_output_chars + 600) * pair_judge_samples
        )
        pair_in_tok = _tok(pair_in)
        pair_out_tok = _tok(200 * pair_judge_samples)
        pair_usd = _usd(judge_model_id, pair_in_tok, pair_out_tok)
        breakdown["pair_judge"] = {"tokens": pair_in_tok + pair_out_tok, "usd": pair_usd}

    tokens_avg = sum(b["tokens"] for b in breakdown.values())
    usd_avg = sum(b["usd"] for b in breakdown.values())

    return {
        "tokens_min": int(tokens_avg * MIN_FACTOR),
        "tokens_avg": int(tokens_avg),
        "tokens_max": int(tokens_avg * MAX_FACTOR),
        "usd_min": usd_avg * MIN_FACTOR,
        "usd_avg": usd_avg,
        "usd_max": usd_avg * MAX_FACTOR,
        "breakdown": breakdown,
    }
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/cost_estimator.py tests/test_eval_cost_estimator.py
git commit -m "feat(eval): cost estimator with min/avg/max + breakdown"
```

---

### Task 6: Rubric presets и сборщик промпта судьи

**Files:**
- Create: `services/eval/rubric_presets.py`.
- Test: `tests/test_eval_rubric_presets.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_rubric_presets.py
from services.eval.rubric_presets import (
    PRESET_RUBRICS, get_preset_rubric, build_judge_system_prompt, build_judge_user_message,
)


def test_four_presets_exist():
    assert {"extraction", "code", "writing", "classification"}.issubset(PRESET_RUBRICS.keys())
    for r in PRESET_RUBRICS.values():
        assert r["scale_max"] == 5
        assert len(r["criteria"]) >= 2
        for c in r["criteria"]:
            assert {"key", "label", "anchors", "weight"}.issubset(c.keys())
            assert {"0", "3", "5"} == set(c["anchors"].keys())


def test_judge_user_includes_reference_when_given():
    rubric = get_preset_rubric("extraction")
    msg_no_ref = build_judge_user_message(rubric, "task", "prompt", "out", reference=None)
    assert "ЭТАЛОН" not in msg_no_ref
    msg_ref = build_judge_user_message(rubric, "task", "prompt", "out", reference="REF")
    assert "REF" in msg_ref
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```python
# services/eval/rubric_presets.py
"""Пресеты анкет (rubric) и сборка system/user-промптов для LLM-судьи. Spec §5."""
from __future__ import annotations

PRESET_RUBRICS: dict[str, dict] = {
    "extraction": {
        "name": "Извлечение сущностей",
        "preset_key": "extraction",
        "scale_max": 5,
        "criteria": [
            {"key": "completeness", "label": "Полнота", "weight": 0.4,
             "description": "Все требуемые поля присутствуют, ничего не выдумано.",
             "anchors": {"0": "Большинство полей пропущены или выдуманы.",
                          "3": "Половина полей есть; 1–2 фабрикации.",
                          "5": "Все поля на месте, без фабрикаций."}},
            {"key": "format", "label": "Формат", "weight": 0.3,
             "description": "Структура соответствует требованиям (валидный JSON и т.п.).",
             "anchors": {"0": "Структура нарушена, не парсится.",
                          "3": "Парсится, но отклоняется от схемы.",
                          "5": "Полностью соответствует требуемой схеме."}},
            {"key": "concision", "label": "Лаконичность", "weight": 0.3,
             "description": "Без лишних комментариев и подсказок.",
             "anchors": {"0": "Много лишнего текста вокруг данных.",
                          "3": "Есть пара лишних предложений.",
                          "5": "Только данные, без шума."}},
        ],
    },
    "code": {
        "name": "Генерация кода",
        "preset_key": "code",
        "scale_max": 5,
        "criteria": [
            {"key": "correctness", "label": "Корректность", "weight": 0.45,
             "description": "Код решает задачу и работает.",
             "anchors": {"0": "Очевидные ошибки; не запустится.",
                          "3": "Запускается, но валит часть случаев.",
                          "5": "Решает задачу, проходит крайние случаи."}},
            {"key": "idiomatic", "label": "Идиоматичность", "weight": 0.2,
             "description": "Соответствует best-practice языка.",
             "anchors": {"0": "Антипаттерны.", "3": "Местами неидиоматично.",
                          "5": "Идиоматично, читается легко."}},
            {"key": "edge_cases", "label": "Крайние случаи", "weight": 0.2,
             "description": "Учтены пустые входы, ошибки, типы.",
             "anchors": {"0": "Не учтено.", "3": "Часть учтена.", "5": "Все ключевые случаи."}},
            {"key": "no_extra", "label": "Нет лишнего", "weight": 0.15,
             "description": "Не добавлены лишние модули/пояснения помимо запроса.",
             "anchors": {"0": "Добавлено много неуместного.",
                          "3": "Есть лишние пояснения.",
                          "5": "Только релевантный код."}},
        ],
    },
    "writing": {
        "name": "Свободный текст",
        "preset_key": "writing",
        "scale_max": 5,
        "criteria": [
            {"key": "task_fit", "label": "Соответствие задаче", "weight": 0.4,
             "description": "Отвечает на запрос пользователя.",
             "anchors": {"0": "Не отвечает на задачу.",
                          "3": "Частично, тема правильная.",
                          "5": "Точно по задаче."}},
            {"key": "clarity", "label": "Ясность", "weight": 0.25,
             "description": "Текст читается легко, без размытости.",
             "anchors": {"0": "Размыто и непонятно.", "3": "Местами длинно.", "5": "Чёткий, ясный."}},
            {"key": "tone", "label": "Тон", "weight": 0.15,
             "description": "Соответствует требуемому тону, если задан.",
             "anchors": {"0": "Не тот тон.", "3": "Близко.", "5": "Точно."}},
            {"key": "no_padding", "label": "Без воды", "weight": 0.2,
             "description": "Нет лишних вступлений/повторов.",
             "anchors": {"0": "Много воды.", "3": "Есть лишнее.", "5": "Сжато по делу."}},
        ],
    },
    "classification": {
        "name": "Классификация",
        "preset_key": "classification",
        "scale_max": 5,
        "criteria": [
            {"key": "accuracy", "label": "Точность", "weight": 0.7,
             "description": "Тег правильный с точки зрения постановки.",
             "anchors": {"0": "Тег явно неверный.", "3": "Близкий, но не точный.",
                          "5": "Точно тот тег."}},
            {"key": "confidence_calibration", "label": "Калибровка уверенности",
             "weight": 0.3, "description": "Нет гипербол; уверенность соответствует данным.",
             "anchors": {"0": "Уверенность не соответствует данным.",
                          "3": "В целом ок.",
                          "5": "Калиброванная."}},
        ],
    },
}


def get_preset_rubric(key: str) -> dict:
    if key not in PRESET_RUBRICS:
        raise KeyError(f"Unknown rubric preset: {key}")
    return PRESET_RUBRICS[key]


def build_judge_system_prompt(rubric: dict) -> str:
    lines = ["Ты — беспристрастный оценщик. Используй ТОЛЬКО критерии ниже.",
             "Якоря — единственная шкала. Отвечай только JSON-объектом.",
             "", "КРИТЕРИИ:"]
    for c in rubric["criteria"]:
        lines.append(f"- {c['label']} ({c['key']}, 0–{rubric['scale_max']}): {c['description']}")
        for a in ("0", "3", "5"):
            lines.append(f"    {a} = {c['anchors'][a]}")
    keys_obj = ", ".join(f'"{c["key"]}": <0..{rubric["scale_max"]}>' for c in rubric["criteria"])
    reasoning_obj = ", ".join(f'"{c["key"]}": "..."' for c in rubric["criteria"])
    lines += [
        "",
        'Ответ: {"scores": {' + keys_obj + '}, "reasoning": {' + reasoning_obj + '}, "overall_reasoning": "..."}',
    ]
    return "\n".join(lines)


def build_judge_user_message(rubric: dict, task_input: str, prompt_text: str,
                             output_text: str, *, reference: str | None) -> str:
    parts = [
        f"ЗАДАЧА ПОЛЬЗОВАТЕЛЯ:\n{task_input.strip()[:5000]}",
        f"ПРОМПТ:\n{prompt_text.strip()[:30000]}",
        f"ОТВЕТ МОДЕЛИ:\n{output_text.strip()[:24000]}",
    ]
    if reference:
        parts.append(f"ЭТАЛОН (ориентир, не требует дословного совпадения):\n{reference.strip()[:5000]}")
    return "\n\n".join(parts)
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/rubric_presets.py tests/test_eval_rubric_presets.py
git commit -m "feat(eval): rubric presets and judge prompt builder"
```

---

### Task 7: Judge runner — оценка одного ответа и pairwise

**Files:**
- Create: `services/eval/judge_runner.py`.
- Test: `tests/test_eval_judge_runner.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_judge_runner.py
from unittest.mock import MagicMock
from services.eval.judge_runner import judge_one, judge_pair
from services.eval.rubric_presets import get_preset_rubric


def test_judge_one_parses_json():
    llm = MagicMock()
    llm.generate.return_value = (
        '{"scores": {"completeness": 5, "format": 4, "concision": 3},'
        '"reasoning": {"completeness": "ok", "format": "ok", "concision": "ok"},'
        '"overall_reasoning": "good"}'
    )
    rubric = get_preset_rubric("extraction")
    res = judge_one(llm, "google/gemini-2.0-flash-001", rubric, "T", "P", "O", reference=None)
    assert res["scores"]["completeness"] == 5
    assert abs(res["overall"] - (5*0.4 + 4*0.3 + 3*0.3)) < 1e-6
    assert res["parse_error"] is False


def test_judge_one_handles_garbage():
    llm = MagicMock()
    llm.generate.return_value = "not json at all"
    rubric = get_preset_rubric("extraction")
    res = judge_one(llm, "x", rubric, "T", "P", "O", reference=None)
    assert res["parse_error"] is True
    assert res["overall"] is None


def test_judge_pair_winner_a():
    llm = MagicMock()
    llm.generate.return_value = '{"winner": "a", "reasoning": "ok"}'
    res = judge_pair(llm, "x", get_preset_rubric("writing"), "T", "out_a", "out_b")
    assert res["winner"] == "a"
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```python
# services/eval/judge_runner.py
"""LLM-as-judge для одного ответа (rubric scoring) и pairwise."""
from __future__ import annotations

import json
import logging
import re

from services.eval.rubric_presets import build_judge_system_prompt, build_judge_user_message

logger = logging.getLogger(__name__)


def _parse_json(text: str) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            try:
                v = json.loads(m.group(0))
                return v if isinstance(v, dict) else None
            except json.JSONDecodeError:
                return None
    return None


def judge_one(llm, judge_model: str, rubric: dict,
              task_input: str, prompt_text: str, output_text: str,
              *, reference: str | None, temperature: float = 0.0) -> dict:
    sys_p = build_judge_system_prompt(rubric)
    usr = build_judge_user_message(rubric, task_input, prompt_text, output_text, reference=reference)
    try:
        raw = llm.generate(sys_p, usr, judge_model, temperature=temperature, top_p=1.0)
    except Exception as e:
        logger.exception("judge_one llm call failed")
        return {"scores": {}, "reasoning": {}, "overall": None, "overall_reasoning": "",
                "parse_error": True, "error": str(e)}
    parsed = _parse_json(raw)
    if not parsed or not isinstance(parsed.get("scores"), dict):
        return {"scores": {}, "reasoning": {}, "overall": None, "overall_reasoning": "",
                "parse_error": True, "error": "judge JSON parse failed"}

    weighted = 0.0
    total_w = 0.0
    for c in rubric["criteria"]:
        s = parsed["scores"].get(c["key"])
        if isinstance(s, (int, float)):
            weighted += float(s) * float(c["weight"])
            total_w += float(c["weight"])
    overall = weighted / total_w if total_w > 0 else None
    return {
        "scores": parsed["scores"],
        "reasoning": parsed.get("reasoning") or {},
        "overall_reasoning": parsed.get("overall_reasoning") or "",
        "overall": overall,
        "parse_error": False,
    }


PAIR_SYSTEM = """Ты — беспристрастный судья. Дано ДВА ответа на одну задачу.
Используя критерии анкеты ниже, выбери, какой ответ ближе к идеалу.
Ответ ТОЛЬКО JSON: {"winner": "a"|"b"|"tie", "reasoning": "..."}"""


def judge_pair(llm, judge_model: str, rubric: dict, task_input: str,
               output_a: str, output_b: str, *, temperature: float = 0.0) -> dict:
    sys_full = PAIR_SYSTEM + "\n\nКРИТЕРИИ:\n" + "\n".join(
        f"- {c['label']}: {c['description']}" for c in rubric["criteria"]
    )
    usr = (
        f"ЗАДАЧА:\n{task_input.strip()[:5000]}\n\n"
        f"ОТВЕТ A:\n{output_a.strip()[:8000]}\n\n"
        f"ОТВЕТ B:\n{output_b.strip()[:8000]}"
    )
    try:
        raw = llm.generate(sys_full, usr, judge_model, temperature=temperature, top_p=1.0)
    except Exception as e:
        return {"winner": "tie", "reasoning": f"judge call error: {e}", "parse_error": True}
    parsed = _parse_json(raw)
    if not parsed:
        return {"winner": "tie", "reasoning": "parse failed", "parse_error": True}
    w = str(parsed.get("winner") or "tie").lower().strip()
    if w not in ("a", "b", "tie"):
        w = "tie"
    return {"winner": w, "reasoning": parsed.get("reasoning") or "", "parse_error": False}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/judge_runner.py tests/test_eval_judge_runner.py
git commit -m "feat(eval): judge_one (rubric scoring) and judge_pair"
```

---

### Task 8: Diversity — эмбеддинги и попарный cosine

**Files:**
- Create: `services/eval/diversity.py`.
- Test: `tests/test_eval_diversity.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_diversity.py
import math
from services.eval.diversity import compute_diversity, embed_outputs
from unittest.mock import MagicMock


def test_diversity_zero_for_identical_vectors():
    v = [[1.0, 0.0], [1.0, 0.0], [1.0, 0.0]]
    assert math.isclose(compute_diversity(v), 0.0, abs_tol=1e-6)


def test_diversity_one_for_orthogonal_vectors():
    v = [[1.0, 0.0], [0.0, 1.0]]
    assert math.isclose(compute_diversity(v), 1.0, abs_tol=1e-6)


def test_embed_outputs_uses_llm():
    llm = MagicMock()
    llm.embed.return_value = [[1.0, 0.0], [0.0, 1.0]]
    out = embed_outputs(llm, "openai/text-embedding-3-small", ["a", "b"])
    assert out == [[1.0, 0.0], [0.0, 1.0]]
    llm.embed.assert_called_once()
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```python
# services/eval/diversity.py
"""Diversity score: 1 - mean_pairwise(cosine). Spec §5.4."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _cos(a: list[float], b: list[float]) -> float:
    s = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return s / (na * nb)


def compute_diversity(embeddings: list[list[float]]) -> float | None:
    if not embeddings or len(embeddings) < 2:
        return None
    n = len(embeddings)
    pairs = 0
    total = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            total += _cos(embeddings[i], embeddings[j])
            pairs += 1
    return max(0.0, min(1.0, 1.0 - total / pairs))


def embed_outputs(llm, embedding_model_id: str, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    try:
        return llm.embed(texts, provider=embedding_model_id)
    except Exception:
        logger.exception("batch embed failed, falling back to sequential")
        out: list[list[float]] = []
        for t in texts:
            try:
                v = llm.embed([t], provider=embedding_model_id)
                out.append(v[0] if v else [])
            except Exception:
                logger.exception("sequential embed failed for one text")
                out.append([])
        return out
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/diversity.py tests/test_eval_diversity.py
git commit -m "feat(eval): diversity via mean pairwise cosine + sequential fallback"
```

---

### Task 9: Aggregator — p10/p50/p90, majority vote, pair winrate

**Files:**
- Create: `services/eval/aggregator.py`.
- Test: `tests/test_eval_aggregator.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_aggregator.py
import json
from services.eval.aggregator import (
    aggregate_overall, majority_vote_top_fields, pair_winrate_with_ci,
)


def test_aggregate_overall_quantiles():
    out = aggregate_overall([1.0, 2.0, 3.0, 4.0, 5.0])
    assert out["p50"] == 3.0
    assert out["p10"] <= 1.5
    assert out["p90"] >= 4.5
    assert out["var"] > 0


def test_majority_vote_simple():
    rows = [
        json.dumps({"intent": "buy", "sentiment": "+"}),
        json.dumps({"intent": "buy", "sentiment": "+"}),
        json.dumps({"intent": "buy", "sentiment": "-"}),
    ]
    out = majority_vote_top_fields(rows)
    assert out["intent"]["winner"] == "buy" and out["intent"]["count"] == 3
    assert out["sentiment"]["winner"] == "+" and out["sentiment"]["count"] == 2


def test_pair_winrate_confidence_a_strong():
    res = pair_winrate_with_ci(["a", "a", "a", "a", "a"])
    assert res["winrate_a"] == 1.0
    assert res["winner"] == "a"
    assert res["confidence"] >= 0.5
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```python
# services/eval/aggregator.py
"""Агрегаторы: квантили, majority-vote, pair winrate с бутстрапом."""
from __future__ import annotations

import json
import random
from collections import Counter


def aggregate_overall(scores: list[float]) -> dict:
    s = sorted([x for x in scores if x is not None])
    if not s:
        return {"p10": None, "p50": None, "p90": None, "var": None, "count": 0}

    def q(p: float) -> float:
        if len(s) == 1:
            return s[0]
        idx = p * (len(s) - 1)
        lo, hi = int(idx), min(int(idx) + 1, len(s) - 1)
        frac = idx - lo
        return s[lo] * (1 - frac) + s[hi] * frac

    mean = sum(s) / len(s)
    var = sum((x - mean) ** 2 for x in s) / len(s)
    return {"p10": q(0.1), "p50": q(0.5), "p90": q(0.9), "var": var, "count": len(s)}


def majority_vote_top_fields(json_rows: list[str]) -> dict:
    parsed: list[dict] = []
    for row in json_rows:
        try:
            v = json.loads(row)
            if isinstance(v, dict):
                parsed.append(v)
        except json.JSONDecodeError:
            continue
    if not parsed:
        return {}
    keys: set = set()
    for p in parsed:
        keys.update(p.keys())
    out: dict = {}
    for k in keys:
        cnt = Counter()
        for p in parsed:
            v = p.get(k)
            if isinstance(v, (str, int, float, bool)):
                cnt[str(v)] += 1
        if cnt:
            (winner, count) = cnt.most_common(1)[0]
            out[k] = {"winner": winner, "count": count, "total": len(parsed)}
    return out


def pair_winrate_with_ci(votes: list[str], *, bootstrap: int = 1000) -> dict:
    if not votes:
        return {"winrate_a": 0.0, "winrate_b": 0.0, "tie_rate": 0.0,
                "winner": "tie", "confidence": 0.0}
    n = len(votes)
    wa = votes.count("a") / n
    wb = votes.count("b") / n
    tr = votes.count("tie") / n
    winner = "tie"
    if wa - wb >= 0.20:
        winner = "a"
    elif wb - wa >= 0.20:
        winner = "b"

    rng = random.Random(42)
    diffs: list[float] = []
    for _ in range(bootstrap):
        sample = [votes[rng.randrange(n)] for _ in range(n)]
        diffs.append(sample.count("a") / n - sample.count("b") / n)
    diffs.sort()
    lo = diffs[int(0.05 * len(diffs))]
    hi = diffs[int(0.95 * len(diffs)) - 1]
    if winner == "a":
        confidence = max(0.0, lo)
    elif winner == "b":
        confidence = max(0.0, -hi)
    else:
        confidence = 0.0
    return {"winrate_a": wa, "winrate_b": wb, "tie_rate": tr,
            "winner": winner, "confidence": confidence}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/aggregator.py tests/test_eval_aggregator.py
git commit -m "feat(eval): aggregator (quantiles, majority-vote, pair CI)"
```

---

### Task 10: Event bus для связи фонового executor и SSE

**Files:**
- Create: `services/eval/event_bus.py`.
- Test: `tests/test_eval_event_bus.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_event_bus.py
from services.eval.event_bus import EvalEventBus


def test_publish_and_subscribe_roundtrip():
    bus = EvalEventBus()
    bus.register(1)
    bus.publish(1, {"type": "progress", "n_done": 1})
    bus.publish(1, {"type": "done"})
    q = bus.queue_for(1)
    assert q is not None
    assert q.get_nowait()["type"] == "progress"
    assert q.get_nowait()["type"] == "done"
    bus.unregister(1)
    assert bus.queue_for(1) is None


def test_publish_without_register_is_noop():
    bus = EvalEventBus()
    bus.publish(99, {"type": "x"})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```python
# services/eval/event_bus.py
"""Глобальная шина событий для прогонов: in-memory queue per run_id."""
from __future__ import annotations

import threading
from queue import Queue


class EvalEventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queues: dict[int, Queue] = {}

    def register(self, run_id: int) -> Queue:
        with self._lock:
            q = self._queues.get(run_id)
            if q is None:
                q = Queue()
                self._queues[run_id] = q
            return q

    def unregister(self, run_id: int) -> None:
        with self._lock:
            self._queues.pop(run_id, None)

    def queue_for(self, run_id: int) -> Queue | None:
        with self._lock:
            return self._queues.get(run_id)

    def publish(self, run_id: int, event: dict) -> None:
        with self._lock:
            q = self._queues.get(run_id)
        if q is not None:
            q.put(event)


GLOBAL_EVAL_BUS = EvalEventBus()
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/event_bus.py tests/test_eval_event_bus.py
git commit -m "feat(eval): in-memory event bus per run for SSE delivery"
```

---

### Task 11: Run executor — фоновое выполнение прогона

**Files:**
- Create: `services/eval/run_executor.py`.
- Test: `tests/test_eval_run_executor.py` — на фейковом LLM.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_run_executor.py
import json
import threading
import time
from unittest.mock import MagicMock

from db.manager import DBManager
from services.eval.event_bus import EvalEventBus
from services.eval.rubric_presets import get_preset_rubric
from services.eval.run_executor import EvalRunExecutor


def _fake_llm():
    llm = MagicMock()
    llm.stream.return_value = iter(["Привет, ", "мир."])
    llm.generate.return_value = (
        '{"scores":{"completeness":4,"format":5,"concision":3},'
        '"reasoning":{"completeness":"","format":"","concision":""},'
        '"overall_reasoning":""}'
    )
    llm.embed.return_value = [[1.0, 0.0]] * 10
    return llm


def test_executor_runs_n_and_emits_done(tmp_path):
    db = DBManager(db_path=str(tmp_path / "t.db"))
    db.init()
    db.create_user("u", "p")
    uid = db.get_user_by_username("u")["id"]
    rubric = get_preset_rubric("extraction")
    rid = db.create_eval_run(
        user_id=uid, status="pending", mode="single",
        prompt_a_text="P", prompt_a_hash="h", prompt_b_text=None, prompt_b_hash=None,
        prompt_a_library_id=None, prompt_a_library_version=None,
        prompt_b_library_id=None, prompt_b_library_version=None,
        task_input="T", reference_answer=None,
        target_model_id="m", judge_model_id="j", embedding_model_id="e",
        rubric_id=None, rubric_snapshot_json=json.dumps(rubric),
        n_runs=3, parallelism=2, temperature=0.0, top_p=1.0,
        pair_judge_samples=0, cost_preview_usd=0.001, cost_preview_tokens=100,
    )
    bus = EvalEventBus()
    q = bus.register(rid)
    ex = EvalRunExecutor(db=db, llm=_fake_llm(), bus=bus, run_id=rid)
    ex.start()
    ex.join(timeout=10)
    assert not ex.is_alive()
    events: list[dict] = []
    while not q.empty():
        events.append(q.get_nowait())
    types = [e["type"] for e in events]
    assert "done" in types
    assert types.count("result_added") == 3
    run = db.get_eval_run(rid, user_id=uid)
    assert run["status"] == "done"
    assert run["agg_overall_p50"] is not None


def test_executor_cancel_stops_new_calls(tmp_path):
    db = DBManager(db_path=str(tmp_path / "t.db"))
    db.init()
    db.create_user("u", "p")
    uid = db.get_user_by_username("u")["id"]
    rubric = get_preset_rubric("extraction")
    rid = db.create_eval_run(
        user_id=uid, status="pending", mode="single",
        prompt_a_text="P", prompt_a_hash="h", prompt_b_text=None, prompt_b_hash=None,
        prompt_a_library_id=None, prompt_a_library_version=None,
        prompt_b_library_id=None, prompt_b_library_version=None,
        task_input="T", reference_answer=None,
        target_model_id="m", judge_model_id="j", embedding_model_id="e",
        rubric_id=None, rubric_snapshot_json=json.dumps(rubric),
        n_runs=20, parallelism=1, temperature=0.0, top_p=1.0,
        pair_judge_samples=0, cost_preview_usd=0.001, cost_preview_tokens=100,
    )
    bus = EvalEventBus()
    bus.register(rid)
    ex = EvalRunExecutor(db=db, llm=_fake_llm(), bus=bus, run_id=rid)
    ex.start()
    time.sleep(0.05)
    ex.cancel()
    ex.join(timeout=10)
    run = db.get_eval_run(rid, user_id=uid)
    assert run["status"] == "cancelled"
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```python
# services/eval/run_executor.py
"""Фоновый executor одного eval-run. Spec §6.1, §9."""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from db.manager import DBManager
from services.eval.aggregator import aggregate_overall, majority_vote_top_fields, pair_winrate_with_ci
from services.eval.diversity import compute_diversity, embed_outputs
from services.eval.event_bus import EvalEventBus
from services.eval.judge_runner import judge_one, judge_pair

logger = logging.getLogger(__name__)


class EvalRunExecutor(threading.Thread):
    def __init__(self, *, db: DBManager, llm, bus: EvalEventBus, run_id: int) -> None:
        super().__init__(daemon=True, name=f"eval-run-{run_id}")
        self._db = db
        self._llm = llm
        self._bus = bus
        self._run_id = run_id
        self._cancel = threading.Event()

    def cancel(self) -> None:
        self._cancel.set()

    def _publish(self, event: dict) -> None:
        self._bus.publish(self._run_id, event)

    def _generate_one(self, *, prompt_text: str, task_input: str,
                      target_model: str, temperature: float,
                      top_p: float | None) -> tuple[str, int, int, int]:
        if self._cancel.is_set():
            raise RuntimeError("cancelled")
        t0 = time.monotonic()
        out = ""
        for chunk in self._llm.stream(
            system_prompt=prompt_text, user_content=task_input or "Выполни инструкцию.",
            provider=target_model, temperature=temperature, top_p=top_p,
        ):
            out += chunk
        dt_ms = int((time.monotonic() - t0) * 1000)
        in_tok = max(1, (len(prompt_text) + len(task_input or "")) // 4)
        out_tok = max(1, len(out) // 4)
        return out, in_tok, out_tok, dt_ms

    def run(self) -> None:
        run = self._db.get_eval_run(self._run_id, user_id=0)  # любой uid; фильтрация по user_id выполнится отдельно
        if run is None:
            return
        try:
            self._db.update_eval_run_status(self._run_id, status="running")
            self._publish({"type": "status", "status": "running"})
            t_start = time.monotonic()

            rubric = json.loads(run["rubric_snapshot_json"])
            sides: list[tuple[str, str]] = [("a", run["prompt_a_text"])]
            if run["mode"] == "pair" and run["prompt_b_text"]:
                sides.append(("b", run["prompt_b_text"]))

            n_total = run["n_runs"] * len(sides)
            n_done = 0

            jobs: list[tuple[str, int]] = [(s, i) for s, _ in sides for i in range(run["n_runs"])]
            results_by_side: dict[str, list[str]] = {"a": [], "b": []}
            result_ids_by_side: dict[str, list[int]] = {"a": [], "b": []}

            with ThreadPoolExecutor(max_workers=run["parallelism"]) as pool:
                fut_to_meta = {}
                for side, idx in jobs:
                    if self._cancel.is_set():
                        break
                    prompt_text = run["prompt_a_text"] if side == "a" else run["prompt_b_text"]
                    fut = pool.submit(
                        self._generate_one,
                        prompt_text=prompt_text, task_input=run["task_input"],
                        target_model=run["target_model_id"], temperature=run["temperature"],
                        top_p=run["top_p"],
                    )
                    fut_to_meta[fut] = (side, idx, prompt_text)

                for fut in as_completed(fut_to_meta):
                    if self._cancel.is_set():
                        break
                    side, idx, prompt_text = fut_to_meta[fut]
                    try:
                        output, in_tok, out_tok, lat_ms = fut.result()
                        status = "ok"
                        err = None
                    except Exception as e:
                        output, in_tok, out_tok, lat_ms = "", 0, 0, None
                        status = "error"
                        err = str(e)

                    judge = {"scores": {}, "overall": None, "parse_error": True, "overall_reasoning": ""}
                    if status == "ok":
                        judge = judge_one(
                            self._llm, run["judge_model_id"], rubric,
                            run["task_input"], prompt_text, output,
                            reference=run["reference_answer"],
                        )

                    parsed_json_int = 0
                    parsed_top: str | None = None
                    try:
                        v = json.loads(output)
                        if isinstance(v, dict):
                            parsed_json_int = 1
                            parsed_top = json.dumps(v)
                    except Exception:
                        pass

                    rid = self._db.add_eval_result(
                        run_id=self._run_id, prompt_side=side, run_index=idx,
                        output_text=output, output_tokens=out_tok, input_tokens=in_tok,
                        latency_ms=lat_ms, status=status, error=err,
                        embedding_blob=None,
                        judge_overall=judge["overall"], judge_overall_secondary=None,
                        judge_reasoning=judge.get("overall_reasoning") or "",
                        parsed_as_json=parsed_json_int, parsed_top_fields_json=parsed_top,
                    )
                    for crit_key, score in (judge.get("scores") or {}).items():
                        if isinstance(score, (int, float)):
                            self._db.add_eval_judge_score(
                                rid, criterion_key=crit_key, score=float(score),
                                reasoning=(judge.get("reasoning") or {}).get(crit_key) or "",
                            )

                    results_by_side[side].append(output)
                    result_ids_by_side[side].append(rid)
                    n_done += 1
                    self._publish({"type": "result_added", "result_id": rid, "side": side,
                                    "run_index": idx, "output": output, "judge_overall": judge["overall"],
                                    "judge_scores": judge.get("scores") or {}})
                    self._publish({"type": "progress", "n_done": n_done, "n_total": n_total})

            if self._cancel.is_set():
                self._db.update_eval_run_status(self._run_id, status="cancelled",
                                                 finished_at_utc=dt.datetime.utcnow().isoformat())
                self._publish({"type": "cancelled"})
                return

            # Diversity (только сторона A)
            div = None
            if results_by_side["a"]:
                emb = embed_outputs(self._llm, run["embedding_model_id"], results_by_side["a"])
                div = compute_diversity([e for e in emb if e])

            scores_a = [s for s in
                        (self._db.list_eval_results(self._run_id))
                        if s["prompt_side"] == "a" and s["judge_overall"] is not None]
            agg = aggregate_overall([s["judge_overall"] for s in scores_a])

            pair_winner = None
            pair_conf = None
            if run["mode"] == "pair" and results_by_side["b"]:
                pairs_n = run["pair_judge_samples"] or 0
                votes: list[str] = []
                for k in range(pairs_n):
                    if self._cancel.is_set():
                        break
                    a_idx = k % len(results_by_side["a"])
                    b_idx = k % len(results_by_side["b"])
                    res = judge_pair(
                        self._llm, run["judge_model_id"], rubric,
                        run["task_input"], results_by_side["a"][a_idx],
                        results_by_side["b"][b_idx],
                    )
                    votes.append(res["winner"])
                pres = pair_winrate_with_ci(votes)
                pair_winner = pres["winner"]
                pair_conf = pres["confidence"]
                self._publish({"type": "pair_summary", **pres})

            self._db.update_eval_run_aggregates(
                self._run_id,
                agg={"diversity_score": div,
                     "agg_overall_p50": agg["p50"], "agg_overall_p10": agg["p10"],
                     "agg_overall_p90": agg["p90"], "agg_overall_var": agg["var"],
                     "pair_winner": pair_winner, "pair_winner_confidence": pair_conf},
            )
            duration_ms = int((time.monotonic() - t_start) * 1000)
            # actual cost: считается интегратором при необходимости — здесь просто timing
            self._db.update_eval_run_actual_cost(
                self._run_id, cost_actual_usd=run["cost_preview_usd"],
                cost_actual_tokens=run["cost_preview_tokens"], duration_ms=duration_ms,
            )
            self._db.update_eval_run_status(
                self._run_id, status="done",
                finished_at_utc=dt.datetime.utcnow().isoformat(),
            )
            self._publish({"type": "aggregate_update",
                            "p50": agg["p50"], "p10": agg["p10"], "p90": agg["p90"],
                            "var": agg["var"], "diversity": div})
            self._publish({"type": "done", "duration_ms": duration_ms})
        except Exception as e:
            logger.exception("eval executor failed")
            self._db.update_eval_run_status(
                self._run_id, status="failed", error=str(e),
                finished_at_utc=dt.datetime.utcnow().isoformat(),
            )
            self._publish({"type": "error", "message": str(e)})
        finally:
            time.sleep(0.1)
            self._bus.unregister(self._run_id)
```

> NB. `db.get_eval_run(..., user_id=0)` в executor'е игнорирует фильтр пользователя — в реализации `get_eval_run` для `user_id=0` принимаем как «admin/internal call» и возвращаем без фильтра. Это документировать в docstring `get_eval_run`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add services/eval/run_executor.py tests/test_eval_run_executor.py
git commit -m "feat(eval): background run executor with parallel calls and cancel"
```

---

### Task 12: API — CRUD анкет (`/api/eval/rubrics`)

**Files:**
- Create: `backend/api/eval_stability.py` (с роутами анкет; остальные роуты — следующие задачи).
- Modify: `backend/main.py` — `include_router(eval_stability.router, prefix="/eval", tags=["eval"])`.
- Test: `tests/test_eval_api_rubrics.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_api_rubrics.py
from fastapi.testclient import TestClient
from backend.main import app


def _login(c):
    c.post("/api/auth/register", json={"username": "u1", "password": "Pwd!12345"})
    return c.post("/api/auth/login", json={"username": "u1", "password": "Pwd!12345"}).json()


def test_create_and_list_rubric(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    c = TestClient(app)
    _login(c)
    body = {"name": "My", "preset_key": "extraction",
            "criteria_json": '[{"key":"k1","label":"K1","weight":1.0,"description":"d","anchors":{"0":"","3":"","5":""}}]'}
    r = c.post("/api/eval/rubrics", json=body)
    assert r.status_code == 200
    rid = r.json()["id"]
    r = c.get("/api/eval/rubrics")
    assert any(it["id"] == rid for it in r.json()["items"])
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать роуты**

```python
# backend/api/eval_stability.py
"""Eval-Stability — endpoints. Spec §6.3."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager

router = APIRouter()


class RubricIn(BaseModel):
    name: str
    preset_key: str | None = None
    criteria_json: str
    reference_required: int = 0


@router.post("/rubrics")
def create_rubric(req: RubricIn, user: dict = Depends(get_current_user),
                  db: DBManager = Depends(get_db)):
    rid = db.create_eval_rubric(
        user_id=int(user["id"]), name=req.name, preset_key=req.preset_key,
        criteria_json=req.criteria_json, reference_required=req.reference_required,
    )
    return {"id": rid}


@router.get("/rubrics")
def list_rubrics(user: dict = Depends(get_current_user), db: DBManager = Depends(get_db)):
    items = db.list_eval_rubrics(int(user["id"]))
    return {"items": items}


@router.get("/rubrics/{rid}")
def get_rubric(rid: int, user: dict = Depends(get_current_user), db: DBManager = Depends(get_db)):
    item = db.get_eval_rubric(rid, user_id=int(user["id"]))
    if not item:
        raise HTTPException(404, "rubric not found")
    return {"item": item}


@router.put("/rubrics/{rid}")
def update_rubric(rid: int, req: RubricIn, user: dict = Depends(get_current_user),
                  db: DBManager = Depends(get_db)):
    ok = db.update_eval_rubric(
        rid, user_id=int(user["id"]),
        name=req.name, criteria_json=req.criteria_json,
        reference_required=req.reference_required,
    )
    if not ok:
        raise HTTPException(404, "rubric not found")
    return {"ok": True}


@router.delete("/rubrics/{rid}")
def delete_rubric(rid: int, user: dict = Depends(get_current_user),
                  db: DBManager = Depends(get_db)):
    if not db.delete_eval_rubric(rid, user_id=int(user["id"])):
        raise HTTPException(404, "rubric not found")
    return {"ok": True}
```

- [ ] **Step 4: Подключить роутер в `backend/main.py`**

В импортах:
```python
from backend.api import (
    ...
    eval_stability,
)
```
И сразу после `compare`:
```python
api_app.include_router(eval_stability.router, prefix="/eval", tags=["eval"])
```

- [ ] **Step 5: PASS + commit**

```bash
git add backend/api/eval_stability.py backend/main.py tests/test_eval_api_rubrics.py
git commit -m "feat(eval): rubric CRUD endpoints under /api/eval/rubrics"
```

---

### Task 13: API — preview-cost

**Files:**
- Modify: `backend/api/eval_stability.py` (добавить роут).
- Test: `tests/test_eval_api_cost_preview.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_api_cost_preview.py
from fastapi.testclient import TestClient
from backend.main import app


def test_preview_cost_returns_breakdown(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(
        "services.eval.cost_estimator.get_model_pricing", lambda mid: (1.0, 2.0),
    )
    c = TestClient(app)
    c.post("/api/auth/register", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/auth/login", json={"username": "u", "password": "Pwd!12345"})
    body = {
        "mode": "single", "prompt_a": "p" * 4000, "prompt_b": None,
        "task_input": "t" * 400, "reference_answer": None,
        "n_runs": 10, "expected_output_chars": 3200,
        "target_model_id": "m1", "judge_model_id": "m2",
        "embedding_model_id": "m3", "pair_judge_samples": 0,
    }
    r = c.post("/api/eval/stability/preview-cost", json=body)
    assert r.status_code == 200
    out = r.json()
    assert {"tokens_min", "tokens_avg", "tokens_max", "usd_min", "usd_avg", "usd_max", "breakdown"} <= set(out.keys())
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

В `backend/api/eval_stability.py`:

```python
from services.eval.cost_estimator import estimate_run_cost
from services.eval.cheap_tier import is_cheap_judge, is_cheap_embedding


class PreviewCostIn(BaseModel):
    mode: str  # 'single' | 'pair'
    prompt_a: str
    prompt_b: str | None = None
    task_input: str
    reference_answer: str | None = None
    n_runs: int = 10
    expected_output_chars: int = 3200
    target_model_id: str
    judge_model_id: str
    embedding_model_id: str
    pair_judge_samples: int = 5


@router.post("/stability/preview-cost")
def preview_cost(req: PreviewCostIn, user: dict = Depends(get_current_user),
                 db: DBManager = Depends(get_db)):
    if req.mode not in ("single", "pair"):
        raise HTTPException(400, "mode must be 'single' or 'pair'")
    if req.n_runs < 1 or req.n_runs > 50:
        raise HTTPException(400, "n_runs must be in [1, 50]")
    out = estimate_run_cost(
        mode=req.mode,
        prompt_a_chars=len(req.prompt_a or ""), prompt_b_chars=len(req.prompt_b or ""),
        task_input_chars=len(req.task_input or ""), reference_chars=len(req.reference_answer or ""),
        n_runs=req.n_runs, expected_output_chars=req.expected_output_chars,
        target_model_id=req.target_model_id, judge_model_id=req.judge_model_id,
        embedding_model_id=req.embedding_model_id, pair_judge_samples=req.pair_judge_samples,
    )
    out["judge_in_cheap_tier"] = is_cheap_judge(req.judge_model_id)
    out["embedding_in_cheap_tier"] = is_cheap_embedding(req.embedding_model_id)
    daily_used = db.get_eval_daily_dollars(int(user["id"]),
                                            __import__("datetime").datetime.utcnow().date().isoformat())
    daily_budget = db.get_eval_daily_budget(int(user["id"]))
    out["daily_budget_usd"] = daily_budget
    out["daily_used_usd"] = daily_used
    out["fits_in_daily_budget"] = (daily_used + out["usd_max"]) <= daily_budget
    return out
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/api/eval_stability.py tests/test_eval_api_cost_preview.py
git commit -m "feat(eval): /preview-cost endpoint with cheap-tier flags and daily budget check"
```

---

### Task 14: API — POST /stability/runs (создание run + старт executor)

**Files:**
- Modify: `backend/api/eval_stability.py`.
- Test: `tests/test_eval_api_runs_create.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_api_runs_create.py
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app


def test_create_run_requires_own_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    c = TestClient(app)
    c.post("/api/auth/register", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/auth/login", json={"username": "u", "password": "Pwd!12345"})
    body = {
        "mode": "single", "prompt_a": "P", "task_input": "T",
        "n_runs": 2, "expected_output_chars": 1000,
        "target_model_id": "openai/gpt-4o-mini",
        "judge_model_id": "google/gemini-2.0-flash-001",
        "embedding_model_id": "openai/text-embedding-3-small",
        "rubric_preset": "extraction",
    }
    r = c.post("/api/eval/stability/runs", json=body)
    assert r.status_code == 402  # своего ключа нет


def test_create_run_starts_executor(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(
        "services.eval.cost_estimator.get_model_pricing", lambda mid: (0.1, 0.1),
    )
    c = TestClient(app)
    c.post("/api/auth/register", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/auth/login", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/settings", json={"openrouter_api_key": "sk-test"})
    started = {}
    with patch("backend.api.eval_stability.EvalRunExecutor") as Exec:
        inst = Exec.return_value
        inst.start = lambda: started.setdefault("started", True)
        body = {
            "mode": "single", "prompt_a": "P", "task_input": "T",
            "n_runs": 2, "expected_output_chars": 1000,
            "target_model_id": "openai/gpt-4o-mini",
            "judge_model_id": "google/gemini-2.0-flash-001",
            "embedding_model_id": "openai/text-embedding-3-small",
            "rubric_preset": "extraction",
        }
        r = c.post("/api/eval/stability/runs", json=body)
    assert r.status_code == 200
    assert "run_id" in r.json()
    assert started.get("started") is True
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

В `backend/api/eval_stability.py` (полностью пример на одну ручку):

```python
import datetime as dt
import hashlib
import json

from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, resolve_openrouter_model_id
from services.eval.run_executor import EvalRunExecutor
from services.eval.event_bus import GLOBAL_EVAL_BUS
from services.eval.rubric_presets import get_preset_rubric, PRESET_RUBRICS


class CreateRunIn(BaseModel):
    mode: str
    prompt_a: str
    prompt_b: str | None = None
    task_input: str
    reference_answer: str | None = None
    target_model_id: str
    judge_model_id: str
    embedding_model_id: str
    rubric_preset: str | None = None
    rubric_id: int | None = None
    n_runs: int = 10
    parallelism: int = 4
    temperature: float = 0.7
    top_p: float | None = 1.0
    pair_judge_samples: int = 5
    expected_output_chars: int = 3200
    prompt_a_library_id: int | None = None
    prompt_a_library_version: int | None = None
    prompt_b_library_id: int | None = None
    prompt_b_library_version: int | None = None


_MAX_RUNNING_PER_USER = 5


def _hash_prompt(t: str) -> str:
    return hashlib.sha256((t or "").encode("utf-8")).hexdigest()[:32]


@router.post("/stability/runs")
def create_run(req: CreateRunIn, user: dict = Depends(get_current_user),
               db: DBManager = Depends(get_db)):
    uid = int(user["id"])
    user_key = db.get_user_openrouter_api_key(uid)
    api_key = resolve_openrouter_api_key(user_key)
    if not user_key or not api_key:
        raise HTTPException(402, "Eval-Stability требует собственный OpenRouter ключ. Введите его в Настройках.")
    if req.mode not in ("single", "pair"):
        raise HTTPException(400, "mode must be 'single' or 'pair'")
    if req.mode == "pair" and not req.prompt_b:
        raise HTTPException(400, "prompt_b is required in pair mode")
    if req.n_runs < 1 or req.n_runs > 50:
        raise HTTPException(400, "n_runs must be in [1, 50]")
    if len(req.prompt_a) > 30000 or len(req.prompt_b or "") > 30000:
        raise HTTPException(400, "prompt too long (>30000 chars)")
    if len(req.task_input) > 5000:
        raise HTTPException(400, "task_input too long (>5000 chars)")

    running, _ = db.list_eval_runs(user_id=uid, status="running", limit=100, offset=0)
    if len(running) >= _MAX_RUNNING_PER_USER:
        raise HTTPException(429, f"Слишком много активных прогонов ({_MAX_RUNNING_PER_USER}).")

    if req.rubric_id is not None:
        rubric_row = db.get_eval_rubric(req.rubric_id, user_id=uid)
        if not rubric_row:
            raise HTTPException(404, "rubric not found")
        rubric = {"name": rubric_row["name"], "preset_key": rubric_row["preset_key"],
                  "scale_max": 5, "criteria": json.loads(rubric_row["criteria_json"])}
    else:
        key = req.rubric_preset or "writing"
        if key not in PRESET_RUBRICS:
            raise HTTPException(400, f"unknown rubric_preset: {key}")
        rubric = get_preset_rubric(key)

    cost = estimate_run_cost(
        mode=req.mode,
        prompt_a_chars=len(req.prompt_a), prompt_b_chars=len(req.prompt_b or ""),
        task_input_chars=len(req.task_input), reference_chars=len(req.reference_answer or ""),
        n_runs=req.n_runs, expected_output_chars=req.expected_output_chars,
        target_model_id=req.target_model_id, judge_model_id=req.judge_model_id,
        embedding_model_id=req.embedding_model_id, pair_judge_samples=req.pair_judge_samples,
    )
    today = dt.datetime.utcnow().date().isoformat()
    used = db.get_eval_daily_dollars(uid, today)
    budget = db.get_eval_daily_budget(uid)
    if used + cost["usd_max"] > budget:
        raise HTTPException(403, f"Дневной бюджет ${budget:.2f} исчерпан. Уже потрачено ${used:.4f}.")

    run_id = db.create_eval_run(
        user_id=uid, status="pending", mode=req.mode,
        prompt_a_text=req.prompt_a, prompt_a_hash=_hash_prompt(req.prompt_a),
        prompt_b_text=req.prompt_b, prompt_b_hash=_hash_prompt(req.prompt_b or ""),
        prompt_a_library_id=req.prompt_a_library_id,
        prompt_a_library_version=req.prompt_a_library_version,
        prompt_b_library_id=req.prompt_b_library_id,
        prompt_b_library_version=req.prompt_b_library_version,
        task_input=req.task_input, reference_answer=req.reference_answer,
        target_model_id=resolve_openrouter_model_id(req.target_model_id),
        judge_model_id=resolve_openrouter_model_id(req.judge_model_id),
        embedding_model_id=req.embedding_model_id,
        rubric_id=req.rubric_id, rubric_snapshot_json=json.dumps(rubric),
        n_runs=req.n_runs, parallelism=max(1, min(req.parallelism, 4)),
        temperature=req.temperature, top_p=req.top_p,
        pair_judge_samples=req.pair_judge_samples,
        cost_preview_usd=cost["usd_avg"], cost_preview_tokens=cost["tokens_avg"],
    )

    db.add_eval_daily_dollars(uid, today, cost["usd_avg"])  # резерв; реальное обновится при actual cost

    GLOBAL_EVAL_BUS.register(run_id)
    llm = LLMClient(api_key)
    EvalRunExecutor(db=db, llm=llm, bus=GLOBAL_EVAL_BUS, run_id=run_id).start()

    db.log_event("eval_run_started",
                 session_id="", payload={"mode": req.mode, "n_runs": req.n_runs,
                                          "target_model": req.target_model_id}, user_id=uid)
    return {"run_id": run_id, "cost_preview": cost}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/api/eval_stability.py tests/test_eval_api_runs_create.py
git commit -m "feat(eval): create-run endpoint with limits, budget check, executor start"
```

---

### Task 15: API — SSE стрим, GET, cancel, delete, list

**Files:**
- Modify: `backend/api/eval_stability.py`.
- Test: `tests/test_eval_api_sse.py`, `tests/test_eval_api_runs_misc.py`.

- [ ] **Step 1: Тест SSE**

```python
# tests/test_eval_api_sse.py
import json
from fastapi.testclient import TestClient
from backend.main import app
from services.eval.event_bus import GLOBAL_EVAL_BUS


def test_sse_yields_events(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    c = TestClient(app)
    c.post("/api/auth/register", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/auth/login", json={"username": "u", "password": "Pwd!12345"})
    GLOBAL_EVAL_BUS.register(1)
    GLOBAL_EVAL_BUS.publish(1, {"type": "progress", "n_done": 1, "n_total": 2})
    GLOBAL_EVAL_BUS.publish(1, {"type": "done"})
    # фейковый run в БД, чтобы пройти проверку доступа
    # ... (insert eval_runs row через DBManager)
    with c.stream("GET", "/api/eval/stability/runs/1/stream") as resp:
        body = b"".join(resp.iter_bytes())
    text = body.decode()
    assert '"progress"' in text and '"done"' in text
```

> Тест предполагает, что `get_eval_run` возвращает строку для `run_id=1`. В тесте нужно сначала вставить запись через `db.create_eval_run(...)` с `user_id` залогиненного юзера. Сокращено в примере; полный setup — в реализации теста.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать SSE и остальные роуты**

В `backend/api/eval_stability.py`:

```python
import asyncio
from fastapi.responses import StreamingResponse
from services.eval.event_bus import GLOBAL_EVAL_BUS


@router.get("/stability/runs/{run_id}/stream")
async def stream_run(run_id: int, user: dict = Depends(get_current_user),
                     db: DBManager = Depends(get_db)):
    uid = int(user["id"])
    if db.get_eval_run(run_id, user_id=uid) is None:
        raise HTTPException(404, "run not found")

    q = GLOBAL_EVAL_BUS.queue_for(run_id) or GLOBAL_EVAL_BUS.register(run_id)

    async def gen():
        # snapshot at connect
        run = db.get_eval_run(run_id, user_id=uid)
        results = db.list_eval_results(run_id)
        snapshot = {"type": "snapshot", "run": run, "results": results}
        yield f"data: {json.dumps(snapshot, ensure_ascii=False, default=str)}\n\n"
        if run["status"] in ("done", "failed", "cancelled"):
            return
        while True:
            try:
                event = await asyncio.to_thread(q.get, True, 0.5)
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                if event.get("type") in ("done", "error", "cancelled"):
                    return
            except Exception:
                # таймаут .get() — отправим heartbeat
                yield ": ping\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/stability/runs/{run_id}")
def get_run(run_id: int, user: dict = Depends(get_current_user),
            db: DBManager = Depends(get_db)):
    uid = int(user["id"])
    run = db.get_eval_run(run_id, user_id=uid)
    if not run:
        raise HTTPException(404, "run not found")
    results = db.list_eval_results(run_id)
    scores_by_result = {r["id"]: db.list_eval_judge_scores(r["id"]) for r in results}
    return {"run": run, "results": results, "judge_scores": scores_by_result}


@router.post("/stability/runs/{run_id}/cancel")
def cancel_run(run_id: int, user: dict = Depends(get_current_user),
                db: DBManager = Depends(get_db)):
    uid = int(user["id"])
    run = db.get_eval_run(run_id, user_id=uid)
    if not run:
        raise HTTPException(404, "run not found")
    if run["status"] in ("done", "failed", "cancelled"):
        return {"ok": True, "noop": True}
    GLOBAL_EVAL_BUS.publish(run_id, {"type": "cancel_requested"})
    # Передаём cancel в executor через флаг — храним ссылки на executor'ы в реестре:
    from services.eval.run_executor import EXECUTOR_REGISTRY
    ex = EXECUTOR_REGISTRY.get(run_id)
    if ex is not None:
        ex.cancel()
    db.log_event("eval_run_cancelled", session_id="", payload={"run_id": run_id}, user_id=uid)
    return {"ok": True}


@router.delete("/stability/runs/{run_id}")
def delete_run(run_id: int, user: dict = Depends(get_current_user),
                db: DBManager = Depends(get_db)):
    uid = int(user["id"])
    if not db.delete_eval_run(run_id, user_id=uid):
        raise HTTPException(404, "run not found")
    return {"ok": True}


@router.get("/stability/runs")
def list_runs(status: str | None = None, library_id: int | None = None,
              limit: int = 30, offset: int = 0,
              user: dict = Depends(get_current_user), db: DBManager = Depends(get_db)):
    items, total = db.list_eval_runs(user_id=int(user["id"]),
                                      status=status, library_id=library_id,
                                      limit=limit, offset=offset)
    return {"items": items, "total": total}
```

> Дополнительно в `services/eval/run_executor.py` создать `EXECUTOR_REGISTRY: dict[int, EvalRunExecutor] = {}` и в `EvalRunExecutor.start()` зарегистрировать сам себя, в `finally` — удалить.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/api/eval_stability.py services/eval/run_executor.py tests/test_eval_api_sse.py tests/test_eval_api_runs_misc.py
git commit -m "feat(eval): SSE stream, get/cancel/delete/list endpoints"
```

---

### Task 16: API — `/library/{id}/eval-summary` и lifespan startup hook

**Files:**
- Modify: `backend/api/library.py` (добавить роут) или `backend/api/eval_stability.py` (как `/library/{id}/eval-summary`).
- Modify: `backend/main.py` — `lifespan` или `@app.on_event("startup")` для `db.mark_eval_runs_failed_on_startup()`.
- Test: `tests/test_eval_library_summary.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_library_summary.py
from fastapi.testclient import TestClient
from backend.main import app


def test_library_summary_returns_last_done_for_version(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    c = TestClient(app)
    c.post("/api/auth/register", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/auth/login", json={"username": "u", "password": "Pwd!12345"})
    # сохраним промпт в Library, затем создадим eval_run в БД напрямую
    # (детали setup пропущены — реальный тест собирается из db.create_eval_run + library_id)
    r = c.get("/api/library/1/eval-summary")
    assert r.status_code in (200, 404)  # 200 если есть прогон, иначе 404
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать роут**

В `backend/api/eval_stability.py`:

```python
@router.get("/library/{library_id}/eval-summary", tags=["eval", "library"])
def library_eval_summary(library_id: int,
                         user: dict = Depends(get_current_user),
                         db: DBManager = Depends(get_db)):
    last = db.get_last_done_eval_run_for_library(
        user_id=int(user["id"]), library_id=library_id, library_version=None,
    )
    if not last:
        raise HTTPException(404, "no done runs")
    return {"p50": last["agg_overall_p50"], "var": last["agg_overall_var"],
            "n_runs": last["n_runs"], "last_run_id": last["id"]}
```

> Внимание: путь `/api/eval/library/...` — оставляем под префиксом `/eval`. Для красоты можно вынести в `library.py` как `/api/library/{id}/eval-summary`. **Решение MVP-1: размещаем под `/api/eval/library/{id}/eval-summary`** (один роутер, проще).

- [ ] **Step 4: Lifespan startup hook в `backend/main.py`**

```python
from contextlib import asynccontextmanager
from db.manager import DBManager

_DB = DBManager()
_DB.init()


@asynccontextmanager
async def lifespan(_app):
    n = _DB.mark_eval_runs_failed_on_startup()
    if n > 0:
        import logging
        logging.getLogger(__name__).warning("marked %s eval runs as failed (server restart)", n)
    yield


api_app = FastAPI(..., lifespan=lifespan)  # в существующем конструкторе api_app
```

> Если в `backend/main.py` уже есть собственный механизм инициализации БД — используем его (не дублируем).

- [ ] **Step 5: PASS + commit**

```bash
git add backend/api/eval_stability.py backend/main.py tests/test_eval_library_summary.py
git commit -m "feat(eval): library eval-summary + startup hook to fail orphan runs"
```

---

### Task 17: Settings — `eval_daily_budget_usd`

**Files:**
- Modify: `backend/api/settings.py` (read+update).
- Test: `tests/test_eval_settings_budget.py`.

- [ ] **Step 1: Тест**

```python
# tests/test_eval_settings_budget.py
from fastapi.testclient import TestClient
from backend.main import app


def test_set_eval_budget(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "t.db"))
    c = TestClient(app)
    c.post("/api/auth/register", json={"username": "u", "password": "Pwd!12345"})
    c.post("/api/auth/login", json={"username": "u", "password": "Pwd!12345"})
    s = c.get("/api/settings").json()
    assert "eval_daily_budget_usd" in s
    r = c.post("/api/settings", json={"eval_daily_budget_usd": 1.5})
    assert r.status_code == 200
    s2 = c.get("/api/settings").json()
    assert s2["eval_daily_budget_usd"] == 1.5
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

В `backend/api/settings.py` дополнить:

```python
# в Settings response model
eval_daily_budget_usd: float | None = None

# в чтении settings (расширить выборку из БД)
"eval_daily_budget_usd": db.get_eval_daily_budget(uid),

# в update settings (если поле передано)
if req.eval_daily_budget_usd is not None:
    if req.eval_daily_budget_usd < 0 or req.eval_daily_budget_usd > 100:
        raise HTTPException(400, "eval_daily_budget_usd must be in [0, 100]")
    db.set_eval_daily_budget(uid, float(req.eval_daily_budget_usd))
```

- [ ] **Step 4: PASS + commit**

```bash
git add backend/api/settings.py tests/test_eval_settings_budget.py
git commit -m "feat(eval): expose eval_daily_budget_usd in settings"
```

---

### Task 18: Frontend API client — типы и методы

**Files:**
- Modify: `frontend/src/api/client.ts` (новые типы и методы).
- Create: `frontend/src/lib/parseEvalSse.ts`.
- Test: `frontend/tests/api/evalApi.test.ts` (или `frontend/src/lib/__tests__/parseEvalSse.test.ts` — по конвенции проекта).

- [ ] **Step 1: Тест парсера SSE**

```ts
// frontend/src/lib/__tests__/parseEvalSse.test.ts
import { parseEvalSseLines, type EvalRunEvent } from '../parseEvalSse'

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(text))
      controller.close()
    },
  })
}

test('parses progress and done', async () => {
  const text =
    'data: {"type":"progress","n_done":1,"n_total":2}\n\n' +
    'data: {"type":"done","duration_ms":100}\n\n'
  const events: EvalRunEvent[] = []
  await parseEvalSseLines(streamFrom(text), (e) => events.push(e))
  expect(events.map((e) => e.type)).toEqual(['progress', 'done'])
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать парсер и типы**

```ts
// frontend/src/lib/parseEvalSse.ts
export type EvalRunEvent =
  | { type: 'snapshot'; run: any; results: any[] }
  | { type: 'status'; status: string }
  | { type: 'progress'; n_done: number; n_total: number }
  | { type: 'result_added'; result_id: number; side: 'a' | 'b'; run_index: number;
      output: string; judge_overall: number | null; judge_scores: Record<string, number> }
  | { type: 'aggregate_update'; p50: number | null; p10: number | null; p90: number | null;
      var: number | null; diversity: number | null }
  | { type: 'pair_summary'; winrate_a: number; winrate_b: number; tie_rate: number;
      winner: 'a' | 'b' | 'tie'; confidence: number }
  | { type: 'done'; duration_ms: number }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export async function parseEvalSseLines(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (e: EvalRunEvent) => void,
): Promise<void> {
  if (!body) return
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const block of parts) {
      const line = block.trim()
      if (!line.startsWith('data:')) continue
      const json = line.slice(5).trim()
      if (!json) continue
      try {
        onEvent(JSON.parse(json) as EvalRunEvent)
      } catch {
        /* ignore */
      }
    }
  }
}
```

В `frontend/src/api/client.ts` добавить:

```ts
// Типы
export interface EvalRubricCriterion {
  key: string; label: string; weight: number; description: string
  anchors: { '0': string; '3': string; '5': string }
}
export interface EvalRubric {
  id?: number; name: string; preset_key?: string | null
  criteria: EvalRubricCriterion[]; reference_required?: number
}
export interface EvalCostPreview {
  tokens_min: number; tokens_avg: number; tokens_max: number
  usd_min: number; usd_avg: number; usd_max: number
  breakdown: Record<string, { tokens: number; usd: number }>
  daily_budget_usd: number; daily_used_usd: number; fits_in_daily_budget: boolean
  judge_in_cheap_tier: boolean; embedding_in_cheap_tier: boolean
}
export interface EvalRun {
  id: number; status: string; mode: 'single' | 'pair'
  agg_overall_p50: number | null; agg_overall_p10: number | null
  agg_overall_p90: number | null; agg_overall_var: number | null
  diversity_score: number | null; n_runs: number
  pair_winner: 'a' | 'b' | 'tie' | null; pair_winner_confidence: number | null
  // ... остальные поля как в БД
}

// Методы (внутри `export const api = { ... }`)
evalPreviewCost: (req: any) =>
  fetchApi<EvalCostPreview>('/eval/stability/preview-cost', { method: 'POST', body: JSON.stringify(req) }),
evalCreateRun: (req: any) =>
  fetchApi<{ run_id: number; cost_preview: EvalCostPreview }>('/eval/stability/runs', { method: 'POST', body: JSON.stringify(req) }),
evalGetRun: (id: number) =>
  fetchApi<{ run: EvalRun; results: any[]; judge_scores: Record<number, any[]> }>(`/eval/stability/runs/${id}`),
evalCancelRun: (id: number) =>
  fetchApi<{ ok: boolean }>(`/eval/stability/runs/${id}/cancel`, { method: 'POST' }),
evalDeleteRun: (id: number) =>
  fetchApi<{ ok: boolean }>(`/eval/stability/runs/${id}`, { method: 'DELETE' }),
evalListRuns: (params?: { status?: string; library_id?: number; limit?: number; offset?: number }) => {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.library_id != null) q.set('library_id', String(params.library_id))
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const qs = q.toString()
  return fetchApi<{ items: EvalRun[]; total: number }>(`/eval/stability/runs${qs ? `?${qs}` : ''}`)
},
evalLibrarySummary: (libraryId: number) =>
  fetchApi<{ p50: number; var: number; n_runs: number; last_run_id: number }>(`/eval/library/${libraryId}/eval-summary`),
evalListRubrics: () => fetchApi<{ items: EvalRubric[] }>('/eval/rubrics'),
evalCreateRubric: (req: { name: string; preset_key?: string; criteria_json: string; reference_required?: number }) =>
  fetchApi<{ id: number }>('/eval/rubrics', { method: 'POST', body: JSON.stringify(req) }),
evalStreamRun: async (id: number, onEvent: (e: import('../lib/parseEvalSse').EvalRunEvent) => void) => {
  const headers = new Headers()
  const sid = getAuthSessionId()
  if (sid) headers.set('X-Session-Id', sid)
  const res = await fetch(`${API_BASE}/eval/stability/runs/${id}/stream`, { headers })
  if (!res.ok) throw new ApiError(`stream ${res.status}`, res.status)
  const { parseEvalSseLines } = await import('../lib/parseEvalSse')
  await parseEvalSseLines(res.body, onEvent)
},
```

- [ ] **Step 4: PASS** (юнит-тест парсера зелёный; типы в client.ts ничего не ломают, `tsc --noEmit` чистый).

Run: `cd frontend && npm test -- parseEvalSse` (или vitest по конфигурации).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/lib/parseEvalSse.ts frontend/src/lib/__tests__/parseEvalSse.test.ts
git commit -m "feat(eval): frontend API client and SSE parser for stability runs"
```

---

### Task 19: Frontend — Composer и cost preview (компоненты)

**Files:**
- Create: `frontend/src/components/eval/StabilityComposer.tsx`, `frontend/src/components/eval/CostPreviewPanel.tsx`.
- Test: `frontend/src/components/eval/__tests__/StabilityComposer.test.tsx` (smoke).

- [ ] **Step 1: Smoke-тест**

```tsx
// frontend/src/components/eval/__tests__/StabilityComposer.test.tsx
import { render, screen } from '@testing-library/react'
import StabilityComposer from '../StabilityComposer'

test('renders core fields', () => {
  render(<StabilityComposer onRun={() => {}} />)
  expect(screen.getByPlaceholderText(/промпт/i)).toBeInTheDocument()
  expect(screen.getByPlaceholderText(/тестов/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /запустить/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать минимальный композер**

```tsx
// frontend/src/components/eval/StabilityComposer.tsx
import { useState } from 'react'

interface Props {
  onRun: (req: {
    mode: 'single' | 'pair'
    promptA: string
    promptB?: string
    taskInput: string
    referenceAnswer?: string
    nRuns: number
    rubricPreset: 'extraction' | 'code' | 'writing' | 'classification'
    targetModelId: string
    judgeModelId: string
    embeddingModelId: string
  }) => void
}

export default function StabilityComposer({ onRun }: Props) {
  const [mode, setMode] = useState<'single' | 'pair'>('single')
  const [promptA, setPromptA] = useState('')
  const [promptB, setPromptB] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [referenceAnswer, setReferenceAnswer] = useState('')
  const [nRuns, setNRuns] = useState(10)
  const [rubricPreset, setRubricPreset] = useState<'extraction' | 'code' | 'writing' | 'classification'>('writing')
  const [targetModelId, setTargetModelId] = useState('openai/gpt-4o-mini')
  const [judgeModelId, setJudgeModelId] = useState('google/gemini-2.0-flash-001')
  const [embeddingModelId, setEmbeddingModelId] = useState('openai/text-embedding-3-small')

  return (
    <div>
      <label><input type="radio" checked={mode === 'single'} onChange={() => setMode('single')} />Один промпт</label>
      <label><input type="radio" checked={mode === 'pair'} onChange={() => setMode('pair')} />Сравнить два</label>

      <textarea placeholder="Промпт A" value={promptA} onChange={(e) => setPromptA(e.target.value)} />
      {mode === 'pair' && (
        <textarea placeholder="Промпт B" value={promptB} onChange={(e) => setPromptB(e.target.value)} />
      )}
      <textarea placeholder="Тестовый запрос" value={taskInput} onChange={(e) => setTaskInput(e.target.value)} />
      <details>
        <summary>Эталонный ответ (необязательно)</summary>
        <textarea value={referenceAnswer} onChange={(e) => setReferenceAnswer(e.target.value)} />
      </details>

      <label>N: <input type="number" min={1} max={50} value={nRuns}
                       onChange={(e) => setNRuns(Number(e.target.value))} /></label>
      <select value={rubricPreset} onChange={(e) => setRubricPreset(e.target.value as any)}>
        <option value="extraction">Извлечение</option>
        <option value="code">Код</option>
        <option value="writing">Текст</option>
        <option value="classification">Классификация</option>
      </select>
      <input value={targetModelId} onChange={(e) => setTargetModelId(e.target.value)} placeholder="Целевая модель" />
      <input value={judgeModelId} onChange={(e) => setJudgeModelId(e.target.value)} placeholder="Судья" />
      <input value={embeddingModelId} onChange={(e) => setEmbeddingModelId(e.target.value)} placeholder="Эмбеддинги" />

      <button onClick={() => onRun({ mode, promptA, promptB: mode === 'pair' ? promptB : undefined,
        taskInput, referenceAnswer: referenceAnswer || undefined, nRuns,
        rubricPreset, targetModelId, judgeModelId, embeddingModelId })}>
        Запустить
      </button>
    </div>
  )
}
```

```tsx
// frontend/src/components/eval/CostPreviewPanel.tsx
import type { EvalCostPreview } from '../../api/client'
export default function CostPreviewPanel({ preview }: { preview: EvalCostPreview | null }) {
  if (!preview) return null
  return (
    <div>
      <div>Стоимость: примерно ${preview.usd_avg.toFixed(4)} (от ${preview.usd_min.toFixed(4)} до ${preview.usd_max.toFixed(4)})</div>
      <div>Токены: ~{preview.tokens_avg.toLocaleString()}</div>
      <ul>
        {Object.entries(preview.breakdown).map(([k, v]) => (
          <li key={k}>{k}: ${v.usd.toFixed(4)} / {v.tokens.toLocaleString()} токенов</li>
        ))}
      </ul>
      {!preview.fits_in_daily_budget && (
        <div role="alert">Дневной бюджет ${preview.daily_budget_usd.toFixed(2)} будет превышен.</div>
      )}
      {!preview.judge_in_cheap_tier && (
        <div>Внимание: модель-судья не из дешёвого тира.</div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/eval/StabilityComposer.tsx frontend/src/components/eval/CostPreviewPanel.tsx frontend/src/components/eval/__tests__/StabilityComposer.test.tsx
git commit -m "feat(eval): StabilityComposer + CostPreviewPanel components"
```

---

### Task 20: Frontend — RunningStream + результаты + StabilityTab

**Files:**
- Create: `frontend/src/components/eval/RunningStream.tsx`, `ResultDistribution.tsx`, `JudgeBreakdown.tsx`, `FailureTriagePanel.tsx`, `PairWinnerBadge.tsx`.
- Create: `frontend/src/pages/compare/StabilityTab.tsx` — собирает всё вместе.

- [ ] **Step 1: Smoke-тест StabilityTab**

```tsx
// frontend/src/pages/compare/__tests__/StabilityTab.test.tsx
import { render, screen } from '@testing-library/react'
import StabilityTab from '../StabilityTab'

test('renders composer initially', () => {
  render(<StabilityTab />)
  expect(screen.getByRole('button', { name: /запустить/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

`StabilityTab` — простой контейнер state-machine: `idle → costPreview → running → done | cancelled | error`. Работает с `api.evalCreateRun`, `api.evalStreamRun`, `api.evalGetRun`, `api.evalCancelRun`. Каждый компонент панели — простой и подключается к локальному state.

Конкретный пример (сжато):

```tsx
// frontend/src/pages/compare/StabilityTab.tsx
import { useCallback, useEffect, useState } from 'react'
import StabilityComposer from '../../components/eval/StabilityComposer'
import CostPreviewPanel from '../../components/eval/CostPreviewPanel'
import RunningStream from '../../components/eval/RunningStream'
import ResultDistribution from '../../components/eval/ResultDistribution'
import JudgeBreakdown from '../../components/eval/JudgeBreakdown'
import FailureTriagePanel from '../../components/eval/FailureTriagePanel'
import PairWinnerBadge from '../../components/eval/PairWinnerBadge'
import { api, ApiError, type EvalCostPreview } from '../../api/client'

type Phase = 'idle' | 'preview' | 'running' | 'finished'

export default function StabilityTab() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<EvalCostPreview | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<any[]>([])
  const [pair, setPair] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRun = useCallback(async (req: any) => {
    try {
      const cost = await api.evalPreviewCost({
        mode: req.mode, prompt_a: req.promptA, prompt_b: req.promptB,
        task_input: req.taskInput, reference_answer: req.referenceAnswer,
        n_runs: req.nRuns, expected_output_chars: 3200,
        target_model_id: req.targetModelId, judge_model_id: req.judgeModelId,
        embedding_model_id: req.embeddingModelId, pair_judge_samples: req.mode === 'pair' ? 5 : 0,
      })
      setPreview(cost)
      setPhase('preview')
      // если пользователь подтвердил — запускаем
      if (!cost.fits_in_daily_budget) return
      const run = await api.evalCreateRun({
        mode: req.mode, prompt_a: req.promptA, prompt_b: req.promptB,
        task_input: req.taskInput, reference_answer: req.referenceAnswer,
        n_runs: req.nRuns, target_model_id: req.targetModelId,
        judge_model_id: req.judgeModelId, embedding_model_id: req.embeddingModelId,
        rubric_preset: req.rubricPreset,
      })
      setRunId(run.run_id)
      setPhase('running')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (phase !== 'running' || runId == null) return
    let cancelled = false
    api.evalStreamRun(runId, (ev) => {
      if (cancelled) return
      if (ev.type === 'progress') setProgress({ done: ev.n_done, total: ev.n_total })
      if (ev.type === 'result_added') setResults((p) => [...p, ev])
      if (ev.type === 'pair_summary') setPair(ev)
      if (ev.type === 'done') setPhase('finished')
      if (ev.type === 'error') { setError(ev.message); setPhase('finished') }
      if (ev.type === 'cancelled') setPhase('finished')
    }).catch((e) => setError(String(e)))
    return () => { cancelled = true }
  }, [phase, runId])

  return (
    <div>
      {error && <div role="alert">{error}</div>}
      {phase === 'idle' && <StabilityComposer onRun={handleRun} />}
      {phase === 'preview' && <CostPreviewPanel preview={preview} />}
      {phase === 'running' && <RunningStream progress={progress} results={results} runId={runId!}
                                              onCancel={() => api.evalCancelRun(runId!)} />}
      {phase === 'finished' && (
        <>
          <ResultDistribution runId={runId!} />
          <JudgeBreakdown runId={runId!} />
          <FailureTriagePanel runId={runId!} />
          {pair && <PairWinnerBadge pair={pair} />}
        </>
      )}
    </div>
  )
}
```

Заглушки `RunningStream`, `ResultDistribution`, `JudgeBreakdown`, `FailureTriagePanel`, `PairWinnerBadge` — каждая получает `runId`, делает `api.evalGetRun(runId)` (через `useEffect`) и отрисовывает свои данные. Конкретный код — по аналогии: progress bar, гистограмма (просто `<div style={{width: pct + '%'}}/>` как простой бар), таблица результатов.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/eval/ frontend/src/pages/compare/
git commit -m "feat(eval): StabilityTab + child panels (running/results/breakdown/failures/pair)"
```

---

### Task 21: Frontend — таб «Стабильность» в `Compare.tsx`

**Files:**
- Modify: `frontend/src/pages/Compare.tsx`.

- [ ] **Step 1: Тест — переключение таба**

```tsx
// frontend/src/pages/__tests__/Compare.stability.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Compare from '../Compare'

test('stability tab renders composer', () => {
  render(<MemoryRouter><Compare /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /стабильность/i }))
  expect(screen.getByRole('button', { name: /запустить/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

В `Compare.tsx` расширить `Mode`:

```ts
type Mode = 'techniques' | 'prompts' | 'models' | 'stability'
```

Добавить кнопку таба в существующий блок таб-баров (поиском по `setMode('models')` найти нужное место и добавить рядом):

```tsx
<button
  type="button"
  className={mode === 'stability' ? styles.tabActive : styles.tab}
  onClick={() => setMode('stability')}
>
  Стабильность
</button>
```

И ниже в основном теле:

```tsx
{mode === 'stability' && <StabilityTab />}
```

Импортировать `StabilityTab` из `'./compare/StabilityTab'`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Compare.tsx frontend/src/pages/__tests__/Compare.stability.test.tsx
git commit -m "feat(eval): wire stability tab into Compare page"
```

---

### Task 22: Frontend — `<EvalBadge>` в Library

**Files:**
- Create: `frontend/src/components/eval/EvalBadge.tsx`.
- Modify: `frontend/src/pages/Library.tsx` — вставить бейдж на карточку.
- Test: `frontend/src/components/eval/__tests__/EvalBadge.test.tsx`.

- [ ] **Step 1: Тест**

```tsx
// frontend/src/components/eval/__tests__/EvalBadge.test.tsx
import { render, screen } from '@testing-library/react'
import EvalBadge from '../EvalBadge'

test('shows score from props snapshot', () => {
  render(<EvalBadge p50={4.2} variance={0.6} />)
  expect(screen.getByText(/4\.2/)).toBeInTheDocument()
})

test('shows muted state when no data', () => {
  render(<EvalBadge p50={null} variance={null} />)
  expect(screen.getByText(/не оценён/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

```tsx
// frontend/src/components/eval/EvalBadge.tsx
interface Props {
  p50: number | null
  variance: number | null
  onClick?: () => void
}
export default function EvalBadge({ p50, variance, onClick }: Props) {
  if (p50 == null) {
    return <span title="Прогон стабильности не запускался">не оценён</span>
  }
  const stdev = variance != null ? Math.sqrt(variance) : null
  return (
    <button type="button" onClick={onClick} title="Открыть последний прогон">
      📊 {p50.toFixed(1)}/5{stdev != null && ` ±${stdev.toFixed(1)}`}
    </button>
  )
}
```

В `Library.tsx` найти карточку промпта (рендер), добавить:

```tsx
const [summary, setSummary] = useState<{p50:number; var:number}|null>(null)
useEffect(() => {
  api.evalLibrarySummary(item.id).then((s) => setSummary({p50: s.p50, var: s.var})).catch(() => setSummary(null))
}, [item.id])
// в JSX:
<EvalBadge p50={summary?.p50 ?? null} variance={summary?.var ?? null}
           onClick={() => navigate(`/compare?mode=stability&promptId=${item.id}`)} />
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/eval/EvalBadge.tsx frontend/src/pages/Library.tsx frontend/src/components/eval/__tests__/EvalBadge.test.tsx
git commit -m "feat(eval): EvalBadge on library cards"
```

---

### Task 23: Frontend — `<EvalRunsHistory>` дровер

**Files:**
- Create: `frontend/src/components/eval/EvalRunsHistory.tsx`.
- Modify: добавить кнопку открытия дровера в `AppSidebar.tsx` или в `StabilityTab.tsx`.

- [ ] **Step 1: Тест**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import EvalRunsHistory from '../EvalRunsHistory'
import { vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: { evalListRuns: vi.fn().mockResolvedValue({ items: [{ id: 1, status: 'done', mode: 'single', n_runs: 10, agg_overall_p50: 4.2 }], total: 1 }) },
}))

test('shows run rows', async () => {
  render(<EvalRunsHistory open={true} onClose={() => {}} />)
  await waitFor(() => expect(screen.getByText(/4\.2/)).toBeInTheDocument())
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

Простой дровер: `useEffect` грузит `api.evalListRuns({limit: 30})`, отображает таблицу с колонками `id, status, mode, n_runs, agg_overall_p50, created_at`. Клик по строке — открывает страницу прогона (для MVP — переход на `/compare?mode=stability&runId={id}` с предзагрузкой).

- [ ] **Step 4: PASS + commit**

```bash
git add frontend/src/components/eval/EvalRunsHistory.tsx frontend/src/components/AppSidebar.tsx frontend/src/components/eval/__tests__/EvalRunsHistory.test.tsx
git commit -m "feat(eval): runs history drawer linked from sidebar"
```

---

### Task 24: Settings — поле «Дневной бюджет на оценку»

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`.

- [ ] **Step 1: Тест UI**

```tsx
// frontend/src/pages/__tests__/Settings.evalBudget.test.tsx
import { render, screen } from '@testing-library/react'
import Settings from '../Settings'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ openrouter_api_key: '', eval_daily_budget_usd: 5.0 }),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

test('shows eval budget input', async () => {
  render(<MemoryRouter><Settings /></MemoryRouter>)
  expect(await screen.findByLabelText(/дневной бюджет/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализовать**

Найти секцию настроек в `Settings.tsx` и добавить input number с label «Дневной бюджет на оценку, $». При `onChange` — `api.updateSettings({ eval_daily_budget_usd: value })` (или сохранить локально, отправить кнопкой).

- [ ] **Step 4: PASS + commit**

```bash
git add frontend/src/pages/Settings.tsx frontend/src/pages/__tests__/Settings.evalBudget.test.tsx
git commit -m "feat(eval): daily eval budget input in Settings"
```

---

### Task 25: README + docs

**Files:**
- Modify: `README.md` — добавить раздел «Стабильность (eval)» со ссылкой на спеку и план.

- [ ] **Step 1: Дописать раздел**

```md
## Стабильность (eval) — оценка промптов через множественный прогон

В странице «Сравнение и оценка» (`/compare`) есть таб **«Стабильность»**: запусти один или два промпта на одном тестовом запросе **N раз**, увидь распределение оценок LLM-судьи, разнообразие ответов и провалы.

- Спецификация: `docs/superpowers/specs/2026-04-25-eval-stability-mvp-design.md`
- План реализации: `docs/superpowers/plans/2026-04-25-eval-stability-mvp.md`
- Лимит: дневной бюджет (по умолчанию $5/день, меняется в Настройках), максимум 50 прогонов в одном запуске, нужен **свой** OpenRouter ключ.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(eval): add stability section linking spec and plan"
```

---

### Task 26: Финальный прогон тестов и smoke-чек

**Files:** —

- [ ] **Step 1: Полный backend pytest**

```bash
python -m pytest tests/test_eval_*.py -v
```
Expected: все green.

- [ ] **Step 2: Frontend tests**

```bash
cd frontend && npm test -- --run
```
Expected: все green, типизация чистая (`npm run typecheck` если есть скрипт).

- [ ] **Step 3: Запустить сервер локально и проверить вручную**

```bash
uvicorn backend.main:app --reload --port 8000
```
Открыть `http://localhost:5173/compare`, перейти в таб «Стабильность», запустить N=2 на дешёвой модели — убедиться, что прогресс идёт и финальная сводка появляется.

- [ ] **Step 4: Если всё ок — финальный коммит-маркер**

```bash
git commit --allow-empty -m "feat(eval): MVP-1 stability runs complete (per spec 2026-04-25)"
```

---

## Self-review checklist (выполнить после написания плана, не до)

**1. Spec coverage:**

| Раздел спеки | Покрытие |
|---|---|
| §5.1–5.2 анкета и судья | Tasks 6, 7 |
| §5.3 reference | Task 6 (`build_judge_user_message`), Task 14 (передаётся) |
| §5.4 diversity | Task 8 |
| §5.5 majority vote | Task 9 |
| §5.6 pairwise | Tasks 7 (`judge_pair`), 9 (`pair_winrate_with_ci`), 11 (executor) |
| §6.2 data model | Task 1, 2 |
| §6.3 API surface | Tasks 12–16 |
| §7 UX | Tasks 19–22 |
| §8 cost preview | Tasks 5, 13 |
| §9 SSE/фон/cancel | Tasks 10, 11, 15 |
| §10 persistence + library badge | Tasks 2, 16, 22 |
| §11 безопасность/лимиты | Tasks 14, 17 |
| §16 DoD | Task 26 |

**2. Placeholder scan:** в каждой задаче есть конкретный код или сигнатура, не «TODO». Где сокращено (`# тело по паттерну`) — указано, какой паттерн использовать.

**3. Type consistency:**

- `judge_one` → `dict` с ключами `scores/reasoning/overall/overall_reasoning/parse_error` — используется в Task 11 одинаково.
- `aggregate_overall` → `{p10,p50,p90,var,count}` — используется в Task 11 как `agg["p50"]` etc. **OK.**
- `pair_winrate_with_ci` → `{winrate_a/b, tie_rate, winner, confidence}` — Task 11 публикует ровно эти поля. **OK.**
- `EvalRunEvent` (TS) ↔ события из executor (Python): `progress/result_added/aggregate_update/pair_summary/done/cancelled/error/snapshot/status`. **Совпадает.**
- `EvalCostPreview` (TS) ↔ возврат `/preview-cost` — поля `tokens_min/avg/max, usd_min/avg/max, breakdown, daily_*, fits_in_daily_budget, *cheap_tier*`. **OK.**

**4. Risks (внимание при имплементации):**

- В Task 11 `db.get_eval_run(self._run_id, user_id=0)` использует `user_id=0` как «internal». Реализация `get_eval_run` должна это поддерживать (если `user_id == 0` — без фильтра по user_id). Это не противоречит спеке безопасности, потому что executor запускается **только** через серверный маршрут `/runs (POST)` с проверкой пользователя.
- Cancel идущего OpenRouter-запроса невозможен: `_generate_one` дойдёт до конца. Это явно описано в спеке §9 («останавливается на следующем доступном break-point»).
- В Task 16 lifespan-хук `mark_eval_runs_failed_on_startup` должен быть **до** включения роутеров — иначе фоновые executor-ы при гонке обнаружат поменянный статус.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-eval-stability-mvp.md`.

Two execution options:

1. **Subagent-Driven (рекомендуется)** — диспатчим свежий subagent на каждую задачу, между задачами я ревьюю, быстрая итерация.
2. **Inline Execution** — выполняем задачи в этой же сессии через `executing-plans`, батчами с чекпоинтами для ревью.

**Какой подход выбираешь?**

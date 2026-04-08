> **Архив.** В таблице «Текущее состояние» в оригинале была строка «Web migration: нет», противоречащая нижним фазам и реальности после миграции. Ниже текст **без правок** для истории; для go/no-go используйте [`../current/PRODUCTION_CHECKLIST.md`](../current/PRODUCTION_CHECKLIST.md).

# Анализ требований для перехода в продакшен

Документ расширяет `PRODUCTION_CHECKLIST.md` и даёт приоритизированный план действий.

---

## Текущее состояние

| Область | Статус | Что есть |
|---------|--------|----------|
| **Core logic** | ✅ Готово | task_classifier, technique_registry, prompt_spec, evidence, debugger |
| **Unit tests** | ✅ Готово | core, db, parsing, quality_metrics, technique_registry |
| **CI** | ✅ Готово | GitHub Actions, pytest |
| **Storage** | ⚠️ Transition-ready | SQLite + migration/backup scripts for Postgres |
| **Auth** | ✅ MVP | Локальный username/password auth + session binding |
| **Abuse protection** | ✅ MVP | rate limit, input limits, session budget, timeout |
| **Observability** | ✅ MVP | structured logs, Sentry hook, health/readiness endpoint |
| **Deploy** | ⚠️ Частично | Dockerfile есть, runbook/infra automation ещё нужны |
| **Web migration** | ❌ Нет | Streamlit — единственный UI |

*Примечание архивариуса: последняя строка таблицы устарела на момент переноса в архив; см. актуальный чеклист в `docs/current/`.*

---

## Обязательный минимум (go/no-go)

### 1. Auth and users

**Требуется:**
- Модель пользователя (id, email/username, created_at)
- Авторизация (OAuth / magic link / password)
- Разделение сессий и данных по пользователям

**Что реализовано (MVP):**
- таблицы `users` и `user_sessions`;
- локальная регистрация/логин (username/password, PBKDF2);
- привязка `session_id -> user_id`;
- фильтрация library/workspaces/specs/events по `user_id`.

**Осталось до production-grade:** OAuth/magic link, reset password, policy/lockout.

---

### 2. Abuse protection

**Требуется:**
- Rate limiting (запросов/мин на пользователя или IP)
- Лимит размера ввода (например, 50K символов)
- Бюджет LLM-вызовов (лимит токенов/день на пользователя)
- Защита от бесконечных тяжёлых flow (timeout, max iterations)

**Текущий разрыв:**
- Нет ограничений на частоту запросов
- Нет проверки размера `task_input`
- Нет учёта токенов и бюджета
- Итерация и Q&A могут уходить в длинные циклы

**Оценка:** 2–3 дня (Redis или in-memory rate limiter, middleware, env-конфиг лимитов)

---

### 3. Storage

**Требуется:**
- Стратегия миграции с SQLite
- План перехода на Postgres (или managed DB)
- Backup strategy

**Что реализовано (MVP):**
- backup script: `scripts/backup_sqlite.py`;
- migration script: `scripts/migrate_sqlite_to_postgres.py`;
- `POSTGRES_DSN` в env-примере.

**Осталось до production-grade:** Alembic migrations + runtime Postgres adapter для основного app path.

---

### 4. Observability

**Требуется:**
- Structured logging (JSON, уровни)
- Error monitoring (Sentry или аналог)
- Health checks (liveness/readiness)
- Дашборды latency и ошибок

**Текущий разрыв:**
- `app_events` — кастомная телеметрия в SQLite
- Нет централизованного логгера
- Нет интеграции с Sentry
- Нет `/health` endpoint

**Оценка:** 2–3 дня (structlog, Sentry, health endpoint)

---

### 5. Reliability

**Требуется:**
- Unit tests на core
- Integration tests на главные user flows
- CI
- Повторяемый deploy path

**Текущий разрыв:**
- Unit tests есть
- Integration tests — нет (e2e flow)
- CI есть (pytest)
- Deploy — нет чёткого runbook

**Оценка:** 1–2 дня (integration tests, deploy runbook)

---

### 6. Config and deployment

**Требуется:**
- Раздельные `dev` / `demo` / `prod` конфиги
- Секреты не в репозитории (env/secrets manager)
- Документированный deployment process

**Текущий разрыв:**
- `.env` — один файл
- Нет `config/dev.yaml`, `config/prod.yaml`
- Dockerfile есть, но нет prod-конфигов Streamlit
- Нет README для deploy

**Оценка:** 1–2 дня (config loader, env vars, deploy doc)

---

## Приоритизированный план

### Фаза 1: Безопасность и стабильность (1–2 недели) ✅

| # | Задача | Приоритет | Статус |
|---|--------|-----------|--------|
| 1 | Rate limiting + request size limits | P0 | ✅ |
| 2 | Abuse protection: budget, timeout | P0 | ✅ |
| 3 | Structured logging + health check | P1 | ✅ |
| 4 | Error monitoring (Sentry) | P1 | ✅ |
| 5 | Config: dev/demo/prod | P1 | ✅ |

### Фаза 2: Мультитенантность (2–3 недели) ✅ (MVP)

| # | Задача | Приоритет | Статус |
|---|--------|-----------|--------|
| 6 | Users table + auth (username/password MVP) | P0 | ✅ |
| 7 | Session binding к user_id | P0 | ✅ |
| 8 | Разделение данных по пользователям | P0 | ✅ |
| 9 | Миграция: SQLite → Postgres (scripted path) | P1 | ✅ |
| 10 | Backup strategy (script + process) | P2 | ✅ |

### Фаза 3: Production readiness (1 неделя)

| # | Задача | Приоритет | Зависимости |
|---|--------|-----------|-------------|
| 11 | Integration tests | P1 | — |
| 12 | Deploy runbook | P1 | — |
| 13 | Latency/error dashboards | P2 | 4 |

### Фаза 4: Web migration (опционально)

| # | Задача | Приоритет | Зависимости |
|---|--------|-----------|-------------|
| 14 | FastAPI + React | P2 | 1–13 |
| 15 | Canonical flows parity | P2 | 14 |

---

## Рекомендация

**Не переходить в production** до выполнения хотя бы:

- Фаза 1 полностью (abuse, logging, config)
- Фаза 2: задачи 6–8 (auth + multitenancy)

Без auth и abuse protection публичный запуск рискован.

**Фазы 1–2 выполнены в MVP-объёме.** Реализовано:
- auth + users + session binding + per-user data isolation;
- scripted migration `SQLite -> Postgres`;
- backup script для SQLite.

**Следующий шаг:** Фаза 3 — integration tests, deploy runbook, production dashboards.

---

## Ссылки (актуальные пути)

- [PRODUCTION_CHECKLIST.md](../current/PRODUCTION_CHECKLIST.md) — go/no-go checklist
- [STREAMLIT_AUDIT.md](STREAMLIT_AUDIT.md) — исторический аудит Streamlit
- [WEB_MIGRATION_PATH.md](WEB_MIGRATION_PATH.md) — исторический план миграции

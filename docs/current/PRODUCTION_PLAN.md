# План перехода в production

## Текущее состояние

- **FastAPI + React** — основной runtime; Dockerfile — multi-stage (сборка `frontend/dist` + Uvicorn).
- Auth (username/password), rate limiting, session budget — реализованы.
- SQLite по умолчанию; скрипт миграции в Postgres — есть.
- CORS — `CORS_ORIGINS`.

## Чеклист перед production

### Инфраструктура

- [ ] **PostgreSQL** — при необходимости миграция с SQLite (`scripts/migrate_sqlite_to_postgres.py`); для постоянного prod обычно нужны миграции схемы (Alembic) и единый DSN.
- [ ] **HTTPS** — reverse proxy (nginx/traefik/Caddy) с TLS.
- [ ] **Секреты** — `OPENROUTER_API_KEY`, `USER_API_KEY_FERNET_SECRET` и прочее из env / secrets manager.

### Безопасность

- [ ] **CORS** — явные origin-ы production.
- [ ] **Rate limit** — при масштабировании воркеров согласовать хранилище (не только in-memory).
- [ ] **Sentry** — `SENTRY_DSN` при публичном трафике.

### Надёжность

- [ ] **Health** — `/api/health`; при необходимости readiness с проверкой БД.
- [ ] **Graceful shutdown** — корректное завершение при деплое.
- [ ] **Backup** — регламент для SQLite или managed Postgres.

### Деплой

- [x] **Dockerfile** — FastAPI + статика SPA (см. корневой `README.md`).
- [ ] **Env** — `APP_ENV=prod`, `LOG_LEVEL=INFO`, домен в `CORS_ORIGINS`.
- [ ] **Runbook** — шаги выката, отката, миграций.

## Архитектура деплоя (типично)

Один процесс Uvicorn отдаёт API и `frontend/dist` за reverse proxy на 443 **или** отдельно CDN/статика + API.

## Переменные для production

| Переменная | Рекомендация |
|------------|--------------|
| `APP_ENV` | `prod` |
| `DB_PATH` / DSN | Персистентный том или Postgres |
| `CORS_ORIGINS` | `https://your-domain.com` |
| `USER_API_KEY_FERNET_SECRET` | Обязательно при пользовательских ключах |
| `SENTRY_DSN` | Желательно |
| `LOG_LEVEL` | `INFO` |

Локальный развёрнутый гайд (VPS, Caddy) может жить в `docs/PRODUCTION_DEPLOY_AND_OPS.md` — файл в `.gitignore`, не для публикации в публичный clone.

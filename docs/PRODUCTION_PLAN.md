# План перехода в production

## Текущее состояние

- FastAPI + React — основной runtime.
- Auth (username/password), rate limiting, session budget — реализованы.
- SQLite — локальное хранилище.
- CORS — настраивается через `CORS_ORIGINS`.

## Чеклист перед production

### Инфраструктура

- [ ] **PostgreSQL** — миграция с SQLite (скрипт `scripts/migrate_sqlite_to_postgres.py`).
- [ ] **HTTPS** — reverse proxy (nginx/traefik) с TLS.
- [ ] **Секреты** — `OPENROUTER_API_KEY` и пароли из env/secrets manager, не из файлов.

### Безопасность

- [ ] **CORS** — задать `CORS_ORIGINS` для production домена.
- [ ] **Rate limit** — при необходимости увеличить или настроить per-IP.
- [ ] **Sentry** — настроить `SENTRY_DSN` для мониторинга ошибок.

### Надёжность

- [ ] **Health checks** — `/api/health` для liveness; readiness с проверкой DB.
- [ ] **Graceful shutdown** — корректное завершение при деплое.
- [ ] **Backup** — регулярный backup БД.

### Деплой

- [ ] **Dockerfile** — обновить под FastAPI + React (multi-stage: build frontend, serve через uvicorn + static).
- [ ] **Env** — `APP_ENV=prod`, `LOG_LEVEL=INFO`.
- [ ] **DB_PATH** — путь к production БД.

## Рекомендуемая архитектура деплоя

```
[nginx] -> [FastAPI backend :8000]
        -> [static frontend build]
```

Или отдельно:
- Frontend — CDN/static hosting (Vercel, Netlify).
- Backend — отдельный сервис (Railway, Fly.io, k8s).

## Переменные для production

| Переменная | Рекомендация |
|------------|--------------|
| `APP_ENV` | `prod` |
| `DB_PATH` | Путь к PostgreSQL DSN или SQLite в persistent volume |
| `CORS_ORIGINS` | `https://your-domain.com` |
| `SENTRY_DSN` | Обязательно |
| `LOG_LEVEL` | `INFO` |

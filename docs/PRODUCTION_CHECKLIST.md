# Production Checklist

Этот документ нужен не для текущего demo-этапа, а как `go / no-go` перед реальным запуском.

## Сейчас проект готов к

- portfolio demo;
- локальному использованию;
- controlled beta;
- показу продукта и архитектуры на собеседованиях.

## Сейчас проект не готов к

- публичному production launch;
- многопользовательскому SaaS использованию;
- платному доступу;
- открытому интернет-деплою без ограничений.

## Обязательный минимум перед production

### Auth and users

- базовая модель пользователей;
- авторизация;
- разграничение сессий и данных между пользователями.

### Abuse protection

- rate limiting;
- request size limits;
- budget control по LLM-вызовам;
- защита от бесконечных тяжелых generation flows.

### Storage

- понятная стратегия миграции от локального SQLite demo-state;
- план перехода на Postgres или другой production storage;
- backup strategy.

### Observability

- structured logging;
- error monitoring;
- health checks;
- latency and error dashboards.

### Reliability

- unit tests на core;
- integration tests на главные user flows;
- CI;
- повторяемый deploy path.

### Config and deployment

- раздельные `dev / demo / prod` конфиги;
- секреты не в репозитории;
- документированный deployment process.

## Production decision

Переход в production оправдан только после выполнения двух условий:

1. Продукт доказал полезность на demo / beta этапе.
2. Web-версия стала основной и закрывает все canonical flows не хуже Streamlit.

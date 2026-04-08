> **Архив.** Актуальный продукт — FastAPI + React. См. корневой `README.md`.

# Streamlit — законсервирован

Streamlit-версия (`app/`) сохранена для архивной памяти и исторического контекста. Основной продукт — **FastAPI + React**.

## Статус

- **Не поддерживается** — новые фичи добавляются только в web-версию.
- **Запускается** — `streamlit run app/main.py` по-прежнему работает.
- **Использует общий config** — `app/config.py` и `app/abuse.py` реэкспортируют из `config/`.

## Что было

- Демо и portfolio use case.
- Локальная auth, rate limiting, abuse protection.
- Home, Library, Techniques, Compare, Metrics, Workspaces.

## Зачем оставлен

- Референс UX и product shape.
- Исторический контекст для новых разработчиков.
- Возможность быстрого локального демо без npm.

## Запуск (архив)

```bash
streamlit run app/main.py
```

Открой `http://localhost:8501`.

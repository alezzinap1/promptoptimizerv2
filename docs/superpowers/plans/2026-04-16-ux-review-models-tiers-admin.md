# UX-review follow-up — модели, админка, переводы, интеграции

Дата: 2026-04-16. Источник: `metaprompt_full_ux_review_landing_admin.html` + директивы пользователя.

## Анализ отчёта vs реальность

| Пункт отчёта | Текущее состояние | Решение |
| --- | --- | --- |
| Лендинг = логин (критично) | `/` редиректит на `/welcome` → в нём логин-форма, нет «зачем». | Отдельный marketing-лендинг (Фаза 3). Пока: лендинг как demo-прикол не делаем. |
| Админка плоская, без аналитики | Есть `/admin` (список) + `/admin/users/:id`. Нет dashboard, метрик, trends. | Фаза 1D: `/api/admin/metrics` + `AdminDashboard.tsx`. |
| Детальная страница: raw JSON | Есть форма лимитов (сегодня), но профиль/события — JSON | Фаза 1D+: читаемые карточки вместо JSON, парсинг payload. |
| Тулбар перегружен | `T°/Top-P/Top-K/Questions/Skill-context` в тулбаре | Фаза 2: свернуть в drawer, оставить `Model · Tier · Workspace`. |
| Workspaces vs Skills дубликат | Да, workspace пустые у большинства | Deprecation: отдельный ticket после Фазы 2. |
| Улучшить — другой визуал | Светлые длинные карточки vs Studio | Минорный rework, после Фазы 2. |

## Директивы пользователя

1. **Тиры вместо моделей в UI**: `Auto` / `Fast (повседневный)` / `Mid (средний)` / `Advanced (продвинутый)`. Пользователь не видит названий.
2. **Раскладка**: Fast ≈ DeepSeek V3, Mid ≈ Grok-3-mini / Gemini-2.5-Flash, Advanced ≈ новые Claude Haiku / GPT-5-mini / DeepSeek-R1. Advanced использует «думающие» модели + helper-модель для промежуточных шагов.
3. **Бюджет**: выход ≤ **$3 / 1M tokens**. Никогда не выбирать дороже в Auto/тирах.
4. **Healthcheck** раз в сутки: если модель пропала в OpenRouter / сломалась — авто-подбор замены; событие в админке.
5. **В Настройках** — ручной выбор моделей, если есть свой OpenRouter ключ.
6. **Перевод промпта/скилла RU↔EN одной кнопкой** — через fast-тир, учитывает лимиты.
7. **Интеграции** — проанализировать и предложить.

## Архитектура (Фаза 1)

### 1A. `core/model_catalog.py` — редактируемый каталог

```
CATALOG = {
  "text": {
    "fast":     [<model_ids>],   # completion ≤ $1/1M
    "mid":      [<model_ids>],   # completion ≤ $2/1M
    "advanced": [<model_ids>],   # completion ≤ $3/1M
    "helper":   [<model_ids>],   # для промежуточных шагов advanced
  },
  "image":  {"default": [...]},
  "skill":  {"fast": [...], "mid": [...], "advanced": [...]},
}
```
Каждая запись = порядок приоритета; первый доступный по healthcheck — выбирается.
Константа `MAX_COMPLETION_PER_M = 3.0` — жёсткий потолок для всех Auto-маршрутов.

### 1B. `services/model_router.py` — resolve tier → model

- `resolve(tier, mode, db, user_id)` → конкретный `model_id`.
- Учёт: health-статус, своё vs host-key (trial cap ≤ $1/1M для trial сохраняется).
- Возвращает также `reasoning` (чем подменили) для логов/админки.

### 1C. `services/model_health.py` — ежедневная проверка

- Таблица `model_health (model_id TEXT PK, last_checked_at, available INT, reason TEXT, last_pricing_prompt, last_pricing_completion, swapped_from TEXT NULL)`.
- Проверка = берём `get_models()` (уже кеш 24ч) + сверяем наличие каждого `id` из CATALOG + проверка цены ≤ cap.
- Если сломалось — подбираем следующий из того же тира и пишем `swapped_from`.
- Эндпоинты:
  - `GET /api/admin/model-health` — список.
  - `POST /api/admin/model-health/run` — запуск сейчас.
  - Опциональный hook на старт приложения: если `last_checked_at` старше 24ч — дёрнуть в фоне.

### 1D. Админ-метрики

- `GET /api/admin/metrics`:
  - `users_total`, `users_new_7d`, `users_active_7d`, `users_active_1d`
  - `tokens_total`, `tokens_7d`, `tokens_1d`
  - `dollars_total`, `dollars_7d`
  - `blocked_count`, `with_own_key_count`, `trial_exhausted_count`
  - `events_by_name_7d` — для трендов.
- Страница `AdminDashboard.tsx` с карточками + список моделей health.

### 1E. Перевод

- `POST /api/translate`:
  - body: `{ text, direction: "ru->en" | "en->ru" | "auto", kind: "prompt" | "skill" }`
  - Модель: `fast`-тир, system-prompt: «Переведи сохраняя структуру/секции; ничего не добавляй».
  - Учитывает rate limit + usage.
- Позже: кнопка в Studio/Skill editor.

## Последующие фазы (коротко)

- **Фаза 2**: TierSelector в Studio (Auto/Fast/Mid/Advanced) + drawer для advanced-настроек + перевод-кнопка в UI.
- **Фаза 3**: marketing-лендинг `/welcome`, `/login` — отдельно, `POST /api/demo-generate` (rate-limited по IP, без session).
- **Фаза 4**: workspace→skill soft migration, Improve visual align, события с распарсенным payload.
- **Интеграции (анализ)**: Raycast, Obsidian (copy-paste promo), GitHub (export skill → .claude/skills/), Zapier/Make (webhook на библиотеку), Chrome extension (Select text → improve), Notion (insert from library), Telegram bot (quick-improve).

## Риски

- Каталог моделей 2026 — идентификаторы могут быть устаревшими; healthcheck обязателен.
- Advanced-тир с helper-моделями = потенциально удвоение стоимости; нужен явный cap на «дорого» в tier-resolve.
- Translate по fast-тиру — достаточно для 90% случаев; для длинных скиллов можно потом промотировать до mid.

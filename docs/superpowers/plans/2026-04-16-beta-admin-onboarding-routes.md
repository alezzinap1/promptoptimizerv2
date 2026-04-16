# Beta admin, onboarding, `/welcome` + `/` redirects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать спецификацию [`../specs/2026-04-16-beta-admin-onboarding-security-design.md`](../specs/2026-04-16-beta-admin-onboarding-security-design.md): флаги **`is_admin` / `is_blocked`**, API **`/api/admin/*`** с аудитом, SPA **`/welcome`** и диспетчер **`/`**, экран **`/admin`**, онбординг (короткие предпочтения после регистрации + подсказки на Home), **санитизация** событий для админки без текста промптов.

**Architecture:** Инкрементальные PR: сначала **БД + зависимости + блокировка на auth**, затем **admin REST + тесты**, затем **санитизатор событий + лента в админке**, затем **фронт маршрутов и админ UI**, затем **онбординг** (localStorage + существующие поля `user_preferences` где возможно). Зафиксировать **403** для не-админов на всём префиксе `/api/admin/` (единый стиль).

**Tech Stack:** Python 3.x, FastAPI, SQLite/`DBManager`, `pytest`, TypeScript, React 18, Vite, существующий `frontend/src/api/client.ts`.

**Спека ↔ покрытие:** §3 маршруты → Task 8–9; §4 админ → Task 1–7; §5 онбординг → Task 10–11; §6 безопасность → Task 2–3, 7, 12; §8 README → Task 12.

---

## Карта файлов (создать / изменить)

| Путь | Роль |
|------|------|
| `db/manager.py` | Миграция `_migrate_phase14_admin_flags` (`users.is_admin`, `users.is_blocked`), таблица `admin_audit_log`, методы списка пользователей, блокировка, сброс `user_usage`, запись аудита, опционально `last_active_at` (если добавляете — иначе «последняя активность» = max(`user_sessions.updated_at`) в SQL). |
| `backend/deps.py` | `get_current_user`: отказ при `is_blocked`; новый `require_admin` (`Depends` поверх сессии). |
| `backend/api/admin.py` | Роутер `/admin/...` под префиксом приложения `/api`. |
| `backend/main.py` | `include_router(admin.router, prefix="/admin")` внутри `api_app` (итоговый путь `/api/admin/...` — проверить как монтируется префикс у других роутеров). |
| `services/admin_event_sanitize.py` (новый) | Чистка `payload` из `app_events` для ответа админу: удаление ключей с текстом задач/промптов. |
| `backend/api/auth.py` | В **login** (и GitHub callback, если создаёт сессию): отказ, если `is_blocked`. В **`/auth/me`**: добавить `is_admin` (bool), не отдавать `is_blocked` злоумышленнику — достаточно 401 при заблокированной сессии на защищённых эндпоинтах. |
| `tests/test_admin_api.py` (новый) | Доступ, аудит, санитизация. |
| `tests/test_auth_blocked.py` (новый) или расширить существующий auth-тест | Заблокированный не логинится и не проходит `get_current_user`. |
| `frontend/src/pages/Welcome.tsx` (новый) | Витрина (контент перенести/расширить с текущего `Landing.tsx`). |
| `frontend/src/pages/RootRedirect.tsx` (новый) | Компонент: `user ? <Navigate to="/home" /> : <Navigate to="/welcome" />`. |
| `frontend/src/pages/Landing.tsx` | Удалить или оставить тонким реэкспортом `Welcome` — **не** дублировать два разных лендинга. |
| `frontend/src/App.tsx` | Маршруты `/`, `/welcome`, `/admin`, `/admin/users/:id`; убрать путаницу с корнем. |
| `frontend/src/api/client.ts` | Тип `User` + `is_admin`; методы `adminListUsers`, `adminGetUser`, … |
| `frontend/src/pages/admin/AdminUsers.tsx`, `AdminUserDetail.tsx` (новые) | Список и карточка. |
| `frontend/src/components/AppSidebar.tsx` | Пункт «Админка» только если `user.is_admin`. |
| `frontend/src/pages/Auth.tsx` | После успешной **регистрации** — редирект на маршрут онбординга (например `/onboarding`) вместо немедленного `/home`. |
| `frontend/src/pages/OnboardingPreferences.tsx` (новый) | 3–5 полей + «Пропустить» → PATCH существующего API настроек. |
| `frontend/src/pages/Home.tsx` + новый `frontend/src/components/HomeOnboardingHints.tsx` | Подсказки по счётчику визитов в `localStorage`. |
| `scripts/set_admin_user.py` (новый, опционально) | CLI: `python scripts/set_admin_user.py --username X` выставляет `is_admin=1`. |
| `README.md` | Таблица маршрутов + как назначить админа. |

**Уточнение по «последняя активность»:** если в БД нет готового поля, в Task 1 добавить вычисление в `list_users_admin`: `MAX(user_sessions.updated_at)` по `user_id` одним запросом или подзапросом — **без** новых фоновых джобов в MVP.

**Уточнение по «сброс лимита»:** в коде trial — накопительные `user_usage.tokens_used` / `dollars_used` (см. `user_info.py`). Кнопка админа: **`POST /api/admin/users/{id}/reset-trial-usage`** обнуляет счётчики в `user_usage` (и пишет аудит). Не называть «дневной», если в продукте нет дневного окна.

---

### Task 1: Схема БД — `is_admin`, `is_blocked`, `admin_audit_log`

**Files:**
- Modify: `db/manager.py` (в `init()` вызвать новую `_migrate_phase14_admin_flags`, методы ниже)
- Test: `tests/test_db_manager.py` (расширить) или `tests/test_admin_migrations.py` (новый)

- [ ] **Step 1: Написать падающий тест — колонки и таблица существуют после `init()`**

```python
# tests/test_admin_migrations.py
from pathlib import Path
import sqlite3

from db.manager import DBManager


def test_phase14_admin_schema(tmp_path):
    db_path = tmp_path / "t.db"
    db = DBManager(db_path=str(db_path))
    db.init()
    con = sqlite3.connect(str(db_path))
    cur = con.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in cur.fetchall()}
    assert "is_admin" in cols
    assert "is_blocked" in cols
    cur = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_audit_log'"
    )
    assert cur.fetchone() is not None
    con.close()
```

- [ ] **Step 2: Запустить тест — ожидаем FAIL**

Run: `pytest tests/test_admin_migrations.py::test_phase14_admin_schema -v`  
Expected: `AssertionError` (колонок ещё нет).

- [ ] **Step 3: Реализовать миграцию и методы в `DBManager`**

В `db/manager.py` после последней `_migrate_phase13_...` в `init()` добавить вызов `self._migrate_phase14_admin_flags(conn)`.

Тело миграции (внутри `_migrate_phase14_admin_flags`):

```python
def _migrate_phase14_admin_flags(self, conn: sqlite3.Connection) -> None:
    self._safe_add_column(conn, "users", "is_admin", "INTEGER NOT NULL DEFAULT 0")
    self._safe_add_column(conn, "users", "is_blocked", "INTEGER NOT NULL DEFAULT 0")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_user_id INTEGER,
            meta_json TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_user_id) REFERENCES users(id),
            FOREIGN KEY (target_user_id) REFERENCES users(id)
        )
    """)
```

Добавить методы (сигнатуры — адаптировать к стилю файла):

```python
def log_admin_audit(self, admin_user_id: int, action: str, target_user_id: int | None, meta: dict | None) -> int:
    ...

def list_users_admin(
    self, *, q: str | None, limit: int, offset: int
) -> tuple[list[dict], int]:
    """Возвращает (страница пользователей с полями id, username, email, created_at, is_blocked, is_admin, last_active_at), total_count."""
    ...

def set_user_blocked(self, user_id: int, blocked: bool) -> None: ...

def reset_user_trial_usage(self, user_id: int) -> None:
    """UPDATE user_usage SET tokens_used=0, dollars_used=0 WHERE user_id=?; INSERT при отсутствии строки — по аналогии с остальным кодом."""
    ...
```

- [ ] **Step 4: Запустить тест — ожидаем PASS**

Run: `pytest tests/test_admin_migrations.py::test_phase14_admin_schema -v`

- [ ] **Step 5: Commit**

```bash
git add db/manager.py tests/test_admin_migrations.py
git commit -m "feat(db): admin flags, blocked users, admin audit table"
```

---

### Task 2: `get_current_user` — отсекать заблокированных

**Files:**
- Modify: `backend/deps.py`
- Test: `tests/test_auth_blocked.py` (новый)

- [ ] **Step 1: Тест — заблокированный пользователь с валидной сессией получает 401 на `/api/auth/me`**

Создать пользователя и сессию через `DBManager` в фикстуре, выставить `is_blocked=1`, вызвать `TestClient` с заголовком `X-Session-Id` — ожидать **401**.

- [ ] **Step 2: Реализация в `get_current_user`**

После `user = db.get_session_user(...)`:

```python
if user and int(user.get("is_blocked") or 0):
    raise HTTPException(403, "Account disabled")  # или 401 — выбрать один стиль; спека допускает 403
```

(Если выбран **403**, обновите тест на 403.)

- [ ] **Step 3: Login отклоняет заблокированных**

В `backend/api/auth.py` в обработчике login после загрузки пользователя по username:

```python
if int(user.get("is_blocked") or 0):
    raise HTTPException(403, "Account disabled")
```

Аналогично в ветке GitHub OAuth перед выдачей сессии.

- [ ] **Step 4: pytest**

Run: `pytest tests/test_auth_blocked.py backend/deps.py backend/api/auth.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/deps.py backend/api/auth.py tests/test_auth_blocked.py
git commit -m "fix(auth): reject blocked users for API and login"
```

---

### Task 3: `require_admin` и заготовка роутера

**Files:**
- Modify: `backend/deps.py`
- Modify: `backend/api/admin.py` (создать)
- Modify: `backend/main.py`
- Test: `tests/test_admin_api.py`

- [ ] **Step 1: Тест — не-админ получает 403 на `GET /api/admin/users`**

Использовать `fastapi.testclient.TestClient` из существующего паттерна проекта (см. `tests/test_api_health.py`). Создать двух пользователей: один с `is_admin=0`, сессия в заголовке — запрос к `/api/admin/users` → **403**. Админ с `is_admin=1` → **200** и пустой/непустой список.

- [ ] **Step 2: `require_admin` в `backend/deps.py`**

```python
def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not int(user.get("is_admin") or 0):
        raise HTTPException(403, "Admin only")
    return user
```

- [ ] **Step 3: `backend/api/admin.py`**

```python
from fastapi import APIRouter, Depends, Query
from backend.deps import get_db, require_admin
from db.manager import DBManager

router = APIRouter()

@router.get("/users")
def admin_list_users(
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    rows, total = db.list_users_admin(q=q, limit=limit, offset=offset)
    return {"items": rows, "total": total}
```

Проверить монтирование: в `backend/main.py` приложение `api_app` монтируется как `app.mount("/api", api_app)`, поэтому в `api_app.include_router` указывать только **`prefix="/admin"`** → итоговый путь **`/api/admin/...`**.

- [ ] **Step 4: Commit**

```bash
git add backend/deps.py backend/api/admin.py backend/main.py tests/test_admin_api.py
git commit -m "feat(api): admin users list and require_admin"
```

---

### Task 4: Деталь пользователя, блокировка, сброс trial, аудит

**Files:**
- Modify: `db/manager.py`
- Modify: `backend/api/admin.py`
- Test: `tests/test_admin_api.py`

- [ ] **Step 1: Тесты эндпоинтов**

- `GET /api/admin/users/{id}` — 404 если нет пользователя; 200 и тело с `usage` для существующего.  
- `POST /api/admin/users/{id}/block` / `.../unblock` — меняет флаг, пишет строку в `admin_audit_log`.  
- `POST /api/admin/users/{id}/reset-trial-usage` — обнуляет usage.

- [ ] **Step 2: Реализация хендлеров**

Каждый POST после успешного действия:

```python
db.log_admin_audit(
    int(admin["id"]),
    "user.block",
    target_user_id=id,
    meta={"blocked": True},
)
```

- [ ] **Step 3: pytest**

Run: `pytest tests/test_admin_api.py -v`

- [ ] **Step 4: Commit**

```bash
git add db/manager.py backend/api/admin.py tests/test_admin_api.py
git commit -m "feat(api): admin user detail, block, reset trial usage, audit"
```

---

### Task 5: Санитизация `app_events` для админки

**Files:**
- Create: `services/admin_event_sanitize.py`
- Modify: `backend/api/admin.py`
- Test: `tests/test_admin_event_sanitize.py` (новый)

- [ ] **Step 1: Тест на функцию**

```python
# tests/test_admin_event_sanitize.py
from services.admin_event_sanitize import sanitize_event_payload

def test_strips_prompt_like_keys():
    raw = {"latency_ms": 12, "task_input": "SECRET", "final_prompt": "X"}
    out = sanitize_event_payload("generate_prompt_success", raw)
    assert out["latency_ms"] == 12
    assert "task_input" not in out
    assert "final_prompt" not in out
```

- [ ] **Step 2: Реализация**

```python
# services/admin_event_sanitize.py
FORBIDDEN_KEYS = frozenset({
    "task_input", "final_prompt", "prompt", "raw_input", "spec_json",
    "completion", "messages", "text", "user_text",
})

def sanitize_event_payload(event_name: str, payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {}
    return {k: v for k, v in payload.items() if k not in FORBIDDEN_KEYS}
```

При необходимости расширьте `FORBIDDEN_KEYS` после просмотра реальных `log_event` в `generate.py` (grep `payload=`).

- [ ] **Step 3: `GET /api/admin/users/{id}/events?limit=50`**

Возвращает `get_recent_events(user_id=..., limit=...)` с полем `payload` прогнанным через `sanitize_event_payload`.

- [ ] **Step 4: pytest + commit**

```bash
pytest tests/test_admin_event_sanitize.py tests/test_admin_api.py -v
git add services/admin_event_sanitize.py backend/api/admin.py tests/test_admin_event_sanitize.py
git commit -m "feat(api): sanitized admin event feed"
```

---

### Task 6: Rate limit на `/api/admin/*` (опционально но желательно)

**Files:**
- Modify: `config/abuse.py` (если есть централизованные лимиты)
- Modify: `backend/api/admin.py` (вызов существующего `check_rate_limit` с отдельным ключом `admin:{admin_id}`)

- [ ] **Step 1: Добавить вызов с разумным лимитом (например 120 req/min на админа)**

Использовать тот же `check_rate_limit`, что и в `generate.py`, с уникальным scope.

- [ ] **Step 2: Commit**

```bash
git add config/abuse.py backend/api/admin.py
git commit -m "chore(abuse): rate limit admin API"
```

---

### Task 7: `/auth/me` возвращает `is_admin`

**Files:**
- Modify: `backend/api/auth.py`
- Modify: `frontend/src/api/client.ts` (тип `User`)
- Test: минимальный в `tests/test_admin_api.py` или отдельный

- [ ] **Step 1: Расширить ответ**

```python
"is_admin": bool(int(user.get("is_admin") or 0)),
```

- [ ] **Step 2: Commit**

```bash
git add backend/api/auth.py frontend/src/api/client.ts
git commit -m "feat(auth): expose is_admin on me endpoint and client type"
```

---

### Task 8: Фронт — `/welcome`, редирект с `/`, выравнивание ссылок

**Files:**
- Create: `frontend/src/pages/Welcome.tsx` (скопировать разметку из `Landing.tsx`, расширить копирайт по спеке §5.1)
- Create: `frontend/src/pages/RootRedirect.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/Landing.tsx` (реэкспорт или удаление)
- Modify: любые ссылки на `/` как «главная приложения» → `/home` (grep по `frontend/src`)

- [ ] **Step 1: Маршруты**

```tsx
// фрагмент App.tsx — идея
<Route path="/welcome" element={<Welcome />} />
<Route path="/" element={<RootRedirect />} />
```

Убедиться, что **`/login`** по-прежнему вне `Layout`, если так задумано сейчас.

- [ ] **Step 2: `npm run build` в `frontend/`**

Run: `cd frontend; npm run build`  
Expected: успешная сборка.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Welcome.tsx frontend/src/pages/RootRedirect.tsx frontend/src/App.tsx frontend/src/pages/Landing.tsx
git commit -m "feat(ui): welcome page and root redirect for auth state"
```

---

### Task 9: Админ UI `/admin`

**Files:**
- Create: `frontend/src/pages/admin/AdminUsers.tsx`
- Create: `frontend/src/pages/admin/AdminUserDetail.tsx`
- Modify: `frontend/src/api/client.ts` (методы admin)
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppSidebar.tsx`

- [ ] **Step 1: Методы API**

```ts
// пример сигнатур в client.ts
adminListUsers(params: { q?: string; limit?: number; offset?: number }): Promise<{ items: ...; total: number }>
adminGetUser(id: number): Promise<...>
adminBlockUser(id: number): Promise<void>
adminUnblockUser(id: number): Promise<void>
adminResetTrialUsage(id: number): Promise<void>
adminUserEvents(id: number, limit?: number): Promise<{ events: ...[] }>
```

Все запросы с существующим заголовком сессии.

- [ ] **Step 2: Страницы**

Список: поле поиска `q`, таблица, пагинация.  
Карточка: кнопки Block/Unblock, Reset trial, блок «События» таблицей `event_name`, `created_at`, JSON **уже санитизированный** с бэка.

- [ ] **Step 3: Защита маршрута**

Если `!user.is_admin` — `<Navigate to="/home" replace />`.

- [ ] **Step 4: `npm run build` + commit**

```bash
cd frontend; npm run build
git add frontend/src/pages/admin frontend/src/api/client.ts frontend/src/App.tsx frontend/src/components/AppSidebar.tsx
git commit -m "feat(ui): admin users list and detail"
```

---

### Task 10: Онбординг предпочтений после регистрации

**Files:**
- Create: `frontend/src/pages/OnboardingPreferences.tsx`
- Modify: `frontend/src/pages/Auth.tsx` (после register — `navigate('/onboarding')`)
- Modify: `frontend/src/App.tsx` (маршрут `/onboarding` с `RequireAuth`)
- Modify: существующий API настроек (например `backend/api/settings.py` + `PATCH`) — **или** только localStorage, если не хотите трогать бэк: спека предпочитает существующие поля — минимум: записать в **`user_preferences`** через уже существующий эндпоинт обновления настроек.

Маппинг примеров (подправить под реальные поля в `settings` API):

- «Язык UI» → если нет отдельного поля, хранить в **`localStorage`** ключ `ui_locale` (допустимо как временный MVP) **или** добавить колонку `locale TEXT` в миграции — **выберите один путь в PR и задокументируйте в README**.  
- «Как классифицировать задачи» → `task_classification_mode`.  
- «Любимые целевые модели» → часть `preferred_target_models` (если API позволяет).

- [ ] **Step 1: Реализовать страницу + «Пропустить» → `/home`**

- [ ] **Step 2: `npm run build` + commit**

```bash
git add frontend/src/pages/OnboardingPreferences.tsx frontend/src/pages/Auth.tsx frontend/src/App.tsx
git commit -m "feat(ui): post-registration onboarding preferences"
```

---

### Task 11: Подсказки на Home (первые N визитов)

**Files:**
- Create: `frontend/src/components/HomeOnboardingHints.tsx`
- Modify: `frontend/src/pages/Home.tsx`

- [ ] **Step 1: Логика ключей localStorage**

```ts
const STORAGE_KEY = 'home_onboarding_visit_count'
const MAX_HINT_VISITS = 8
```

Показывать 1–2 компактных блока: цепочка «задача → генерация → библиотека», ссылка на `/settings` (ключ), на `/user-info` (лимиты), на `/help`.

- [ ] **Step 2: Кнопка «Не показывать»** — выставить счётчик выше лимита.

- [ ] **Step 3: commit**

```bash
git add frontend/src/components/HomeOnboardingHints.tsx frontend/src/pages/Home.tsx
git commit -m "feat(ui): home onboarding hints for first visits"
```

---

### Task 12: Документация и операторский скрипт

**Files:**
- Modify: `README.md`
- Create: `scripts/set_admin_user.py`

- [ ] **Step 1: README — маршруты `/welcome`, `/admin`, как выставить `is_admin`**

- [ ] **Step 2: Скрипт**

```python
#!/usr/bin/env python3
"""Usage: python scripts/set_admin_user.py --username myadmin"""
# argparse, DBManager, UPDATE users SET is_admin=1 WHERE username=?
```

- [ ] **Step 3: Commit**

```bash
git add README.md scripts/set_admin_user.py
git commit -m "docs: beta admin routes; script to grant is_admin"
```

---

## Self-review (чеклист навыка writing-plans)

1. **Покрытие спеки:** §3–6 отражены задачами 1–12; пустых ссылок на несуществующие типы нет.  
2. **Плейсхолдеры:** нет TBD в обязательных шагах; развилка `locale` явно помечена как выбор в PR.  
3. **Согласованность:** `reset-trial-usage` назван в соответствии с фактическими `user_usage`, не «дневной лимит».

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-16-beta-admin-onboarding-routes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — отдельный субагент на каждую задачу, ревью между задачами, быстрые итерации.

**2. Inline Execution** — выполнять задачи в этой сессии пакетами с чекпоинтами для ревью.

**Which approach do you want?**

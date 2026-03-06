# Prompt Engineer Agent

Профессиональный Telegram-агент для разработки промптов с базой знаний техник промптинга.

## Ключевые возможности

- **Автоматическая классификация задачи** — определяет тип (код, анализ, текст, etc.) и сложность
- **База знаний техник** — 8 техник промптинга в YAML-карточках (расширяемо)
- **Умный выбор техник** — агент подбирает оптимальные техники для каждой задачи
- **Internal Reasoning** — агент объясняет себе (и пользователю) почему выбрана та или иная техника
- **Summary-based memory** — сжатое резюме сессии вместо хранения 16 сырых сообщений
- **Версионирование промптов** — история итераций в базе данных
- **10 LLM моделей** через OpenRouter

## Техники промптинга в базе знаний

| Техника | Описание |
|---|---|
| Role Prompting | Задаёт экспертную роль |
| Chain of Thought | Пошаговое рассуждение |
| Few-Shot | Обучение на примерах |
| Structured Output | Контроль формата вывода |
| Self-Consistency | Множественные независимые рассуждения |
| Meta-Prompting | Рефлексия и артикуляция ограничений |
| Constraints Prompting | Явные ограничения и guardrails |
| ReAct | Чередование рассуждения и действия |

## Структура проекта

```
prompt-engineer-agent/
├── techniques/          ← База знаний: YAML-карточки техник
│   ├── role_prompting.yaml
│   ├── chain_of_thought.yaml
│   └── ...
│
├── bot/
│   ├── core/            ← Бизнес-логика (переиспользуется в web)
│   │   ├── technique_registry.py  ← Загрузка и поиск техник
│   │   ├── task_classifier.py     ← Классификация задачи
│   │   ├── context_builder.py     ← Сборка system prompt
│   │   └── session_memory.py      ← Summary-based память
│   │
│   ├── db/
│   │   └── sqlite_manager.py      ← Async SQLite
│   │
│   ├── services/
│   │   └── llm_client.py          ← OpenRouter API
│   │
│   ├── handlers/
│   │   ├── commands.py            ← Команды и обработка промптов
│   │   ├── callbacks.py           ← Inline кнопки
│   │   └── keyboards.py           ← Фабрики клавиатур
│   │
│   └── main.py                    ← Точка входа
│
├── requirements.txt
├── Dockerfile
└── .env.example
```

## Установка и запуск

### Локально

```bash
# 1. Клонировать репозиторий
git clone <repo>
cd prompt-engineer-agent

# 2. Создать виртуальное окружение
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или: .\venv\Scripts\activate  # Windows

# 3. Установить зависимости
pip install -r requirements.txt

# 4. Настроить переменные окружения
cp .env.example .env
# Открыть .env и заполнить TELEGRAM_BOT_TOKEN и OPENROUTER_API_KEY

# 5. Запустить бота
python -m bot.main
```

### Web-приложение (Streamlit)

```bash
streamlit run app/main.py
```

Страницы: Home, Compare, Library, Techniques. Навигация в верхней панели.

### Docker

```bash
docker build -t prompt-agent .
docker run -d \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  prompt-agent
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `OPENROUTER_API_KEY` | API ключ OpenRouter |
| `DB_PATH` | Путь к SQLite базе (по умолчанию: `data/agent.db`) |

## Добавление новых техник

Создай YAML-файл в папке `techniques/` по шаблону:

```yaml
id: my_technique
name: "Название техники"

when_to_use:
  task_types: [code, analysis]  # типы задач
  complexity: [medium, high]
  not_for: [simple_facts]

why_it_works: >
  Объяснение почему техника работает...

core_pattern: "Шаблон промпта с {переменными}"

variants:
  - name: "Вариант 1"
    pattern: "..."
    cost_tokens: low
    use_when: "когда применять"

anti_patterns:
  - "Когда НЕ использовать"

compatibility:
  combines_well_with: [role_prompting]
```

Бот подхватит новую карточку после перезапуска (или вызова `registry.reload()`).

## Архитектурные решения

- **Модульный core/** — бизнес-логика отделена от Telegram-слоя для будущей веб-версии
- **Динамический контекст** — в system prompt инжектируются только карточки выбранных техник (~100-200 токенов), не вся база
- **Summary memory** — вместо 16 сырых сообщений хранится сжатое резюме (~150 токенов)
- **[REASONING] блок** — агент объясняет свой выбор техник перед генерацией промпта
- **Keyword classifier** — определение типа задачи без LLM-вызова (быстро, бесплатно)

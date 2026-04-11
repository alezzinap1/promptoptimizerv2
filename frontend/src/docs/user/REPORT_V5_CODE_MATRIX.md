# Отчёт v5 ↔ код: матрица и чеклист

Сводка по [metaprompt_full_analysis_v5.html](./metaprompt_full_analysis_v5.html): ожидание отчёта, где это в репозитории, статус.

**Статусы:** done — соответствует; partial — частично; gap — нет / не совпадает.

## Вкладка «Уровни + модели»

| Тема отчёта | Код / файлы | Статус |
|-------------|-------------|--------|
| Пресеты Junior–Creative | `frontend/src/lib/expertLevelPresets.ts` | done |
| Потолок T0.85 (Creative) | Пресет Creative + `clampExpertGenerationTemperature`, сервер в `backend/api/generate.py` | done |
| Две оси перегружают новичка | Уровень — компактный `SelectDropdown` в строке с вкладками; модель отдельно | partial |
| LevelBundle в продукте | `frontend/src/lib/levelBundle.ts` (тип + метаданные); отдельный UI «бандлов» как в HTML нет | partial |
| target_model для фото/скилла | `effectiveTargetModel` в `Home.tsx` (skill → target, image → gen_model) | done |
| Отдельное поле skill_target_env | Не введено | gap |
| Intent «Авто» уровень | Нет отдельного режима | gap |
| Reasoning-модели: мягкий пресет | `frontend/src/lib/modelReasoning.ts` + эффект при смене модели в `Home.tsx` | partial |
| Cost visibility | Ориентир «N вызовов · $» из `levelBundle` у композера (`Home.tsx`) | partial |

## Вкладка «Скриншоты»

| Тема | Код | Статус |
|------|-----|--------|
| Diff + спарклайн | `Home.tsx`, `Home.module.css` | done |
| Chips советов | `Home.tsx` | done |
| Компактный уровень (badge) | `SelectDropdown` toolbar в `Home.tsx` | done |
| Лейбл токенов задачи | Подпись «задача» + title | partial |
| Compare: стена про Авто/Вручную | Короткая строка + расширенные `title` у радио (`Compare.tsx`) | done |
| Скиллы локально | `localSkillsStore.ts` + экспорт/импорт JSON в `SkillsPanel.tsx` | partial |
| Подписи моделей `provider/id` | `frontend/src/utils/generationModelLabel.ts` | done |

## Вкладка «Продукт»

| Тема | Код | Статус |
|------|-----|--------|
| Playground для любого промпта | `POST /api/playground/run` — `backend/api/playground.py`; `api.playgroundRun` | partial (API; UI общего Playground не подключён) |
| Онбординг | `FirstVisitHomeTip.tsx` + справка | partial |

## Чеклист «Обязательно до теста» (прогон)

| Пункт | Результат проверки по коду |
|-------|----------------------------|
| Скиллы на сервере | Нет; добавлен **экспорт/импорт JSON** в библиотеке скиллов. |
| Disabled при генерации | Табы Текст/Фото/Скилл, уровни, «Новый диалог», дропдауны композера, переключатель техник, доп. параметры, чипы примеров скилла. |
| Онбординг | Уже был баннер; добавлен раздел справки «Уровни студии». |
| Имена моделей в списке | Улучшен `shortGenerationModelLabel` для строк с `/`. |
| FAQ по уровням | `frontend/src/docs/user/EXPERT_LEVELS_FAQ.md` + вкладка в `Help.tsx`. |

Обновляйте этот файл при закрытии пунктов бэклога.

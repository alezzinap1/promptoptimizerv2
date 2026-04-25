/**
 * Небольшая подборка для страницы «Модели»: понятнее, чем весь каталог OpenRouter.
 * ID должны совпадать с OpenRouter; при смене API подборку обновляют вручную.
 */
export type CuratedModelPick = {
  id: string
  /** Короткое имя без жаргона */
  title: string
  /** С чем хорошо справляется */
  goodFor: string
  /** Чем отличается от соседей в подборке */
  vsOthers: string
}

export const CURATED_MODEL_PICKS: CuratedModelPick[] = [
  {
    id: 'deepseek/deepseek-v4-flash',
    title: 'DeepSeek V4 Flash',
    goodFor: 'Повседневные задачи, русский язык, быстрый ответ, цена/качество.',
    vsOthers: 'Актуальная линейка V4 Flash; для глубокого рассуждения — DeepSeek R1 или Sonnet.',
  },
  {
    id: 'openai/gpt-4o-mini',
    title: 'GPT‑4o mini',
    goodFor: 'Черновики, быстрые ответы, простые инструкции.',
    vsOthers: 'Быстрее и дешевле полного GPT‑4o; сложную логику и код — лучше GPT‑4o.',
  },
  {
    id: 'openai/gpt-4o',
    title: 'GPT‑4o',
    goodFor: 'Сложные задачи, код, структурированные ответы.',
    vsOthers: 'Универсальный «тяжёлый» вариант OpenAI; длинные документы часто удобнее в Claude.',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    title: 'Claude 3.5 Sonnet',
    goodFor: 'Длинный контекст, аккуратное следование инструкциям, тексты.',
    vsOthers: 'Сильнее в развернутых текстах; для экономии — DeepSeek или mini.',
  },
  {
    id: 'google/gemini-flash-1.5',
    title: 'Gemini 1.5 Flash',
    goodFor: 'Быстро и недорого, краткие ответы, массовые запросы.',
    vsOthers: 'Скорость и цена; максимальное качество в подборке — GPT‑4o или Sonnet.',
  },
  {
    id: 'mistralai/mistral-nemo',
    title: 'Mistral Nemo',
    goodFor: 'Лёгкая модель, эксперименты, простой текст.',
    vsOthers: 'Проще и дешевле флагманов; для серьёзных задач — GPT‑4o или DeepSeek.',
  },
]

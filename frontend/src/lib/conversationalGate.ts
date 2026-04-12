/**
 * Сообщения без явной задачи на промпт — отвечаем в чате, без вызова генерации.
 * Не используем \b в RegExp для кириллицы: в JS граница «слова» только для [A-Za-z0-9_].
 */

import { looksLikeApplyTipDirective } from './agentFollowUp'

/** Подстроки, по которым считаем, что пользователь описывает задачу / промпт */
const TASK_INTENT_MARKERS = [
  'промпт',
  'prompt',
  'задач',
  'нужен ',
  'нужна ',
  'нужно ',
  'напиши',
  'сгенер',
  'улучши',
  'сделай',
  'сделайте',
  'описани',
  'для модел',
  'целевой модел',
  'json',
  'csv',
  'sql',
  'regex',
  'api ',
  'код ',
  'функци',
  'класс ',
  'метод ',
  'react',
  'docker',
  'разбери',
  'переведи',
  'составь текст',
  'оформи ',
  'инструкци',
  'системн',
  'few-shot',
  'chain of thought',
  'cot ',
  'добавь',
  'дополн',
  'измени',
  'убери',
  'короче',
  'длиннее',
  'формальн',
  'сделай проще',
  'примени совет',
  'применить совет',
  'apply tip',
  'фото',
  'картинк',
  'изображен',
  'midjourney',
  'dall-e',
  'stable diffusion',
  'нарисуй',
  'рисунок',
  'скилл',
  'навык',
  'skill',
]

const MINIMAL_RE = /^(ок|окей|okay|да|нет|спасибо|thanks|thx|понял|понятно|ладно|хорошо|ага|угу)\.?$/i

const CHAT_OPENERS = [
  /^как дела/i,
  /^как ты\??$/i,
  /^как ваши дела/i,
  /^что ты умеешь/i,
  /^чем можешь помочь/i,
  /^кто ты/i,
  /^ты кто/i,
  /^ты бот/i,
  /^спасибо/i,
  /^благодарю/i,
  /^пожалуйста$/i,
  /^приветствую/i,
  /^пока\b/i,
  /^до свидан/i,
  /^здравствуйте?$/i,
]

function startsWithGreeting(t: string): boolean {
  const s = t.trim().toLowerCase()
  if (!s) return false
  const oneWord = /^(привет|здравствуй|здравствуйте|хай|салют|дратути|hi|hello|hey|yo)([!?.…,\s]|$)/i.test(s)
  const goodDay = /^(добрый|доброе)\s+(день|вечер|утро)([!?.…,\s]|$)/i.test(s)
  return oneWord || goodDay
}

export function hasLikelyPromptTask(text: string): boolean {
  const t = text.toLowerCase()
  return TASK_INTENT_MARKERS.some((m) => t.includes(m))
}

/** Короткий ответ в чат, если пользователь просто здоровается / болтает */
export function pickConversationalReply(): string {
  const pool = [
    'Опишите задачу для промпта — результат будет справа. Или напишите вопрос — отвечу кратко.',
    'Кратко опишите, что должна делать модель; при необходимости задам уточнения.',
  ]
  return pool[Math.floor(Math.random() * pool.length)]
}

export function pickAfterPromptChatReply(): string {
  return 'Пожалуйста! Если нужно что-то изменить в промпте справа — напишите, что поправить.'
}

export function isConversationalOnlyMessage(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (looksLikeApplyTipDirective(t)) return false
  if (hasLikelyPromptTask(t)) return false
  if (t.length > 240) return false

  if (MINIMAL_RE.test(t)) return true
  if (startsWithGreeting(t)) return true

  for (const re of CHAT_OPENERS) {
    if (re.test(t)) return true
  }

  const words = t.split(/\s+/).filter(Boolean)
  if (words.length <= 2 && t.length <= 32 && !/\d{2,}/.test(t)) {
    return true
  }

  return false
}

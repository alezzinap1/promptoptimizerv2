/**
 * Изолированные снимки студии агента для вкладок «Текст / Фото / Скилл» —
 * отдельные чаты, сессии и пресеты без пересечения при переключении.
 */
import type { GenerateResult, SuggestedStudioAction } from '../api/client'
import type { ExpertLevel } from './expertLevelPresets'
import type { PromptDoneCard } from './studioPromptDoneCard'
import type { LineDiffOp } from './lineDiffLcs'

export type StudioAppliedTip = { index: number; fullText: string }

export type PromptStudioMode = 'text' | 'image' | 'skill'

export type { ExpertLevel }

export type StudioChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  clarificationQA?: { question: string; answers: string[] }[]
  promptDoneCard?: PromptDoneCard
  appliedTip?: StudioAppliedTip
  editPreviewCard?: {
    instruction: string
    oldPrompt: string
    newPrompt: string
    diffOps: LineDiffOp[]
  }
}

export type AgentStudioSnapshot = {
  chatMessages: StudioChatMessage[]
  taskInput: string
  baseTaskRef: string
  feedback: string
  result: GenerateResult | null
  sessionId: string | null
  iterationMode: boolean
  questionState: Record<number, { options: string[]; custom: string }>
  questionCarouselIdx: number
  quickSaved: boolean
  imagePromptTags: string[]
  imagePresetId: string
  imageEngine: string
  imageDeepMode: boolean
  skillPresetId: string
  /** Среда развёртывания скилла (skill_target_env в /generate). */
  skillTargetEnv: string
  /** Текст активного скилла — уходит в API как skill_body (контекст для генерации промпта). */
  skillBody: string
  /** Профиль «режим эксперта» — влияет на вопросы, техники, температуру. */
  expertLevel: ExpertLevel
  /** Эвристические подсказки после готового промпта (сервер: /generate, /agent/process). */
  suggestedActions: SuggestedStudioAction[]
}

const WELCOME_TEXT =
  'Опишите задачу в чате — при необходимости задам уточнения, затем соберу промпт справа. Модель генерации, целевая модель и рабочую область можно выбрать внизу.'

const WELCOME_IMAGE =
  'Режим фото: опишите сцену или идею для генерации изображения. При включённых уточнениях сначала задам вопросы по стилю, свету и формату. Пресет и движок — в панели ввода.'

const WELCOME_SKILL =
  'Режим скилла: опишите, какой навык или инструкцию нужно оформить для ИИ-ассистента. При уточнениях соберу структуру и правила. Пресет скилла — в панели ввода.'

export function defaultWelcomeForMode(mode: PromptStudioMode): string {
  if (mode === 'image') return WELCOME_IMAGE
  if (mode === 'skill') return WELCOME_SKILL
  return WELCOME_TEXT
}

/** Глубокая копия снимка вкладки — без общих ссылок между text / image / skill и живым состоянием React. */
export function cloneAgentStudioSnapshot(s: AgentStudioSnapshot): AgentStudioSnapshot {
  try {
    return structuredClone(s) as AgentStudioSnapshot
  } catch {
    return JSON.parse(JSON.stringify(s)) as AgentStudioSnapshot
  }
}

export function createEmptyStudioSnapshot(mode: PromptStudioMode): AgentStudioSnapshot {
  return {
    chatMessages: [{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode(mode) }],
    taskInput: '',
    baseTaskRef: '',
    feedback: '',
    result: null,
    sessionId: null,
    iterationMode: false,
    questionState: {},
    questionCarouselIdx: 0,
    quickSaved: false,
    imagePromptTags: [],
    imagePresetId: '',
    imageEngine: 'auto',
    imageDeepMode: false,
    skillPresetId: '',
    skillTargetEnv: 'generic',
    skillBody: '',
    expertLevel: 'mid',
    suggestedActions: [],
  }
}

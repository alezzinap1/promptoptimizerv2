import type { PromptStudioMode } from './agentStudioModes'

export type ExpertLevel = 'junior' | 'mid' | 'senior' | 'creative'

/** Сильные техники для режима Senior (id как в techniques/*.yaml). */
export const SENIOR_MANUAL_TECHNIQUE_IDS = [
  'chain_of_thought',
  'role_prompting',
  'self_consistency',
  'constraints_prompting',
  'meta_prompting',
] as const

export type ExpertLevelPreset = {
  questionsMode: boolean
  techniqueMode: 'auto' | 'manual'
  manualTechs: string[]
  temperature: number
  topP: number
  /** Только для UI / режима фото */
  imageDeepMode?: boolean
}

export function getExpertLevelPreset(level: ExpertLevel, mode: PromptStudioMode): ExpertLevelPreset {
  switch (level) {
    case 'junior':
      return {
        questionsMode: true,
        techniqueMode: 'auto',
        manualTechs: [],
        temperature: 0.45,
        topP: 0.95,
        imageDeepMode: false,
      }
    case 'mid':
      return {
        questionsMode: true,
        techniqueMode: 'auto',
        manualTechs: [],
        temperature: 0.7,
        topP: 1,
        imageDeepMode: false,
      }
    case 'senior':
      return {
        questionsMode: false,
        techniqueMode: 'manual',
        manualTechs: [...SENIOR_MANUAL_TECHNIQUE_IDS],
        temperature: 0.85,
        topP: 1,
        imageDeepMode: mode === 'image',
      }
    case 'creative':
      return {
        questionsMode: mode === 'skill' ? false : true,
        techniqueMode: mode === 'text' ? 'manual' : 'auto',
        manualTechs: mode === 'text' ? [...SENIOR_MANUAL_TECHNIQUE_IDS].slice(0, 4) : [],
        temperature: 0.92,
        topP: 1,
        imageDeepMode: mode === 'image',
      }
    default:
      return getExpertLevelPreset('mid', mode)
  }
}

export const EXPERT_LEVEL_LABELS: Record<ExpertLevel, string> = {
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  creative: 'Creative',
}

export const EXPERT_LEVEL_HINTS: Record<ExpertLevel, string> = {
  junior: 'Больше уточняющих вопросов, авто-техники, сдержанная креативность.',
  mid: 'Баланс как по умолчанию.',
  senior: 'Без лишних вопросов, ручной набор сильных техник, выше температура.',
  creative: 'Фото/скилл: глубже стиль и структура; текст — разнообразие техник.',
}

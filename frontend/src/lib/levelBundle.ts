import type { ExpertLevel } from './expertLevelPresets'
import type { ExpertLevelPreset } from './expertLevelPresets'
import { getExpertLevelPreset } from './expertLevelPresets'
import type { PromptStudioMode } from './agentStudioModes'

/**
 * Продуктовый «бандл» уровня (отчёт v5): метаданные для подсказок, стоимости и выбора модели по умолчанию.
 * Поведение генерации по-прежнему задаётся ExpertLevelPreset; бандл не дублирует числа — только обогащает UI/логику.
 */
export type LevelBundleId = 'quick' | 'balanced' | 'precise' | 'creative_profile'

export type LevelBundle = {
  id: LevelBundleId
  expertLevel: ExpertLevel
  label: string
  icon: string
  /** Рекомендуемый short key или OpenRouter id для первого запуска */
  defaultGenModelHint: string
  estimatedCalls: number
  estimatedCostHint: string
  description: string
}

export const LEVEL_BUNDLES: LevelBundle[] = [
  {
    id: 'quick',
    expertLevel: 'junior',
    label: 'Быстро',
    icon: '\u26A1',
    defaultGenModelHint: 'deepseek',
    estimatedCalls: 1,
    estimatedCostHint: '<$0.001',
    description: 'Больше уточнений, сдержанная температура — для новых задач.',
  },
  {
    id: 'balanced',
    expertLevel: 'mid',
    label: 'Стандарт',
    icon: '\u2696\uFE0F',
    defaultGenModelHint: 'gemini_flash',
    estimatedCalls: 1,
    estimatedCostHint: '<$0.001',
    description: 'Баланс по умолчанию.',
  },
  {
    id: 'precise',
    expertLevel: 'senior',
    label: 'Точно',
    icon: '\uD83C\uDFAF',
    defaultGenModelHint: 'claude_sonnet',
    estimatedCalls: 1,
    estimatedCostHint: '~$0.001–0.003',
    description: 'Минимум вопросов, сильные техники вручную.',
  },
  {
    id: 'creative_profile',
    expertLevel: 'creative',
    label: 'Творчески',
    icon: '\u2728',
    defaultGenModelHint: 'grok',
    estimatedCalls: 2,
    estimatedCostHint: '~$0.002',
    description: 'Больше разнообразия; температура ограничена потолком для стабильного [PROMPT].',
  },
]

const EXPERT_TO_BUNDLE: Record<ExpertLevel, LevelBundleId> = {
  junior: 'quick',
  mid: 'balanced',
  senior: 'precise',
  creative: 'creative_profile',
}

export function getLevelBundleForExpertLevel(level: ExpertLevel): LevelBundle {
  const id = EXPERT_TO_BUNDLE[level]
  return LEVEL_BUNDLES.find((b) => b.id === id) ?? LEVEL_BUNDLES[1]
}

export function getBundledPreset(level: ExpertLevel, mode: PromptStudioMode): ExpertLevelPreset {
  return getExpertLevelPreset(level, mode)
}

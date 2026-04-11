/**
 * Эвристика «reasoning»-моделей (согласована с core/model_taxonomy.py).
 * При смене gen_model студия может смягчать пресет: температура, ручные техники.
 */

const REASONING_IDS = new Set(
  ['deepseek_r1', 'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini'].map((s) => s.toLowerCase()),
)

const REASONING_PATTERNS: RegExp[] = [
  /\bo[134]\b/i,
  /\bo\d+-mini\b/i,
  /\bo\d+-preview\b/i,
  /deepseek[/-]r1\b/i,
  /extended[_-]?thinking/i,
  /thinking/i,
  /\bqwq\b/i,
]

/** Техники, которые backend подавляет для reasoning (см. SUPPRESS_FOR_REASONING). */
export const REASONING_SUPPRESS_MANUAL_TECH_IDS = [
  'chain_of_thought',
  'self_consistency',
  'tree_of_thoughts',
  'meta_prompting',
] as const

const REASONING_SUPPRESS_SET = new Set<string>(REASONING_SUPPRESS_MANUAL_TECH_IDS)

export function isReasoningModelId(modelId: string | undefined | null): boolean {
  const key = (modelId || '').toLowerCase().trim()
  if (!key || key === 'unknown') return false
  if (REASONING_IDS.has(key)) return true
  for (const pat of REASONING_PATTERNS) {
    if (pat.test(key)) return true
  }
  return false
}

export function filterManualTechsForReasoningModel(ids: string[]): string[] {
  return ids.filter((id) => !REASONING_SUPPRESS_SET.has(id))
}

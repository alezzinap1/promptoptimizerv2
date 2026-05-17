export const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'
export const ACTIVE_SESSION_KEY = 'prompt-engineer-active-prompt-session'
export const HOME_AGENT_SPLIT_KEY = 'prompt-engineer-home-agent-split'

export const LLM_REVIEW_DOCK_HELP =
  'Судья анализирует формулировку промпта, не выполняет вашу задачу. Если текст похож на ответ задачи — «Свежая оценка».'

export const AGENT_THINKING_PHASES = [
  'Разбираю формулировку…',
  'Сопоставляю с контекстом…',
  'Подбираю техники и структуру…',
  'Продумываю уточнения…',
  'Собираю текст промпта…',
  'Проверяю согласованность…',
] as const

export const PRE_PROMPT_ROUTING_LINE = 'Слушаю реплику и подбираю ответ…'
export const PRE_PROMPT_TASK_LINE = 'Понял задачу — собираю промпт…'
export const PRE_PROMPT_SKILL_LINE = 'Понял — оформляю скилл…'

export const AGENT_PROCESS_PRE_TIMEOUT_MS = 15_000

export const DEFAULT_AGENT_SPLIT = 0.38

export function clampSplit(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function loadAgentSplit(): number {
  try {
    const raw = localStorage.getItem(HOME_AGENT_SPLIT_KEY)
    if (raw) {
      const n = parseFloat(raw)
      if (!Number.isNaN(n)) return clampSplit(n, 0.22, 0.62)
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_AGENT_SPLIT
}

/** Куда в первую очередь пойдёт скилл (отчёт v5: skill_target_env). */

export type SkillTargetEnvId = 'generic' | 'claude' | 'openai' | 'langgraph' | 'crewai'

export const SKILL_TARGET_ENV_OPTIONS: { value: SkillTargetEnvId; label: string; title: string }[] = [
  {
    value: 'generic',
    label: 'Общий',
    title: 'Без жёсткой привязки к платформе — универсальная структура скилла.',
  },
  {
    value: 'claude',
    label: 'Claude',
    title: 'Anthropic / Claude: роли, markdown, границы отказа, длинный контекст.',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    title: 'Chat Completions / Assistants: чёткие инструкции, при необходимости инструменты и JSON.',
  },
  {
    value: 'langgraph',
    label: 'LangGraph',
    title: 'Граф агента: состояние, узлы, условные переходы.',
  },
  {
    value: 'crewai',
    label: 'CrewAI',
    title: 'Несколько ролей-агентов, инструменты на роль, делегирование.',
  },
]

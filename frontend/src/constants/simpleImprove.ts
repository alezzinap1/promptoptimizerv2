export const SIMPLE_PRESET_IDS = [
  'balanced',
  'shorter',
  'stricter',
  'clearer_structure',
  'richer_examples',
] as const

export type SimplePresetId = (typeof SIMPLE_PRESET_IDS)[number]

export const SIMPLE_PRESET_LABELS: Record<SimplePresetId, string> = {
  balanced: 'Сбалансированный',
  shorter: 'Короче',
  stricter: 'Жёстче и с ограничениями',
  clearer_structure: 'Чёткая структура',
  richer_examples: 'С примерами',
}

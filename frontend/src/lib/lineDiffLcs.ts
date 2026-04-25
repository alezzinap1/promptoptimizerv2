/**
 * Построчный diff на основе LCS (без внешних зависимостей).
 * Подходит для сравнения исходного и улучшенного промпта в Simple-режиме.
 */

export type LineDiffOp = { kind: 'eq' | 'del' | 'ins'; text: string }

function lcsDiffTokens(A: string[], B: string[]): LineDiffOp[] {
  const n = A.length
  const m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const raw: LineDiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      raw.push({ kind: 'eq', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ kind: 'del', text: A[i] })
      i++
    } else {
      raw.push({ kind: 'ins', text: B[j] })
      j++
    }
  }
  while (i < n) raw.push({ kind: 'del', text: A[i++] })
  while (j < m) raw.push({ kind: 'ins', text: B[j++] })
  return mergeAdjacentSameKind(raw)
}

/** Слова и пробельные серии — чтобы diff не рвал слова пополам. */
function tokenizeForDiff(line: string): string[] {
  const m = line.match(/[^\s]+|\s+/g)
  return m ?? (line ? [line] : [])
}

function mergeAdjacentSameKind(ops: LineDiffOp[]): LineDiffOp[] {
  const out: LineDiffOp[] = []
  for (const op of ops) {
    const prev = out[out.length - 1]
    if (prev && prev.kind === op.kind) {
      prev.text += op.text
    } else {
      out.push({ kind: op.kind, text: op.text })
    }
  }
  return out
}

/**
 * Если две строки отличаются небольшим хвостом/вставкой, показываем только отличающиеся токены,
 * а не целиком красную и целиком зелёную строку.
 */
/** Порог: LCS по токенам O(n·m); выше — оставляем грубую пару строк. */
const TOKEN_DIFF_MAX_PRODUCT = 1_200_000

export function computeTokenDiffOps(oldLine: string, newLine: string): LineDiffOp[] {
  if (oldLine === newLine) return oldLine ? [{ kind: 'eq', text: oldLine }] : []
  const ta = tokenizeForDiff(oldLine)
  const tb = tokenizeForDiff(newLine)
  if (ta.length * tb.length > TOKEN_DIFF_MAX_PRODUCT) {
    return [
      { kind: 'del', text: oldLine },
      { kind: 'ins', text: newLine },
    ]
  }
  return lcsDiffTokens(ta, tb)
}

export function computeLineDiffOps(a: string, b: string): LineDiffOp[] {
  const A = a.split(/\r?\n/)
  const B = b.split(/\r?\n/)
  const n = A.length
  const m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: LineDiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: 'eq', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: A[i] })
      i++
    } else {
      out.push({ kind: 'ins', text: B[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: A[i++] })
  while (j < m) out.push({ kind: 'ins', text: B[j++] })
  return out
}

/**
 * Сначала построчный LCS, затем пары «одна удалённая / одна добавленная строка» без `\n` внутри
 * уточняются по токенам — меньше дублирования длинных абзацев в превью правок.
 */
export function computeRefinedLineDiffOps(a: string, b: string): LineDiffOp[] {
  const base = computeLineDiffOps(a, b)
  const merged: LineDiffOp[] = []
  let k = 0
  while (k < base.length) {
    const cur = base[k]!
    const nxt = base[k + 1]
    if (cur.kind === 'del' && nxt?.kind === 'ins' && !cur.text.includes('\n') && !nxt.text.includes('\n')) {
      merged.push(...computeTokenDiffOps(cur.text, nxt.text))
      k += 2
    } else {
      merged.push(cur)
      k += 1
    }
  }
  return merged
}

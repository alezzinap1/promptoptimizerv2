/**
 * Построчный diff на основе LCS (без внешних зависимостей).
 * Подходит для сравнения исходного и улучшенного промпта в Simple-режиме.
 */

export type LineDiffOp = { kind: 'eq' | 'del' | 'ins'; text: string }

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

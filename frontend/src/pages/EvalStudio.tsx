import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  evalApi,
  downloadEvalRunMarkdown,
  type EvalRunDetail,
  type EvalRunSeriesResponse,
  type EvalRunSummary,
} from '../api/eval'
import ResultsPanel from './eval/ResultsPanel'
import pageStyles from '../styles/PageShell.module.css'
import css from './eval/Stability.module.css'

export default function EvalStudio() {
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [detail, setDetail] = useState<EvalRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [seriesData, setSeriesData] = useState<EvalRunSeriesResponse | null>(null)
  const [seriesGroupByModel, setSeriesGroupByModel] = useState(false)

  const refresh = () => {
    setLoading(true)
    setErr(null)
    evalApi
      .listRuns(120)
      .then(r => setRuns(r.runs))
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  const leaderboard = useMemo(
    () =>
      [...runs]
        .filter(r => r.status === 'completed' && r.agg_overall_p50 != null)
        .sort((a, b) => (b.agg_overall_p50 ?? 0) - (a.agg_overall_p50 ?? 0))
        .slice(0, 40),
    [runs],
  )

  const openRun = async (id: number) => {
    setErr(null)
    try {
      const d = await evalApi.getRun(id)
      setDetail(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (!detail) {
      setSeriesData(null)
      return
    }
    const r = detail.run
    const params: Parameters<typeof evalApi.listRunSeries>[0] = {
      limit: 80,
      group_by_model: seriesGroupByModel,
    }
    if (r.prompt_a_library_id != null) {
      params.library_id = r.prompt_a_library_id
    } else if (r.prompt_fingerprint && r.task_fingerprint && r.rubric_fingerprint) {
      params.prompt_fingerprint = r.prompt_fingerprint
      params.task_fingerprint = r.task_fingerprint
      params.rubric_fingerprint = r.rubric_fingerprint
    } else {
      setSeriesData(null)
      return
    }
    let cancelled = false
    evalApi
      .listRunSeries(params)
      .then(res => {
        if (!cancelled) setSeriesData(res)
      })
      .catch(() => {
        if (!cancelled) setSeriesData(null)
      })
    return () => {
      cancelled = true
    }
  }, [detail, seriesGroupByModel])

  return (
    <div className={`${pageStyles.page} ${css.evalStudioPage}`}>
      <div className={pageStyles.panelHeader}>
        <div>
          <h1 className="pageTitleGradient">Eval Studio</h1>
          <p className={pageStyles.panelSubtitle}>
            История прогонов стабильности, мини-лидерборд по p50 и открытие отчёта. Запуск новых — во вкладке{' '}
            <Link to="/compare">Сравнение → Стабильность</Link>.
          </p>
        </div>
        <button type="button" className={css.btnGhost} onClick={refresh} disabled={loading}>
          Обновить
        </button>
      </div>

      {err && <div className={css.errorBox}>{err}</div>}

      <div className={css.evalStudioGrid}>
        <section className={pageStyles.panel}>
          <h2 className={`${pageStyles.panelTitle} ${css.evalStudioH2}`}>Лидерборд (completed, по p50)</h2>
          <p className={css.muted} style={{ fontSize: 12, marginBottom: 8 }}>
            MVP-3-lite: сортировка последних завершённых прогонов по медианной оценке первого судьи.
          </p>
          {loading ? (
            <p className={css.muted}>Загрузка…</p>
          ) : leaderboard.length === 0 ? (
            <p className={css.muted}>Пока нет завершённых прогонов.</p>
          ) : (
            <div className={css.leaderTable}>
              <div className={`${css.leaderRow} ${css.leaderHead}`}>
                <span>#</span>
                <span>p50</span>
                <span>div</span>
                <span>дата</span>
                <span />
              </div>
              {leaderboard.map(r => (
                <div key={r.id} className={css.leaderRow}>
                  <span>{r.id}</span>
                  <span>{r.agg_overall_p50?.toFixed(2) ?? '—'}</span>
                  <span>{r.diversity_score != null ? r.diversity_score.toFixed(2) : '—'}</span>
                  <span className={css.muted} style={{ fontSize: 11 }}>
                    {(r.created_at || '').slice(0, 16)}
                  </span>
                  <span>
                    <button type="button" className={css.btnGhost} onClick={() => openRun(r.id)}>
                      Открыть
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={pageStyles.panel}>
          <h2 className={`${pageStyles.panelTitle} ${css.evalStudioH2}`}>Все прогоны</h2>
          <div className={css.runListCompact}>
            {runs.slice(0, 50).map(r => (
              <button
                key={r.id}
                type="button"
                className={css.runListBtn}
                onClick={() => openRun(r.id)}
              >
                <span className={css.runListId}>#{r.id}</span>
                <span className={css.pill}>{r.status}</span>
                <span className={css.muted} style={{ fontSize: 11 }}>
                  {r.mode} · n={r.n_runs}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {detail && (
        <section className={pageStyles.panel}>
          <div className={css.evalStudioDetailHead}>
            <h2 className={`${pageStyles.panelTitle} ${css.evalStudioH2}`}>Прогон #{detail.run.id}</h2>
            <button type="button" className={css.btnGhost} onClick={() => downloadEvalRunMarkdown(detail)}>
              Скачать .md
            </button>
          </div>

          {seriesData && seriesData.runs.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <div className={css.synthesisSub}>Серия сравнимых прогонов (та же задача, промпт и рубрика)</div>
              <label className={css.inlineCheck} style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={seriesGroupByModel}
                  onChange={e => setSeriesGroupByModel(e.target.checked)}
                />
                <span>Группировать по целевой модели (C2)</span>
              </label>
              {!seriesGroupByModel ? (
                <table className={css.seriesTable}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Модель</th>
                      <th>p50</th>
                      <th>div</th>
                      <th>когда</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {seriesData.runs.map((sr: EvalRunSummary) => (
                      <tr
                        key={sr.id}
                        className={sr.id === detail.run.id ? css.seriesRowActive : undefined}
                      >
                        <td>{sr.id}</td>
                        <td className={css.muted} style={{ fontSize: 11, maxWidth: 180 }} title={sr.target_model_id}>
                          {sr.target_model_id.replace(/^[^/]+\//, '')}
                        </td>
                        <td>{sr.agg_overall_p50?.toFixed(2) ?? '—'}</td>
                        <td>{sr.diversity_score != null ? sr.diversity_score.toFixed(2) : '—'}</td>
                        <td className={css.muted} style={{ fontSize: 11 }}>
                          {(sr.created_at || '').slice(0, 16)}
                        </td>
                        <td>
                          {sr.id !== detail.run.id && (
                            <button type="button" className={css.btnGhost} onClick={() => openRun(sr.id)}>
                              Открыть
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                seriesData.group_by_model &&
                Object.entries(seriesData.group_by_model).map(([model, grp]) => (
                  <div key={model} style={{ marginTop: 12 }}>
                    <div className={css.muted} style={{ fontSize: 12, fontWeight: 600 }}>
                      {model}
                    </div>
                    <table className={css.seriesTable}>
                      <tbody>
                        {(grp as EvalRunSummary[]).map(sr => (
                          <tr key={sr.id} className={sr.id === detail.run.id ? css.seriesRowActive : undefined}>
                            <td>#{sr.id}</td>
                            <td>{sr.agg_overall_p50?.toFixed(2) ?? '—'}</td>
                            <td className={css.muted} style={{ fontSize: 11 }}>
                              {(sr.created_at || '').slice(0, 16)}
                            </td>
                            <td>
                              {sr.id !== detail.run.id && (
                                <button type="button" className={css.btnGhost} onClick={() => openRun(sr.id)}>
                                  Открыть
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}

          <ResultsPanel detail={detail} />
        </section>
      )}
    </div>
  )
}

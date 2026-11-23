import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { rows, type DatasetInfo } from '../api/types'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { fmtCompact, fmtDate, fmtDelta, fmtMoney, fmtMonth, fmtPct, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { sceneStore, useScene } from '../scene/store'

const NAMES = ['kpis', 'kpi_comparison', 'monthly_revenue', 'insights'] as const

async function loadOverview(signal: AbortSignal) {
  const dataset: DatasetInfo = await api.dataset(signal)
  if (!dataset.has_data) return { dataset, data: null }
  const data = await api.batch(NAMES, {}, signal)
  return { dataset, data }
}

type Loaded = Awaited<ReturnType<typeof loadOverview>>

const LEDGER = [
  { key: 'net_revenue', label: 'Net revenue', fmt: fmtCompact, note: 'Currency not specified' },
  { key: 'active_customers', label: 'Active customers', fmt: fmtWhole },
  { key: 'orders', label: 'Orders', fmt: fmtWhole },
  { key: 'avg_order_value', label: 'Average order', fmt: fmtMoney },
  { key: 'repeat_rate_pct', label: 'Repeat rate', fmt: (v: number) => fmtPct(v) },
] as const

export default function Overview() {
  return (
    <div className="overview">
      <header className="page-head">
        <p className="eyebrow">01 — Executive Overview</p>
        <h1 className="display">
          The shape of <em>your customer base</em>
        </h1>
      </header>
      <SessionGate>
        <OverviewData />
      </SessionGate>
    </div>
  )
}

function OverviewData() {
  const [result, reload] = useAsync(loadOverview, [])

  useEffect(() => {
    if (result.state !== 'done' || !result.data.data) return
    const months = rows<{ month: string; net_revenue: number }>(result.data.data.monthly_revenue).map((r) => ({
      month: String(r.month),
      net: Number(r.net_revenue) || 0,
    }))
    sceneStore.set({ months })
  }, [result])

  if (result.state === 'loading') return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  return <OverviewBody loaded={result.data} />
}

function OverviewBody({ loaded }: { loaded: Loaded }) {
  const { dataset, data } = loaded
  if (!data) {
    return (
      <Notice title="No dataset is loaded yet">
        <p>Load the demo dataset or import your own file, then come back to this view.</p>
        <Link className="btn" to="/data">Data Management</Link>
      </Notice>
    )
  }
  const deltas = new Map(
    rows<{ metric: string; change_pct: number | null }>(data.kpi_comparison.table).map((r) => [r.metric, r.change_pct]),
  )
  const [start, end] = dataset.bounds
  const insights = data.insights.slice(0, 3)

  return (
    <>
      <p className="lede">
        {fmtDate(start)} — {fmtDate(end)} · {fmtWhole(data.kpis.active_customers)} active customers ·{' '}
        {fmtWhole(data.kpis.new_customers)} new in the period
      </p>

      <dl className="ledger">
        {LEDGER.map(({ key, label, fmt, ...rest }) => {
          const delta = data.kpi_comparison.previous_has_data ? deltas.get(key) : null
          return (
            <div className="ledger__item" key={key}>
              <dt>{label}</dt>
              <dd className="ledger__value">{fmt(data.kpis[key])}</dd>
              <dd className={`ledger__delta${delta == null ? '' : delta >= 0 ? ' is-up' : ' is-down'}`}>
                {fmtDelta(delta)}
              </dd>
              {'note' in rest && <dd className="ledger__note">{rest.note}</dd>}
            </div>
          )
        })}
      </dl>

      <OrbitReadout />

      <section className="insights" aria-labelledby="insights-h">
        <h2 id="insights-h" className="section-title">What needs attention</h2>
        {insights.length === 0 ? (
          <p className="muted">No insight rules fired for this period.</p>
        ) : (
          <ol className="insights__list">
            {insights.map((ins, i) => (
              <li key={ins.key} className={`insight is-${ins.kind}`}>
                <span className="insight__num">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p className="insight__meta">
                    {ins.category} · {ins.kind}
                  </p>
                  <h3 className="insight__title">{ins.title}</h3>
                  <p className="insight__obs">{ins.observation}</p>
                  <p className="insight__action">
                    <span>Action</span> {ins.action}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

/** HTML readout for the 3D revenue orbit (hover a bar in the scene). */
function OrbitReadout() {
  const months = useScene((s) => s.months)
  const hovered = useScene((s) => s.hovered)
  const mode = useScene((s) => s.mode)
  if (!months.length) return null
  const idx = hovered ?? months.length - 1
  const m = months[idx]
  return (
    <aside className="orbit-readout" aria-live="polite">
      <p className="orbit-readout__label">
        Revenue orbit · {months.length} months{mode === 'webgl' ? ' · hover a bar' : ''}
      </p>
      <p className="orbit-readout__value">
        <span>{fmtMonth(m.month)}</span> {fmtCompact(m.net)}
        {hovered == null && <small> latest</small>}
      </p>
    </aside>
  )
}

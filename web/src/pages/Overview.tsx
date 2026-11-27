import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { rows, type AnalyticsMap, type Insight } from '../api/types'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { BarList, DatasetGate, DataTable, Details, FilterBar, Section, SignalLegend, Signals, StandardOnly, ThreeDOnly } from '../components/ui'
import { ProductIntro } from '../components/Tour'
import { CategoryChart, Donut, Info, Panel, shortMonth } from '../components/charts'
import { SERIES } from '../lib/palette'
import { useIsStandard } from '../lib/viewMode'
import { useDataset } from '../lib/dataset'
import { segmentColor } from '../lib/domain'
import { currencyCaption, fmtCompact, fmtDate, fmtDelta, fmtMoney, fmtMoneyCompact, fmtMonth, fmtPct, fmtWhole } from '../lib/format'
import { useAsync, type AsyncState } from '../lib/hooks'
import { sceneStore, useScene } from '../scene/store'

const NAMES = ['kpi_comparison', 'monthly_revenue', 'segment_summary', 'monthly_acquisition'] as const
type Loaded = Pick<AnalyticsMap, (typeof NAMES)[number]>

/** Same wording as KPI_HELP in src/ui/pages/overview.py. */
const KPI_HELP: Record<string, string> = {
  net_revenue: 'Gross sales minus the value of returned items, for transactions in the selected period.',
  orders: 'Number of distinct sales invoices. Return invoices are not counted as orders.',
  active_customers: 'Customers with at least one sales order in the period.',
  avg_order_value: 'Gross sales divided by the number of orders (returns excluded).',
  new_customers: "Customers whose first-ever purchase falls within the period.",
  repeat_rate_pct: 'Share of active customers who placed two or more orders within the period.',
  revenue_per_customer: 'Net revenue divided by active customers.',
  return_rate_pct: 'Value of returns as a share of gross sales.',
}

interface Kpi {
  key: string
  label: string
  fmt: (v: number) => string
  /** a rise is bad news (return rate) */
  inverse?: boolean
}
const HEADLINE: Kpi[] = [
  { key: 'net_revenue', label: 'Revenue after returns', fmt: fmtMoneyCompact },
  { key: 'active_customers', label: 'Customers who bought', fmt: fmtWhole },
  { key: 'new_customers', label: 'New customers', fmt: fmtWhole },
  { key: 'repeat_rate_pct', label: 'Came back to buy again', fmt: (v) => fmtPct(v) },
]
const MORE: Kpi[] = [
  { key: 'orders', label: 'Orders', fmt: fmtWhole },
  { key: 'avg_order_value', label: 'Average order value', fmt: fmtMoney },
  { key: 'revenue_per_customer', label: 'Revenue per customer', fmt: fmtMoney },
  { key: 'return_rate_pct', label: 'Return rate', fmt: (v) => fmtPct(v), inverse: true },
]

interface CompRow {
  metric: string
  current: number
  previous: number | null
  change_pct: number | null
}

export default function Overview() {
  return (
    <div className="overview">
      <header className="page-head">
        <p className="eyebrow">Executive Overview</p>
        <h1 className="display">
          The shape of your customer base
        </h1>
      </header>
      <ProductIntro />
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <OverviewData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function OverviewData() {
  const { filters, key, currency } = useDataset()
  const [result, reload] = useAsync((signal) => api.batch(NAMES, filters, signal), [key])
  const [insights, retryInsights] = useAsync((signal) => api.analytics('insights', filters, signal, currency ? { currency } : {}), [key, currency])

  useEffect(() => {
    if (result.state !== 'done') return
    const months = rows<{ month: string; net_revenue: number; active_customers: number }>(result.data.monthly_revenue).map((r) => ({
      month: String(r.month),
      net: Number(r.net_revenue) || 0,
      customers: Number(r.active_customers) || 0,
    }))
    sceneStore.set({ months })
  }, [result])

  if (result.state === 'loading') return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  return <OverviewBody data={result.data} insights={insights} retryInsights={retryInsights} />
}

function OverviewBody({ data, insights, retryInsights }: { data: Loaded; insights: AsyncState<Insight[]>; retryInsights: () => void }) {
  const comp = new Map(rows<CompRow>(data.kpi_comparison.table).map((r) => [r.metric, r]))
  const hasPrev = data.kpi_comparison.previous_has_data
  const [p0, p1] = (data.kpi_comparison.previous_period as [string, string] | null) ?? [null, null]
  const rev = comp.get('net_revenue')
  const cust = comp.get('active_customers')

  if (!comp.get('orders')?.current) {
    return (
      <Notice title="No sales in this selection">
        <p>No sales fall inside the selected period and segments. Widen the period or clear the segment filter.</p>
        <Link className="btn btn--solid" to="/data">Data Management</Link>
      </Notice>
    )
  }

  const change = rev?.change_pct
  const seg = rows<{ segment: string; customers: number; customer_share_pct: number; revenue_share_pct: number }>(data.segment_summary)
  const acq = rows<{ month: string; new_customers: number; returning_customers: number }>(data.monthly_acquisition)
  const months = rows<{ month: string; net_revenue: number; active_customers: number; orders: number }>(data.monthly_revenue)

  return (
    <>
      <p className="lede">
        <strong>{fmtMoney(rev?.current)}</strong> in revenue after returns{currencyCaption() === 'Currency not specified' ? ' (currency not specified)' : ''}, from{' '}
        <strong>{fmtWhole(cust?.current)}</strong> customers
        {hasPrev && change != null && Number.isFinite(change) ? (
          <>
            , {change >= 0 ? 'up' : 'down'} <strong>{Math.abs(change).toFixed(0)}%</strong> on the previous period of the same length
          </>
        ) : null}
        .
      </p>

      <KpiLedger items={[...HEADLINE, ...MORE]} comp={comp} hasPrev={hasPrev} />
      <p className="muted small">
        {hasPrev
          ? `Compared with ${fmtDate(p0)} – ${fmtDate(p1)}.`
          : `No sales in the prior period (${fmtDate(p0)} – ${fmtDate(p1)}).`}
      </p>

      <ThreeDOnly>
        <OrbitReadout />
      </ThreeDOnly>

      <StandardOnly>
        <div className="grid">
          <Panel span={2} title="Net revenue by month" note="Revenue after returns for each calendar month in the period.">
            <CategoryChart
              caption="Net revenue by month"
              categories={months.map((m) => shortMonth(m.month))}
              titles={months.map((m) => fmtMonth(m.month))}
              series={[{ key: 'net', label: 'Net revenue', color: SERIES[0], type: 'bar' }]}
              values={{ net: months.map((m) => m.net_revenue) }}
              format={(v) => fmtMoney(v)}
              axisFormat={fmtMoneyCompact}
              height={540}
            />
          </Panel>
          <Panel title="Customer segment share" note="Share of net revenue by RFM segment, with each segment’s share of customers." aside={<Link className="linkish" to="/segments">Segments →</Link>}>
            <Donut
              caption="Share of net revenue by segment"
              centerLabel="of revenue, by segment"
              size={170}
              format={(v) => fmtPct(v)}
              items={seg.map((s) => ({
                key: s.segment,
                label: s.segment,
                value: s.revenue_share_pct,
                color: segmentColor(s.segment),
                note: `${fmtPct(s.customer_share_pct)} of customers`,
              }))}
            />
          </Panel>
        </div>
        <div className="grid grid--2">
          <Panel title="Active customers by month" note="Customers with at least one sales order in the month.">
            <CategoryChart
              caption="Active customers by month"
              categories={months.map((m) => shortMonth(m.month))}
              titles={months.map((m) => fmtMonth(m.month))}
              series={[{ key: 'ac', label: 'Active customers', color: SERIES[3], type: 'area' }]}
              values={{ ac: months.map((m) => m.active_customers) }}
              format={(v) => fmtWhole(v)}
              axisFormat={fmtCompact}
              endLabel
              height={240}
            />
          </Panel>
          <Panel title="New vs returning customers" note="A healthy base keeps the returning share steady or growing, not only new customers.">
            <CategoryChart
              caption="New and returning customers by month"
              categories={acq.map((m) => shortMonth(m.month))}
              titles={acq.map((m) => fmtMonth(m.month))}
              series={[
                { key: 'ret', label: 'Returning', color: SERIES[0], type: 'bar', stack: 'c' },
                { key: 'new', label: 'New', color: SERIES[1], type: 'bar', stack: 'c' },
              ]}
              values={{ ret: acq.map((m) => m.returning_customers), new: acq.map((m) => m.new_customers) }}
              format={(v) => fmtWhole(v)}
              axisFormat={fmtCompact}
              height={240}
            />
          </Panel>
        </div>
        <Details summary="Monthly figures as a table">
          <DataTable
            caption="Monthly revenue and customers"
            rows={months.map((m) => ({ ...m, ...(acq.find((a) => a.month === m.month) ?? { new_customers: null, returning_customers: null }) }))}
            rowKey={(r) => r.month}
            maxHeight={320}
            columns={[
              { key: 'm', label: 'Month', render: (r) => fmtMonth(r.month) },
              { key: 'n', label: 'Net revenue', render: (r) => fmtMoney(r.net_revenue), numeric: true },
              { key: 'o', label: 'Orders', render: (r) => fmtWhole(r.orders), numeric: true },
              { key: 'a', label: 'Active', render: (r) => fmtWhole(r.active_customers), numeric: true },
              { key: 'r', label: 'Returning', render: (r) => fmtWhole(r.returning_customers), numeric: true },
              { key: 'nc', label: 'New', render: (r) => fmtWhole(r.new_customers), numeric: true },
            ]}
          />
        </Details>
      </StandardOnly>

      <Insights result={insights} onRetry={retryInsights} />

      <ThreeDOnly>
        {seg.length > 0 && (
          <Section title="Customer groups: share of customers vs revenue">
            <BarList
              max={100}
              caption="Share of revenue"
              items={seg.map((s) => ({
                key: s.segment,
                label: s.segment,
                value: s.revenue_share_pct,
                display: fmtPct(s.revenue_share_pct),
                color: segmentColor(s.segment),
                note: `${fmtPct(s.customer_share_pct)} of customers · ${fmtWhole(s.customers)} people`,
              }))}
            />
            <p className="small"><Link to="/segments">Explore the segments →</Link></p>
          </Section>
        )}

        {acq.length > 0 && (
          <Section title="New vs returning customers by month">
            <DataTable
              caption="New and returning customers by month"
              rows={acq}
              rowKey={(r) => r.month}
              maxHeight={300}
              columns={[
                { key: 'm', label: 'Month', render: (r) => fmtMonth(r.month) },
                { key: 'r', label: 'Returning', render: (r) => fmtWhole(r.returning_customers), numeric: true },
                { key: 'n', label: 'New', render: (r) => fmtWhole(r.new_customers), numeric: true },
              ]}
            />
          </Section>
        )}
      </ThreeDOnly>
    </>
  )
}

function Insights({ result, onRetry }: { result: AsyncState<Insight[]>; onRetry: () => void }) {
  const standard = useIsStandard()
  // A failed request (e.g. the client timeout on a very large dataset) must not leave the spinner up for good.
  if (result.state === 'error') {
    return (
      <section className="insights" aria-labelledby="insights-h">
        <h2 id="insights-h" className="section-title">Key signals</h2>
        <ErrorPanel error={result.error} onRetry={onRetry} />
      </section>
    )
  }
  const insights = result.state === 'done' ? result.data : null
  return (
    <section className="insights" aria-labelledby="insights-h">
      <h2 id="insights-h" className="section-title">
        Key signals
        <Info text="Automatic checks on this period's sales. Each line says what is happening, why it matters to the business, and the figures behind it. The i on each line gives the detail and a suggested next step." />
      </h2>
      {insights == null ? (
        <Loading label="Reading findings" />
      ) : insights.length === 0 ? (
        <p className="muted">Not enough data for signals in this selection.</p>
      ) : (
        <>
          <SignalLegend />
          <Signals items={insights.slice(0, standard ? 5 : 3)} />
          {insights.length > (standard ? 5 : 3) && <p className="small"><Link to="/reports">All {insights.length} findings →</Link></p>}
        </>
      )}
    </section>
  )
}

function KpiLedger({ items, comp, hasPrev }: { items: Kpi[]; comp: Map<string, CompRow>; hasPrev: boolean }) {
  return (
    <dl className="ledger">
      {items.map(({ key, label, fmt, inverse }) => {
        const row = comp.get(key)
        const delta = hasPrev ? row?.change_pct ?? null : null
        const good = delta == null ? '' : (delta >= 0) !== !!inverse ? ' is-up' : ' is-down'
        return (
          <div className="ledger__item" key={key} title={KPI_HELP[key]}>
            <dt>{label}</dt>
            <dd className="ledger__value">{row ? fmt(row.current) : '—'}</dd>
            <dd className={`ledger__delta${good}`}>{hasPrev ? fmtDelta(delta) : 'no prior period'}</dd>
            {key === 'net_revenue' && <dd className="ledger__note">{currencyCaption()}</dd>}
          </div>
        )
      })}
    </dl>
  )
}

/** HTML readout for the 3D revenue orbit (hover a bar in the scene). */
function OrbitReadout() {
  const months = useScene((s) => s.months)
  const hovered = useScene((s) => s.hovered)
  const mode = useScene((s) => s.mode)
  if (!months.length) return null
  const idx = hovered != null && hovered < months.length ? hovered : months.length - 1
  const m = months[idx]
  return (
    <aside className="orbit-readout" aria-live="polite">
      <p className="orbit-readout__label">
        Revenue orbit · {months.length} months{mode === 'webgl' ? ' · hover a bar' : ''}
      </p>
      <p className="orbit-readout__value">
        <span>{fmtMonth(m.month)}</span> {fmtMoneyCompact(m.net)}
        <small> · {fmtWhole(m.customers)} customers{hovered == null ? ' · latest' : ''}</small>
      </p>
    </aside>
  )
}

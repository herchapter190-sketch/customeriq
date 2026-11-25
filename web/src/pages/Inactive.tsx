import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { rows, type AnalyticsMap, type RiskRules } from '../api/types'
import type { Column } from '../components/ui'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { RiskEditor } from '../components/RuleEditors'
import { BarList, CsvButton, DatasetGate, DataTable, FilterBar, PageHead, Pills, SceneHint, SearchBox, searchRows, Section, StandardOnly, StdGrid } from '../components/ui'
import { Panel, StackRows } from '../components/charts'
import { Histogram } from '../components/Histogram'
import { useDataset } from '../lib/dataset'
import { RISK_COLORS, RISK_ZONES, segmentColor } from '../lib/domain'
import { fmtDate, fmtMoney, fmtMoneyCompact, fmtPct, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useIsStandard } from '../lib/viewMode'
import { setDistrict, setFocus, setHover, setPick, useDistrict, useFocus, useHover, usePick, useScene } from '../scene/store'
import { CustomerOrders } from './shared'

const NAMES = ['inactive_customers', 'risk_summary', 'risk_by_segment', 'priority_win_back'] as const
type Loaded = Pick<AnalyticsMap, (typeof NAMES)[number]>
const SCENE_CAP = 4000

interface InactiveRow {
  customer_id: string
  country: string
  segment: string
  first_purchase?: string
  last_purchase: string
  days_inactive: number
  orders: number
  historical_revenue: number
  avg_days_between_orders: number | null
  risk_category: string
  is_overdue: number
  value_tier: string
}

export default function Inactive() {
  return (
    <div className="env env--inactive">
      <PageHead slug="inactive" lede="Cooling and at-risk customers, ranked for win-back.">
        Customers drifting away
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <InactiveData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function InactiveData() {
  const { filters, key, rules: active } = useDataset()
  const [result, reload] = useAsync((signal) => api.batch(NAMES, filters, signal), [key])
  // The zones drawn in 3D and printed below are the rules the API just applied.
  const rules = filters.risk ?? active.risk
  const customers = useMemo(() => (result.state === 'done' ? rows<InactiveRow>(result.data.inactive_customers) : []), [result])

  useEffect(() => {
    if (!rules || result.state !== 'done') return
    const shown = customers.length > SCENE_CAP ? [...customers].sort((a, b) => b.historical_revenue - a.historical_revenue).slice(0, SCENE_CAP) : customers
    setDistrict('inactive', {
      customers: shown.map((c) => ({
        id: String(c.customer_id),
        segment: c.segment,
        days: c.days_inactive,
        revenue: c.historical_revenue,
        risk: c.risk_category,
        overdue: !!c.is_overdue,
        tier: c.value_tier,
      })),
      rules,
      total: customers.length,
    })
  }, [customers, rules, result.state])
  useEffect(() => () => (setFocus('inactive', null), setPick('inactive', null), setHover('inactive', null)), [])

  if (result.state === 'loading' || !rules) return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  if (!customers.length) {
    return (
      <Notice title="No customers in this selection">
        <p>No customer has purchases up to the selected end date with these filters.</p>
      </Notice>
    )
  }
  return <InactiveBody data={result.data} customers={customers} rules={rules} />
}

function InactiveBody({ data, customers, rules }: { data: Loaded; customers: InactiveRow[]; rules: RiskRules }) {
  const focus = useFocus('inactive') as string | null
  const pick = usePick('inactive') as string | null
  const summary = rows<{ risk_category: string; customers: number; historical_revenue: number; avg_days_inactive: number; overdue_customers: number; high_value_customers: number; customer_share_pct: number; revenue_share_pct: number }>(data.risk_summary)
  const bySeg = rows<{ segment: string; risk_category: string; customers: number; historical_revenue: number }>(data.risk_by_segment)
  const winBack = rows<InactiveRow>(data.priority_win_back)
  const columns = [
    { key: 'id', label: 'Customer', render: (r: InactiveRow) => r.customer_id },
    {
      key: 'seg',
      label: 'Segment',
      render: (r: InactiveRow) => (
        <span className="bars__label">
          <span className="seg-dot" style={{ background: segmentColor(r.segment) }} aria-hidden="true" />
          {r.segment}
        </span>
      ),
    },
    { key: 'risk', label: 'Zone', render: (r: InactiveRow) => r.risk_category },
    { key: 'd', label: 'Days inactive', render: (r: InactiveRow) => fmtWhole(r.days_inactive), numeric: true },
    { key: 'last', label: 'Last order', render: (r: InactiveRow) => fmtDate(r.last_purchase) },
    { key: 'rev', label: 'Revenue', render: (r: InactiveRow) => fmtMoney(r.historical_revenue), numeric: true },
    { key: 'gap', label: 'Avg gap (days)', render: (r: InactiveRow) => fmtWhole(r.avg_days_between_orders), numeric: true },
    { key: 'tier', label: 'Value tier', render: (r: InactiveRow) => r.value_tier },
    { key: 'od', label: 'Overdue', render: (r: InactiveRow) => (r.is_overdue ? 'Yes' : '') },
  ]
  const select = (r: InactiveRow) => (setPick('inactive', String(r.customer_id)), setFocus('inactive', r.risk_category))

  const zones = RISK_ZONES.map((z) => summary.find((s) => s.risk_category === z)).filter((z): z is NonNullable<typeof z> => !!z)
  const segNames = [...new Set(bySeg.map((r) => r.segment))]
  return (
    <>
      <StandardOnly>
        <dl className="ledger">
          {zones.map((z) => (
            <div className="ledger__item" key={z.risk_category}>
              <dt>
                <span className="seg-dot" style={{ background: RISK_COLORS[z.risk_category], marginRight: 7 }} aria-hidden="true" />
                {z.risk_category}
              </dt>
              <dd className="ledger__value">{fmtWhole(z.customers)}</dd>
              <dd className="ledger__delta">
                {fmtPct(z.customer_share_pct)} of customers · {fmtMoneyCompact(z.historical_revenue)} lifetime revenue
              </dd>
            </div>
          ))}
        </dl>
      </StandardOnly>
      <SceneHint>Distance = days since last order · brighter = higher value · rose ring = overdue. Click (or tap twice) to open.</SceneHint>
      <HoverReadout />
      <RiskEditor />
      <p className="muted small" title="Transparent rules, not a churn prediction. Overdue = a repeat customer inactive for longer than this multiple of their usual gap.">
        Active ≤ {rules.active_days} d · Cooling ≤ {rules.cooling_days} · At Risk ≤ {rules.at_risk_days} · Lapsed beyond · Overdue &gt; {rules.overdue_multiplier}× usual gap
      </p>

      <StdGrid>
      <Section title="Zones" aside={focus && <button type="button" className="linkish" onClick={() => (setFocus('inactive', null), setPick('inactive', null))}>Show all</button>}>
        <BarList
          max={100}
          selected={focus}
          onSelect={(k) => (setFocus('inactive', focus === k ? null : k), setPick('inactive', null))}
          items={RISK_ZONES.map((z) => summary.find((s) => s.risk_category === z)).filter(Boolean).map((s) => ({
            key: s!.risk_category,
            label: s!.risk_category,
            value: s!.customer_share_pct,
            display: `${fmtWhole(s!.customers)} · ${fmtPct(s!.customer_share_pct)}`,
            color: RISK_COLORS[s!.risk_category],
            note: `${fmtMoneyCompact(s!.historical_revenue)} lifetime revenue (${fmtPct(s!.revenue_share_pct)}) · avg ${fmtWhole(s!.avg_days_inactive)} days inactive · ${fmtWhole(s!.overdue_customers)} overdue · ${fmtWhole(s!.high_value_customers)} high value`,
          }))}
        />
      </Section>

      <StandardOnly>
        <Panel title="Risk by segment" note="Customers in each segment, split by inactivity zone. Hover a bar part for its count.">
          <StackRows
            caption="Customers by segment and inactivity zone"
            parts={RISK_ZONES.map((z) => ({ key: z, label: z, color: RISK_COLORS[z] }))}
            format={(v) => fmtWhole(v)}
            rows={segNames.map((seg) => ({
              key: seg,
              label: seg,
              values: Object.fromEntries(bySeg.filter((r) => r.segment === seg).map((r) => [r.risk_category, r.customers])),
            }))}
          />
        </Panel>
      </StandardOnly>
      </StdGrid>

      <Section title="Priority win-back list">
        <DataTable caption="Priority win-back customers" rows={winBack} rowKey={(r) => `w-${r.customer_id}`} columns={columns} onRow={select} selected={pick ? `w-${pick}` : null} />
      </Section>

      {pick && (
        <Section title={`Customer ${pick}`} aside={<button type="button" className="linkish" onClick={() => setPick('inactive', null)}>Close</button>}>
          <CustomerOrders customerId={pick} />
        </Section>
      )}

      <Section title="Days since last purchase">
        <Histogram
          values={customers.map((c) => ({ x: c.days_inactive, group: c.risk_category }))}
          groups={RISK_ZONES.map((z) => ({ key: z, color: RISK_COLORS[z] }))}
          bin={15}
          xLabel="Days inactive (15-day bins)"
          yLabel="Customers"
        />
      </Section>

      <InactivityTable customers={customers} columns={columns} onRow={select} pick={pick} focus={focus} />

      <Section title="Lifetime revenue by segment and zone">
        <DataTable
          caption="Revenue by segment and risk zone"
          rows={bySeg}
          rowKey={(r) => `${r.segment}-${r.risk_category}`}
          columns={[
            { key: 's', label: 'Segment', render: (r) => r.segment },
            { key: 'z', label: 'Zone', render: (r) => r.risk_category },
            { key: 'c', label: 'Customers', render: (r) => fmtWhole(r.customers), numeric: true },
            { key: 'r', label: 'Revenue', render: (r) => fmtMoney(r.historical_revenue), numeric: true },
          ]}
        />
      </Section>
    </>
  )
}

function HoverReadout() {
  const data = useDistrict('inactive')
  const hover = useHover('inactive')
  const mode = useScene((s) => s.mode)
  const standard = useIsStandard()
  if (mode === '2d' || standard) return null
  const c = typeof hover === 'number' ? data?.customers[hover] : undefined
  return (
    <aside className="readout" aria-live="polite">
      {c ? (
        <>
          <p className="readout__label">
            <span className="seg-dot" style={{ background: RISK_COLORS[c.risk] }} aria-hidden="true" /> {c.risk} · {c.segment}
          </p>
          <p className="readout__value">
            Customer {c.id}
            <span>
              {fmtWhole(c.days)} days since last order · {fmtMoney(c.revenue)} lifetime · {c.tier} value{c.overdue ? ' · overdue' : ''}
            </span>
          </p>
        </>
      ) : (
        <p className="readout__label">
          {data && data.total > data.customers.length
            ? `Scene shows the ${fmtWhole(data.customers.length)} highest-value of ${fmtWhole(data.total)} customers`
            : 'Hover a customer to read them here'}
        </p>
      )}
    </aside>
  )
}

const TIERS = ['High', 'Medium', 'Low'] as const
const TABLE_CAP = 500

/** Streamlit "Customer inactivity table": search, zone (default At Risk + Lapsed), value tier, overdue only. */
function InactivityTable({ customers, columns, onRow, pick, focus }: {
  customers: InactiveRow[]
  columns: Column<InactiveRow>[]
  onRow: (r: InactiveRow) => void
  pick: string | null
  focus: string | null
}) {
  const [q, setQ] = useState('')
  const [cats, setCats] = useState<string[]>(['At Risk', 'Lapsed'])
  const [tiers, setTiers] = useState<string[]>([])
  const [overdue, setOverdue] = useState(false)
  // A zone picked in the scene or the zone bars narrows the table to it.
  useEffect(() => {
    if (focus) setCats([focus])
  }, [focus])
  const view = useMemo(() => {
    let v = searchRows(customers, q, ['customer_id', 'country', 'segment'])
    if (cats.length) v = v.filter((c) => cats.includes(c.risk_category))
    if (tiers.length) v = v.filter((c) => tiers.includes(c.value_tier))
    if (overdue) v = v.filter((c) => c.is_overdue === 1)
    return v
  }, [customers, q, cats, tiers, overdue])
  const revenue = view.reduce((t, c) => t + (c.historical_revenue || 0), 0)
  return (
    <Section title="Customer inactivity table" aside={<CsvButton rows={view} name="customeriq_inactive_customers.csv" />}>
      <div className="toolbar">
        <SearchBox label="Search" value={q} onChange={setQ} placeholder="Customer ID, country or segment" />
        <Pills label="Risk category" options={RISK_ZONES} value={cats} onChange={setCats} />
        <Pills label="Value tier" options={TIERS} value={tiers} onChange={setTiers} />
        <label className="check" title="Inactive for longer than the overdue multiplier × their own average gap.">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only
        </label>
      </div>
      <p className="muted small">
        {fmtWhole(view.length)} customers · {fmtMoney(revenue)} historical net revenue
        {view.length > TABLE_CAP ? ` · the first ${fmtWhole(TABLE_CAP)} are listed (the CSV holds all)` : ''}
      </p>
      <DataTable caption="Customer inactivity" rows={view.slice(0, TABLE_CAP)} rowKey={(r) => String(r.customer_id)} columns={columns} onRow={onRow} selected={pick} maxHeight={420} />
    </Section>
  )
}

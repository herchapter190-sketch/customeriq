import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { rows } from '../api/types'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { RfmEditor } from '../components/RuleEditors'
import { BarList, CsvButton, DatasetGate, DataTable, Details, FilterBar, Figures, PageHead, Pills, SceneHint, SearchBox, searchRows, Section, Takeaway } from '../components/ui'
import { useDataset } from '../lib/dataset'
import { segmentColor, SEGMENTS } from '../lib/domain'
import { fmtDate, fmtMoney, fmtMoneyCompact, fmtPct, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { setDistrict, setFocus, setPick, useDistrict, useFocus, useHover, usePick, useScene } from '../scene/store'
import { CustomerOrders } from './shared'

interface SegRow {
  segment: string
  customers: number
  customer_share_pct: number
  net_revenue: number
  revenue_share_pct: number
  avg_recency_days: number
  avg_frequency: number
  avg_monetary: number
  avg_order_value: number
}
interface RfmRow {
  customer_id: string
  country: string
  segment: string
  rfm_code: string
  r_score: number
  f_score: number
  m_score: number
  fm_score: number
  last_purchase: string
  recency_days: number
  frequency: number
  monetary: number
}
interface GridRow {
  r_score: number
  f_score: number
  customers: number
  net_revenue: number
}

/** The 3D scene draws at most this many customers (highest spend first); the page says so. */
const SCENE_CAP = 4000

export default function Segments() {
  return (
    <div className="env env--segments">
      <PageHead slug="segments" lede="RFM segments, what each is worth, and the customers inside them.">
        Customers, grouped by how they buy
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <SegmentsData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function SegmentsData() {
  const { filters, key } = useDataset()
  const [result, reload] = useAsync((signal) => api.batch(['segment_summary', 'rfm_customers', 'rfm_grid'], filters, signal), [key])

  const parsed = useMemo(() => {
    if (result.state !== 'done') return null
    return {
      summary: rows<SegRow>(result.data.segment_summary),
      customers: rows<RfmRow>(result.data.rfm_customers),
      grid: rows<GridRow>(result.data.rfm_grid),
    }
  }, [result])

  useEffect(() => {
    if (!parsed) return
    const ranked = parsed.customers.length > SCENE_CAP
      ? [...parsed.customers].sort((a, b) => b.monetary - a.monetary).slice(0, SCENE_CAP)
      : parsed.customers
    setDistrict('segments', {
      summary: parsed.summary.map((s) => ({
        segment: s.segment,
        customers: s.customers,
        avg_recency_days: s.avg_recency_days,
        avg_frequency: s.avg_frequency,
      })),
      customers: ranked.map((c) => ({
        id: String(c.customer_id),
        segment: c.segment,
        monetary: c.monetary,
        recency: c.recency_days,
        frequency: c.frequency,
      })),
      total: parsed.customers.length,
    })
  }, [parsed])

  // Leaving the page clears the selection so the next visit starts from the whole map.
  useEffect(() => () => (setFocus('segments', null), setPick('segments', null)), [])

  if (result.state === 'loading') return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  if (!parsed || parsed.summary.length === 0) {
    return (
      <Notice title="No customers in this selection">
        <p>No customer has purchases up to the selected end date with these filters. Widen the period or clear the segment filter.</p>
      </Notice>
    )
  }
  return <SegmentsBody {...parsed} />
}

function SegmentsBody({ summary, customers, grid }: { summary: SegRow[]; customers: RfmRow[]; grid: GridRow[] }) {
  const focus = useFocus('segments') as string | null
  const pick = usePick('segments') as string | null
  const selected = summary.find((s) => s.segment === focus) ?? null
  const total = customers.length

  const { window: [, end], rules } = useDataset()
  return (
    <>
      <Takeaway categories={['Segments', 'Risk']} />
      <SceneHint>
        Each sphere is one customer, sized by what they have spent. Clusters sit by how recently and how often their members
        buy. Hover a sphere to read it; click to open that customer.
      </SceneHint>
      <HoverReadout />
      {total > SCENE_CAP && (
        <p className="muted small">
          The scene shows the {fmtWhole(SCENE_CAP)} highest-spending of {fmtWhole(total)} customers; every figure below covers all of them.
        </p>
      )}

      <p className="muted small">
        Groups are worked out <strong>as of {fmtDate(end)}</strong> from each customer’s full history up to that date. They are
        descriptive groupings from transparent rules, not predictions.
        {rules.rfm?.method === 'quantile' && ' Quantile scores give tied values the same (lowest) score, so a grid cell can be empty.'}
      </p>
      <RfmEditor />

      <Section
        title="Segments by share of revenue"
        aside={
          focus && (
            <button type="button" className="linkish" onClick={() => (setFocus('segments', null), setPick('segments', null))}>
              Show all
            </button>
          )
        }
      >
        <BarList
          caption="Bar length: share of net revenue. Select a segment to focus it in the scene."
          items={summary.map((s) => ({
            key: s.segment,
            label: s.segment,
            value: s.revenue_share_pct,
            display: fmtPct(s.revenue_share_pct),
            color: segmentColor(s.segment),
            note: `${fmtWhole(s.customers)} customers · ${fmtPct(s.customer_share_pct, 0)} of the base`,
          }))}
          max={100}
          selected={focus}
          onSelect={(k) => (setFocus('segments', focus === k ? null : k), setPick('segments', null))}
        />
      </Section>

      {selected && <SegmentProfile seg={selected} />}

      <Section title="Customers by recency × frequency score">
        <RfmGrid grid={grid} />
      </Section>

      <GroupProfile summary={summary} />

      <Explorer customers={customers} focus={selected?.segment ?? null} pick={pick} />

      {pick && (
        <Section title={`Customer ${pick}`} aside={<button type="button" className="linkish" onClick={() => setPick('segments', null)}>Close</button>}>
          <CustomerOrders customerId={pick} />
        </Section>
      )}
    </>
  )
}

function SegmentProfile({ seg }: { seg: SegRow }) {
  const doc = SEGMENTS[seg.segment]
  return (
    <section className="profile" aria-live="polite" style={{ ['--accent' as string]: segmentColor(seg.segment) }}>
      <h2 className="profile__title">{seg.segment}</h2>
      {doc && <p className="profile__desc">{doc.description}</p>}
      <Figures
        items={[
          { label: 'Customers', value: fmtWhole(seg.customers), note: `${fmtPct(seg.customer_share_pct)} of customers` },
          { label: 'Net revenue', value: fmtMoneyCompact(seg.net_revenue), note: `${fmtPct(seg.revenue_share_pct)} of revenue` },
          { label: 'Days since last order', value: fmtWhole(seg.avg_recency_days), note: 'segment average' },
          { label: 'Orders per customer', value: seg.avg_frequency.toFixed(1), note: 'segment average' },
          { label: 'Spend per customer', value: fmtMoney(seg.avg_monetary) },
          { label: 'Average order', value: fmtMoney(seg.avg_order_value) },
        ]}
      />
      {doc?.action && (
        <p className="profile__action">
          <span>Suggested approach</span> {doc.action}
        </p>
      )}
    </section>
  )
}

function RfmGrid({ grid }: { grid: GridRow[] }) {
  const cell = new Map(grid.map((g) => [`${g.r_score}-${g.f_score}`, g]))
  const max = Math.max(1, ...grid.map((g) => g.customers))
  return (
    <div className="table-wrap" role="region" aria-label="Recency by frequency grid" tabIndex={0}>
      <table className="heat">
        <caption className="sr-only">Customers in each recency score (rows) and frequency score (columns)</caption>
        <thead>
          <tr>
            <th scope="col">Recency ↓ / Frequency →</th>
            {[1, 2, 3, 4, 5].map((f) => (
              <th key={f} scope="col">F{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[5, 4, 3, 2, 1].map((r) => (
            <tr key={r}>
              <th scope="row">R{r}</th>
              {[1, 2, 3, 4, 5].map((f) => {
                const g = cell.get(`${r}-${f}`)
                const a = g ? 0.08 + 0.72 * (g.customers / max) : 0
                return (
                  <td key={f} style={{ background: `rgb(214 255 63 / ${a})`, color: a > 0.45 ? '#27231F' : undefined }}>
                    {g ? fmtWhole(g.customers) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Higher recency = bought more recently; higher frequency = more orders. Cells show customers.</p>
    </div>
  )
}

function HoverReadout() {
  const data = useDistrict('segments')
  const hover = useHover('segments')
  const mode = useScene((s) => s.mode)
  if (mode === '2d') return null
  const c = typeof hover === 'number' ? data?.customers[hover] : undefined
  return (
    <aside className="readout" aria-live="polite">
      {c ? (
        <>
          <p className="readout__label">
            <span className="seg-dot" style={{ background: segmentColor(c.segment) }} aria-hidden="true" /> {c.segment}
          </p>
          <p className="readout__value">
            Customer {c.id} <span>{fmtMoney(c.monetary)} spent · {fmtWhole(c.frequency)} orders · last order {fmtWhole(c.recency)} days ago</span>
          </p>
        </>
      ) : (
        <p className="readout__label">Hover a customer sphere to read it here</p>
      )}
    </aside>
  )
}

/** Rule bounds of src/config.py DEFAULT_SEGMENT_RULES (src/segments/rfm.py segment_definitions), in evaluation order. */
const RULES: [string, string, string, string, string][] = [
  ['Champions', '4-5', 'any', 'any', '4-5'],
  ['New Customers', '4-5', '1', 'any', 'any'],
  ['Loyal Customers', '3-5', 'any', 'any', '3-5'],
  ['Potential Loyalists', '3-5', 'any', 'any', '1-2'],
  ['Cannot Lose Them', '1', 'any', 'any', '4-5'],
  ['At Risk', '1-2', 'any', 'any', '3-5'],
  ['Hibernating', '1-2', 'any', 'any', '1-2'],
  ['Other', 'any', 'any', 'any', 'any'],
]
const TABLE_CAP = 500

function GroupProfile({ summary }: { summary: SegRow[] }) {
  return (
    <Section title="Group profile" aside={<CsvButton rows={summary} name="customeriq_segment_summary.csv" />}>
      <DataTable
        caption="Segment profile"
        rows={summary}
        rowKey={(r) => r.segment}
        columns={[
          {
            key: 's',
            label: 'Segment',
            render: (r) => (
              <span className="bars__label">
                <span className="seg-dot" style={{ background: segmentColor(r.segment) }} aria-hidden="true" />
                {r.segment}
              </span>
            ),
          },
          { key: 'c', label: 'Customers', render: (r) => fmtWhole(r.customers), numeric: true },
          { key: 'cs', label: 'Customer %', render: (r) => fmtPct(r.customer_share_pct), numeric: true },
          { key: 'n', label: 'Net revenue', render: (r) => fmtMoney(r.net_revenue), numeric: true },
          { key: 'rs', label: 'Revenue %', render: (r) => fmtPct(r.revenue_share_pct), numeric: true },
          { key: 'rd', label: 'Avg recency (days)', render: (r) => fmtWhole(r.avg_recency_days), numeric: true },
          { key: 'f', label: 'Avg orders', render: (r) => r.avg_frequency.toFixed(1), numeric: true },
          { key: 'm', label: 'Avg monetary', render: (r) => fmtMoney(r.avg_monetary), numeric: true },
          { key: 'a', label: 'Avg order', render: (r) => fmtMoney(r.avg_order_value), numeric: true },
        ]}
      />
      <Details summary="Segment definitions and suggested actions">
        <p className="muted small">Rules are evaluated top to bottom; the first match wins. FM = (F + M + 1) / 2, rounded down.</p>
        <DataTable
          caption="Segment rules"
          rows={RULES}
          rowKey={(r) => r[0]}
          maxHeight={520}
          columns={[
            { key: 'p', label: '#', render: (r) => RULES.indexOf(r) + 1, numeric: true },
            { key: 's', label: 'Segment', render: (r) => r[0] },
            { key: 'r', label: 'R', render: (r) => r[1] },
            { key: 'f', label: 'F', render: (r) => r[2] },
            { key: 'm', label: 'M', render: (r) => r[3] },
            { key: 'fm', label: 'FM', render: (r) => r[4] },
            { key: 'd', label: 'Description', render: (r) => SEGMENTS[r[0]]?.description },
            { key: 'a', label: 'Suggested action', render: (r) => SEGMENTS[r[0]]?.action || 'Review rule coverage.' },
          ]}
        />
      </Details>
    </Section>
  )
}

/** Streamlit "Customer explorer": search, segment filter, full table, CSV of the current view. */
function Explorer({ customers, focus, pick }: { customers: RfmRow[]; focus: string | null; pick: string | null }) {
  const [query, setQuery] = useState('')
  const [segs, setSegs] = useState<string[]>([])
  const names = useMemo(() => [...new Set(customers.map((c) => c.segment))].sort(), [customers])
  const active = focus ? [focus] : segs
  const activeKey = active.join('|')
  const view = useMemo(() => {
    const v = searchRows(customers, query, ['customer_id', 'country', 'segment'])
    return activeKey ? v.filter((c) => activeKey.split('|').includes(c.segment)) : v
  }, [customers, query, activeKey])
  return (
    <Section title={focus ? `Customer explorer · ${focus}` : 'Customer explorer'} aside={<CsvButton rows={view} name="customeriq_rfm_customers.csv" />}>
      <div className="toolbar">
        <SearchBox label="Search customers" value={query} onChange={setQuery} placeholder="Customer ID, country or segment" />
        {!focus && <Pills label="Show segments" options={names} value={segs} onChange={setSegs} />}
      </div>
      <p className="muted small">
        {fmtWhole(view.length)} customers
        {view.length > TABLE_CAP ? `; the first ${fmtWhole(TABLE_CAP)} are listed (the CSV holds all)` : ''}. Select a row to see that
        customer’s order history.
      </p>
      <DataTable
        caption="RFM customers"
        rows={view.slice(0, TABLE_CAP)}
        rowKey={(r) => String(r.customer_id)}
        selected={pick}
        maxHeight={420}
        onRow={(r) => (setFocus('segments', r.segment), setPick('segments', String(r.customer_id)))}
        columns={[
          { key: 'id', label: 'Customer', render: (r) => r.customer_id },
          { key: 'c', label: 'Country', render: (r) => r.country },
          { key: 'seg', label: 'Segment', render: (r) => r.segment },
          { key: 'rfm', label: 'RFM', render: (r) => r.rfm_code, numeric: true },
          { key: 'fm', label: 'FM', render: (r) => r.fm_score, numeric: true },
          { key: 'last', label: 'Last purchase', render: (r) => fmtDate(r.last_purchase) },
          { key: 'r', label: 'Recency (days)', render: (r) => fmtWhole(r.recency_days), numeric: true },
          { key: 'f', label: 'Orders', render: (r) => fmtWhole(r.frequency), numeric: true },
          { key: 'm', label: 'Net revenue', render: (r) => fmtMoney(r.monetary), numeric: true },
        ]}
      />
    </Section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { rows, type AnalyticsMap } from '../api/types'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { BarList, CsvButton, DatasetGate, DataTable, FilterBar, Figures, PageHead, SceneHint, Section, StandardOnly, StdGrid } from '../components/ui'
import { CategoryChart, Panel, shortMonth } from '../components/charts'
import { heat, SERIES } from '../lib/palette'
import { useDataset } from '../lib/dataset'
import { fmtCompact, fmtMoney, fmtMoneyCompact, fmtMonth, fmtPct, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { setDistrict, setHover, useHover, type HourCell } from '../scene/store'

const NAMES = ['weekday_hour', 'purchase_frequency', 'interpurchase_gaps', 'interpurchase_summary', 'order_value_bands', 'monthly_acquisition', 'repeat_vs_one_time'] as const
type Loaded = Pick<AnalyticsMap, (typeof NAMES)[number]>

/** Display bins for the gap histogram (the Streamlit chart also bins client-side, capped at 365). */
const GAP_BINS: [number, number, string][] = [
  [0, 7, 'Within a week'],
  [8, 14, '8–14 days'],
  [15, 30, '15–30 days'],
  [31, 60, '31–60 days'],
  [61, 90, '61–90 days'],
  [91, 180, '91–180 days'],
  [181, 365, '181–365 days'],
  [366, Infinity, 'Over a year'],
]

export default function Behaviour() {
  return (
    <div className="env env--behaviour">
      <PageHead slug="behaviour" lede="Purchase frequency, gaps between orders, timing and basket sizes.">
        When and how customers order
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <BehaviourData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function BehaviourData() {
  const { filters, key } = useDataset()
  const [result, reload] = useAsync((signal) => api.batch(NAMES, filters, signal), [key])
  if (result.state === 'loading') return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  if (!result.data.weekday_hour.data.length) {
    return (
      <Notice title="No orders in this selection">
        <p>No orders fall inside the selected period and segments.</p>
      </Notice>
    )
  }
  return <BehaviourBody data={result.data} />
}

function BehaviourBody({ data }: { data: Loaded }) {
  const [metric, setMetric] = useState<'orders' | 'sales'>('orders')
  const cells = useMemo<HourCell[]>(
    () =>
      rows<{ weekday_num: number; weekday: string; hour: number; orders: number; gross_sales: number }>(data.weekday_hour).map((r) => ({
        wd: r.weekday_num,
        weekday: r.weekday,
        hour: r.hour,
        orders: r.orders,
        sales: r.gross_sales,
      })),
    [data],
  )
  useEffect(() => setDistrict('behaviour', { cells, metric }), [cells, metric])
  useEffect(() => () => setHover('behaviour', null), [])

  const freq = rows<{ frequency_band: string; customers: number; net_revenue: number; customer_share_pct: number; revenue_share_pct: number }>(data.purchase_frequency)
  const bands = rows<{ value_band: string; orders: number; gross_sales: number; avg_lines_per_order: number; avg_units_per_order: number; order_share_pct: number }>(data.order_value_bands)
  const acq = rows<{ month: string; new_customers: number; returning_customers: number; new_customer_sales: number; returning_customer_sales: number; cumulative_new_customers: number }>(data.monthly_acquisition)
  const gaps = useMemo(() => {
    const g = rows<{ gap_days: number }>(data.interpurchase_gaps)
    return GAP_BINS.map(([lo, hi, label]) => ({ label, count: g.filter((r) => r.gap_days >= lo && r.gap_days <= hi).length }))
  }, [data])

  const rep = rows<{ customer_type: string; customers: number; orders: number; net_revenue: number; avg_order_value: number; orders_per_customer: number; customer_share_pct: number; revenue_share_pct: number }>(data.repeat_vs_one_time)
  const repeat = rep.find((r) => r.customer_type === 'Repeat')
  const once = rep.find((r) => r.customer_type === 'One-time')
  return (
    <>
      {repeat && (
        <Figures
          items={[
            { label: 'Repeat customers', value: fmtWhole(repeat.customers), note: `${fmtPct(repeat.customer_share_pct)} of active customers` },
            { label: 'Repeat revenue share', value: fmtPct(repeat.revenue_share_pct), note: 'of period net revenue' },
            { label: 'Repeat average order', value: fmtMoney(repeat.avg_order_value), note: once ? `one-time customers ${fmtMoney(once.avg_order_value)}` : undefined },
            { label: 'Orders per repeat customer', value: repeat.orders_per_customer.toFixed(2) },
          ]}
        />
      )}
      <SceneHint>Weekdays by hour: taller, brighter columns are busier. Hover a column to read it.</SceneHint>
      <div className="chips" role="group" aria-label="Measure" style={{ marginTop: 18 }}>
        <button type="button" className="chip" aria-pressed={metric === 'orders'} onClick={() => setMetric('orders')}>Orders</button>
        <button type="button" className="chip" aria-pressed={metric === 'sales'} onClick={() => setMetric('sales')}>Gross sales</button>
      </div>
      <HourReadout cells={cells} />

      <Section title="Orders by weekday and hour">
        <div className="table-wrap" role="region" aria-label="Orders by weekday and hour" tabIndex={0}>
          <HourTable cells={cells} metric={metric} />
        </div>
        <p className="heat-scale" aria-hidden="true">Quieter <span className="heat-scale__bar" /> Busier</p>
      </Section>

      <StdGrid>
      <Section title="How many orders customers place">
        <BarList
          max={100}
          items={freq.map((f) => ({
            key: f.frequency_band,
            label: f.frequency_band,
            value: f.customer_share_pct,
            display: fmtPct(f.customer_share_pct),
            color: SERIES[0],
            note: `${fmtWhole(f.customers)} customers · ${fmtPct(f.revenue_share_pct)} of revenue`,
          }))}
        />
      </Section>

      <Section title="Days between consecutive orders">
        <BarList
          items={gaps.map((g) => ({ key: g.label, label: g.label, value: g.count, display: fmtWhole(g.count), color: SERIES[1] }))}
          caption="Repeat orders by the gap since the same customer's previous order."
        />
        <p className="muted small">{fmtWhole(rows(data.interpurchase_gaps).length)} repeat orders in the period.</p>
        {data.interpurchase_summary.median_days != null && (
          <Figures
            items={[
              { label: 'Median days between orders', value: data.interpurchase_summary.median_days.toFixed(0), note: 'Median gap between consecutive orders by the same customer.' },
              {
                label: 'Middle half of gaps',
                value: `${data.interpurchase_summary.p25_days!.toFixed(0)}–${data.interpurchase_summary.p75_days!.toFixed(0)} days`,
                note: '25th to 75th percentile of all repeat gaps.',
              },
              ...(data.interpurchase_summary.second_order_median_days != null
                ? [{ label: 'Median days to second order', value: data.interpurchase_summary.second_order_median_days.toFixed(0), note: 'For customers who placed a second order.' }]
                : []),
            ]}
          />
        )}
      </Section>

      <Section title="Orders by order value">
        <BarList
          max={100}
          items={bands.map((b) => ({
            key: b.value_band,
            label: b.value_band,
            value: b.order_share_pct,
            display: fmtPct(b.order_share_pct),
            color: SERIES[3],
            note: `${fmtWhole(b.orders)} orders · ${b.avg_units_per_order.toFixed(1)} units per order`,
          }))}
        />
      </Section>

      {repeat && once && (
        <StandardOnly>
          <Panel title="Repeat vs one-time customers" note="Share of customers compared with share of revenue for each group.">
            <CategoryChart
              caption="Share of customers and share of revenue, repeat vs one-time"
              categories={['Share of customers', 'Share of revenue']}
              series={[
                { key: 'rep', label: 'Repeat', color: SERIES[0], type: 'bar' },
                { key: 'one', label: 'One-time', color: SERIES[1], type: 'bar' },
              ]}
              values={{ rep: [repeat.customer_share_pct, repeat.revenue_share_pct], one: [once.customer_share_pct, once.revenue_share_pct] }}
              format={(v) => fmtPct(v)}
              axisFormat={(v) => `${Math.round(v)}%`}
              height={240}
            />
          </Panel>
        </StandardOnly>
      )}
      </StdGrid>

      <Section title="Repeat vs one-time customers" aside={<CsvButton rows={rep} name="customeriq_repeat_vs_one_time.csv" />}>
        <DataTable
          caption="Repeat vs one-time comparison"
          rows={rep}
          rowKey={(r) => r.customer_type}
          columns={[
            { key: 't', label: 'Customer type', render: (r) => r.customer_type },
            { key: 'c', label: 'Customers', render: (r) => fmtWhole(r.customers), numeric: true },
            { key: 'o', label: 'Orders', render: (r) => fmtWhole(r.orders), numeric: true },
            { key: 'n', label: 'Net revenue', render: (r) => fmtMoney(r.net_revenue), numeric: true },
            { key: 'a', label: 'AOV', render: (r) => fmtMoney(r.avg_order_value), numeric: true },
            { key: 'opc', label: 'Orders / customer', render: (r) => r.orders_per_customer.toFixed(2), numeric: true },
            { key: 'cs', label: 'Customer %', render: (r) => fmtPct(r.customer_share_pct), numeric: true },
            { key: 'rs', label: 'Revenue %', render: (r) => fmtPct(r.revenue_share_pct), numeric: true },
          ]}
        />
        <p className="muted small">Repeat = two or more orders in the customer’s history up to the end date. Orders and revenue are measured within the selected period.</p>
      </Section>

      <Section title="Monthly customer acquisition" aside={<CsvButton rows={acq} name="customeriq_monthly_acquisition.csv" />}>
        <StandardOnly>
          <CategoryChart
            caption="New and returning customers by month"
            categories={acq.map((m) => shortMonth(m.month))}
            titles={acq.map((m) => fmtMonth(m.month))}
            series={[
              { key: 'ret', label: 'Returning customers', color: SERIES[0], type: 'bar', stack: 'c' },
              { key: 'new', label: 'New customers', color: SERIES[1], type: 'bar', stack: 'c' },
            ]}
            values={{ ret: acq.map((m) => m.returning_customers), new: acq.map((m) => m.new_customers) }}
            format={(v) => fmtWhole(v)}
            axisFormat={fmtCompact}
            height={260}
          />
        </StandardOnly>
        <DataTable
          caption="New and returning customers by month"
          rows={acq}
          rowKey={(r) => r.month}
          columns={[
            { key: 'm', label: 'Month', render: (r) => fmtMonth(r.month) },
            { key: 'n', label: 'New', render: (r) => fmtWhole(r.new_customers), numeric: true },
            { key: 'r', label: 'Returning', render: (r) => fmtWhole(r.returning_customers), numeric: true },
            { key: 'ns', label: 'New sales', render: (r) => fmtMoney(r.new_customer_sales), numeric: true },
            { key: 'rs', label: 'Returning sales', render: (r) => fmtMoney(r.returning_customer_sales), numeric: true },
            { key: 'cum', label: 'Customer base', render: (r) => fmtWhole(r.cumulative_new_customers), numeric: true },
          ]}
        />
      </Section>
    </>
  )
}

function HourReadout({ cells }: { cells: HourCell[] }) {
  const hover = useHover('behaviour')
  const peak = cells.reduce((b, c) => (c.orders > b.orders ? c : b), cells[0])
  const c = typeof hover === 'string' ? cells.find((x) => `${x.wd}-${x.hour}` === hover) : null
  const shown = c ?? peak
  const [wd, h] = typeof hover === 'string' ? hover.split('-').map(Number) : [shown.wd, shown.hour]
  const empty = typeof hover === 'string' && !c
  return (
    <aside className="readout" aria-live="polite">
      <p className="readout__label">{hover ? 'Hovered hour' : 'Busiest hour by orders'}</p>
      <p className="readout__value">
        {empty ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd]} ${String(h).padStart(2, '0')}:00` : `${shown.weekday} ${String(shown.hour).padStart(2, '0')}:00`}
        <span>{empty ? 'No orders in this hour' : `${fmtWhole(shown.orders)} orders · ${fmtMoneyCompact(shown.sales)} gross sales`}</span>
      </p>
    </aside>
  )
}

function HourTable({ cells, metric }: { cells: HourCell[]; metric: 'orders' | 'sales' }) {
  const by = new Map(cells.map((c) => [`${c.wd}-${c.hour}`, c]))
  const val = (c?: HourCell) => (c ? (metric === 'orders' ? c.orders : c.sales) : 0)
  const max = Math.max(1, ...cells.map((c) => val(c)))
  const days = [...new Map(cells.map((c) => [c.wd, c.weekday])).entries()].sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7))
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <table className="heat heat--dense">
      <caption className="sr-only">{metric === 'orders' ? 'Orders' : 'Gross sales'} by weekday (rows) and hour (columns)</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          {hours.map((h) => (
            <th key={h} scope="col">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map(([wd, name]) => (
          <tr key={wd}>
            <th scope="row">{name}</th>
            {hours.map((h) => {
              const c = by.get(`${wd}-${h}`)
              const hc = c ? heat(val(c) / max) : null
              return (
                <td key={h} style={hc ? { background: hc.bg, color: hc.fg } : undefined} title={`${name} ${String(h).padStart(2, '0')}:00 · ${c ? `${fmtWhole(c.orders)} orders, ${fmtMoney(c.sales)} gross sales` : 'no orders'}`}>
                  {c ? (metric === 'orders' ? val(c) : fmtMoneyCompact(val(c))) : ''}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

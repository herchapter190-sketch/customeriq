import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { rows } from '../api/types'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { BarList, CsvButton, DatasetGate, DataTable, FilterBar, Figures, PageHead, SceneHint, SearchBox, searchRows, Section, TabPanel, Tabs, Takeaway } from '../components/ui'
import { useDataset } from '../lib/dataset'
import { segmentColor } from '../lib/domain'
import { fmtDate, fmtDelta, fmtMoney, fmtMoneyCompact, fmtMonth, fmtPct, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { setDistrict, setHover, useDistrict, useHover } from '../scene/store'

interface MonthRow {
  month: string
  gross_sales: number
  returns_value: number
  net_revenue: number
  orders: number
  active_customers: number
  new_customers: number
  returning_customers: number
  avg_order_value: number
  net_revenue_mom_pct: number | null
}

const METRICS = [
  { id: 'net_revenue', label: 'Net revenue', fmt: fmtMoneyCompact },
  { id: 'gross_sales', label: 'Gross sales', fmt: fmtMoneyCompact },
  { id: 'orders', label: 'Orders', fmt: fmtWhole },
  { id: 'active_customers', label: 'Active customers', fmt: fmtWhole },
  { id: 'avg_order_value', label: 'Average order', fmt: fmtMoney },
] as const
type MetricId = (typeof METRICS)[number]['id']

const TABS = [
  { id: 'trend', label: 'Trend' },
  { id: 'drivers', label: 'Who drives revenue' },
  { id: 'customers', label: 'Customers' },
  { id: 'products', label: 'Products & markets' },
] as const
type TabId = (typeof TABS)[number]['id']

const NAMES = [
  'monthly_revenue',
  'revenue_concentration',
  'pareto_curve',
  'repeat_vs_one_time',
  'revenue_by_customer',
  'product_performance',
  'category_performance',
  'country_performance',
  'gini_coefficient',
] as const

export default function Revenue() {
  return (
    <div className="env env--revenue">
      <PageHead slug="revenue" lede="Monthly revenue, concentration, customers, products, categories and countries.">
        Where the revenue comes from
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <RevenueData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

type Loaded = Pick<import('../api/types').AnalyticsMap, (typeof NAMES)[number]>

function RevenueData() {
  const { filters, key } = useDataset()
  const [result, reload] = useAsync((signal) => api.batch(NAMES, filters, signal), [key])
  if (result.state === 'loading') return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  if (!result.data.monthly_revenue.data.length) {
    return (
      <Notice title="No revenue in this selection">
        <p>No sales fall inside the selected period and segments. Widen the period or clear the segment filter.</p>
      </Notice>
    )
  }
  return <RevenueBody data={result.data} />
}

function RevenueBody({ data }: { data: Loaded }) {
  const [tab, setTab] = useState<TabId>('trend')
  const [metric, setMetric] = useState<MetricId>('net_revenue')
  const months = useMemo(() => rows<MonthRow>(data.monthly_revenue), [data])
  const pareto = useMemo(
    () => rows<{ cumulative_customer_pct: number; cumulative_revenue_pct: number }>(data.pareto_curve),
    [data],
  )

  // Feed the ribbon: monthly metric on most tabs, the Pareto curve on "Who drives revenue".
  useEffect(() => {
    if (tab === 'drivers' && pareto.length) {
      // Pick the API's own curve points nearest each 4% step of customers (no recalculation).
      const steps = Array.from({ length: 25 }, (_, i) => (i + 1) * 4)
      let j = 0
      const series = steps.map((target) => {
        while (j < pareto.length - 1 && pareto[j + 1].cumulative_customer_pct <= target) j++
        return { label: `Top ${fmtPct(pareto[j].cumulative_customer_pct, 0)}`, value: pareto[j].cumulative_revenue_pct }
      })
      setDistrict('revenue', { key: 'pareto', series, unit: '% of revenue' })
    } else {
      setDistrict('revenue', {
        key: metric,
        series: months.map((m) => ({ label: fmtMonth(m.month), value: Number(m[metric]) || 0 })),
        unit: '',
      })
    }
  }, [tab, metric, months, pareto])
  useEffect(() => () => setHover('revenue', null), [])

  return (
    <>
      <TrendSummary months={months} />
      <Takeaway categories={['Revenue', 'Products']} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Revenue views" />
      {tab === 'trend' && (
        <TabPanel id="trend">
          <SceneHint>The ribbon's height at each month is the selected measure. Hover along it to read any month.</SceneHint>
          <div className="chips" role="group" aria-label="Measure" style={{ marginTop: 18 }}>
            {METRICS.map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <MonthReadout months={months} metric={metric} />
          <Section title="Every month" aside={<CsvButton rows={months} name="customeriq_monthly_revenue.csv" />}>
            <p className="muted small">Gross is everything sold; returns are refunds for returned items; net is what you kept. A widening gap between gross and net means returns are eating more of your sales.</p>
            <DataTable
              caption="Monthly revenue"
              rows={months}
              rowKey={(r) => r.month}
              columns={[
                { key: 'm', label: 'Month', render: (r) => fmtMonth(r.month) },
                { key: 'g', label: 'Gross', render: (r) => fmtMoney(r.gross_sales), numeric: true },
                { key: 'r', label: 'Returns', render: (r) => fmtMoney(r.returns_value), numeric: true },
                { key: 'n', label: 'Net', render: (r) => fmtMoney(r.net_revenue), numeric: true },
                { key: 'mom', label: 'Net MoM', render: (r) => fmtPct(r.net_revenue_mom_pct), numeric: true },
                { key: 'o', label: 'Orders', render: (r) => fmtWhole(r.orders), numeric: true },
                { key: 'ac', label: 'Active', render: (r) => fmtWhole(r.active_customers), numeric: true },
                { key: 'nc', label: 'New', render: (r) => fmtWhole(r.new_customers), numeric: true },
                { key: 'rc', label: 'Returning', render: (r) => fmtWhole(r.returning_customers), numeric: true },
                { key: 'a', label: 'Avg order', render: (r) => fmtMoney(r.avg_order_value), numeric: true },
              ]}
            />
          </Section>
        </TabPanel>
      )}
      {tab === 'drivers' && <Drivers data={data} />}
      {tab === 'customers' && <TopCustomers data={data} />}
      {tab === 'products' && <Products data={data} />}
    </>
  )
}

function MonthReadout({ months, metric }: { months: MonthRow[]; metric: MetricId }) {
  const hover = useHover('revenue')
  const scene = useDistrict('revenue')
  const i = typeof hover === 'number' && scene?.key === metric ? hover : months.length - 1
  const m = months[i]
  const def = METRICS.find((x) => x.id === metric)!
  if (!m) return null
  return (
    <aside className="readout" aria-live="polite">
      <p className="readout__label">{hover == null ? 'Latest month' : 'Hovered month'}</p>
      <p className="readout__value">
        {fmtMonth(m.month)} · {def.label} {def.fmt(Number(m[metric]))}
        <span>
          Net revenue {fmtMoney(m.net_revenue)} ({fmtDelta(m.net_revenue_mom_pct).replace('vs prior', 'vs previous month')}) ·{' '}
          {fmtWhole(m.orders)} orders · {fmtWhole(m.new_customers)} new and {fmtWhole(m.returning_customers)} returning customers
        </span>
      </p>
    </aside>
  )
}

function Drivers({ data }: { data: Loaded }) {
  const tiers = rows<{ top_pct: number; customer_base: number; customers_in_tier: number; tier_revenue: number; revenue_share_pct: number }>(
    data.revenue_concentration,
  )
  const types = rows<{
    customer_type: string
    customers: number
    net_revenue: number
    avg_order_value: number
    orders_per_customer: number
    customer_share_pct: number
    revenue_share_pct: number
  }>(data.repeat_vs_one_time)
  return (
    <TabPanel id="drivers">
      <SceneHint>
        The ribbon now traces the concentration curve: customers ranked by revenue, left to right, and the share of revenue
        they generate together.
      </SceneHint>
      <Section title="Revenue from the top customers">
        <BarList
          max={100}
          items={tiers.map((t) => ({
            key: String(t.top_pct),
            label: `Top ${t.top_pct}% of customers`,
            value: t.revenue_share_pct,
            display: fmtPct(t.revenue_share_pct),
            color: '#D6FF3F',
            note: `${fmtWhole(t.customers_in_tier)} of ${fmtWhole(t.customer_base)} customers with positive revenue · ${fmtMoneyCompact(t.tier_revenue)}`,
          }))}
        />
        <Figures
          items={[
            {
              label: 'Gini coefficient',
              value: data.gini_coefficient.gini != null ? data.gini_coefficient.gini.toFixed(2) : 'n/a',
              note: '0 = every customer spends the same; 1 = one customer generates all revenue.',
            },
          ]}
        />
      </Section>
      <Section title="Repeat and one-time customers">
        <Figures
          items={types.flatMap((t) => [
            {
              label: `${t.customer_type} customers`,
              value: fmtWhole(t.customers),
              note: `${fmtPct(t.customer_share_pct)} of customers, ${fmtPct(t.revenue_share_pct)} of revenue`,
            },
            {
              label: `${t.customer_type} · average order`,
              value: fmtMoney(t.avg_order_value),
              note: `${t.orders_per_customer.toFixed(2)} orders per customer`,
            },
          ])}
        />
      </Section>
    </TabPanel>
  )
}

/** Streamlit `_trend_summary`: latest month, month-on-month change, strongest / weakest month (picked from the API table). */
function TrendSummary({ months }: { months: MonthRow[] }) {
  if (!months.length) return null
  const last = months[months.length - 1]
  const best = months.reduce((b, m) => (m.net_revenue > b.net_revenue ? m : b), months[0])
  const worst = months.reduce((b, m) => (m.net_revenue < b.net_revenue ? m : b), months[0])
  const mom = last.net_revenue_mom_pct
  return (
    <p className="lede lede--sm">
      Latest month, <strong>{fmtMonth(last.month)}</strong>: {fmtMoney(last.net_revenue)} after returns
      {mom != null && Number.isFinite(mom) && (
        <>
          , {mom >= 0 ? 'up' : 'down'} <strong>{Math.abs(mom).toFixed(0)}%</strong> on the month before
        </>
      )}
      {months.length > 2 &&
        (best.month === last.month
          ? '. That is also your strongest month'
          : `. Strongest month ${fmtMonth(best.month)} (${fmtMoney(best.net_revenue)})`)}
      {months.length > 2 && `; weakest ${fmtMonth(worst.month)} (${fmtMoney(worst.net_revenue)})`}.
    </p>
  )
}

interface CustomerRow {
  revenue_rank: number
  customer_id: string
  country: string
  segment: string
  first_purchase: string
  last_purchase: string
  orders: number
  gross_sales: number
  returns_value: number
  net_revenue: number
  avg_order_value: number
  revenue_share_pct: number
  cumulative_share_pct: number
}
const TOP_N = ['25', '100', '500', 'All'] as const

function TopCustomers({ data }: { data: Loaded }) {
  const all = useMemo(() => rows<CustomerRow>(data.revenue_by_customer), [data])
  const [q, setQ] = useState('')
  const [n, setN] = useState<(typeof TOP_N)[number]>('100')
  const found = useMemo(() => searchRows(all, q, ['customer_id', 'country', 'segment']), [all, q])
  const view = n === 'All' ? found : found.slice(0, Number(n))
  return (
    <TabPanel id="customers">
      <Section title="Customer league table" aside={<CsvButton rows={all} name="customeriq_revenue_by_customer.csv" label="Download all" />}>
        <div className="toolbar">
          <SearchBox label="Search customers" value={q} onChange={setQ} placeholder="Customer ID, country or segment" />
          <label className="field">
            <span className="field__label">Show</span>
            <select value={n} onChange={(e) => setN(e.target.value as (typeof TOP_N)[number])}>
              {TOP_N.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">{fmtWhole(all.length)} customers with activity in the period; showing {fmtWhole(view.length)}.</p>
        <DataTable
          caption="Customers by net revenue"
          rows={view}
          rowKey={(r) => String(r.customer_id)}
          maxHeight={440}
          columns={[
            { key: 'rk', label: '#', render: (r) => r.revenue_rank, numeric: true },
            { key: 'id', label: 'Customer', render: (r) => r.customer_id },
            {
              key: 'seg',
              label: 'Segment',
              render: (r) => (
                <span className="bars__label">
                  <span className="seg-dot" style={{ background: segmentColor(r.segment) }} aria-hidden="true" />
                  {r.segment}
                </span>
              ),
            },
            { key: 'c', label: 'Country', render: (r) => r.country },
            { key: 'fp', label: 'First', render: (r) => fmtDate(r.first_purchase) },
            { key: 'lp', label: 'Last', render: (r) => fmtDate(r.last_purchase) },
            { key: 'o', label: 'Orders', render: (r) => fmtWhole(r.orders), numeric: true },
            { key: 'g', label: 'Gross', render: (r) => fmtMoney(r.gross_sales), numeric: true },
            { key: 'rt', label: 'Returns', render: (r) => fmtMoney(r.returns_value), numeric: true },
            { key: 'n', label: 'Net', render: (r) => fmtMoney(r.net_revenue), numeric: true },
            { key: 'aov', label: 'AOV', render: (r) => fmtMoney(r.avg_order_value), numeric: true },
            { key: 'sh', label: 'Share', render: (r) => fmtPct(r.revenue_share_pct, 2), numeric: true },
            { key: 'cum', label: 'Cumulative', render: (r) => fmtPct(r.cumulative_share_pct), numeric: true },
          ]}
        />
      </Section>
    </TabPanel>
  )
}

interface ProductRow {
  revenue_rank: number
  product_id: string
  description: string | null
  category: string | null
  units_sold: number
  units_returned: number
  gross_sales: number
  returns_value: number
  net_revenue: number
  orders: number
  customers: number
  return_rate_pct: number
  revenue_share_pct: number
}

function Products({ data }: { data: Loaded }) {
  const products = useMemo(() => rows<ProductRow>(data.product_performance), [data])
  const categories = rows<{ category: string; products: number; net_revenue: number; customers: number; revenue_share_pct: number }>(data.category_performance)
  const countries = rows<{ country: string; customers: number; orders: number; gross_sales: number; returns_value: number; net_revenue: number; avg_order_value: number }>(data.country_performance)
  const [n, setN] = useState(Math.min(12, Math.max(5, products.length)))
  const shown = Math.min(n, products.length)
  const uncategorised = categories.length > 0 && categories.every((c) => c.category === 'Uncategorised')
  return (
    <TabPanel id="products">
      <Section
        title={`Top ${shown} products by net revenue`}
        aside={
          products.length > 5 && (
            <label className="field">
              <span className="field__label">Show {shown}</span>
              <input type="range" min={5} max={Math.min(30, products.length)} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Number of products" />
            </label>
          )
        }
      >
        <BarList
          items={products.slice(0, shown).map((p) => ({
            key: String(p.product_id),
            label: (p.description || p.product_id).slice(0, 48),
            value: p.net_revenue,
            display: fmtMoneyCompact(p.net_revenue),
            color: '#E66B43',
            note: `${p.category ?? 'No category'} · ${fmtWhole(p.units_sold)} units · ${fmtWhole(p.customers)} customers · ${fmtPct(p.return_rate_pct)} returned`,
          }))}
        />
      </Section>
      <Section title="Categories">
        {uncategorised && <p className="muted small">This dataset has no product category column.</p>}
        <BarList
          max={100}
          items={categories.map((c) => ({
            key: c.category,
            label: c.category,
            value: c.revenue_share_pct,
            display: fmtPct(c.revenue_share_pct),
            color: '#F2E6CF',
            note: `${fmtWhole(c.products)} products · ${fmtWhole(c.customers)} customers · ${fmtMoneyCompact(c.net_revenue)}`,
          }))}
        />
      </Section>
      <Section title="All products" aside={<CsvButton rows={products} name="customeriq_products.csv" />}>
        <DataTable
          caption="Product performance"
          rows={products}
          rowKey={(r) => String(r.product_id)}
          maxHeight={340}
          columns={[
            { key: 'rk', label: '#', render: (r) => r.revenue_rank, numeric: true },
            { key: 'id', label: 'Product', render: (r) => r.product_id },
            { key: 'd', label: 'Description', render: (r) => r.description ?? '—' },
            { key: 'c', label: 'Category', render: (r) => r.category ?? '—' },
            { key: 'u', label: 'Units', render: (r) => fmtWhole(r.units_sold), numeric: true },
            { key: 'ur', label: 'Returned', render: (r) => fmtWhole(r.units_returned), numeric: true },
            { key: 'n', label: 'Net', render: (r) => fmtMoney(r.net_revenue), numeric: true },
            { key: 'o', label: 'Orders', render: (r) => fmtWhole(r.orders), numeric: true },
            { key: 'cu', label: 'Customers', render: (r) => fmtWhole(r.customers), numeric: true },
            { key: 'rr', label: 'Return %', render: (r) => fmtPct(r.return_rate_pct, 2), numeric: true },
            { key: 'sh', label: 'Share', render: (r) => fmtPct(r.revenue_share_pct, 2), numeric: true },
          ]}
        />
      </Section>
      <Section title="Markets" aside={<CsvButton rows={countries} name="customeriq_countries.csv" />}>
        <DataTable
          caption="Revenue by country"
          rows={countries}
          rowKey={(r) => r.country}
          columns={[
            { key: 'c', label: 'Country', render: (r) => r.country },
            { key: 'cu', label: 'Customers', render: (r) => fmtWhole(r.customers), numeric: true },
            { key: 'o', label: 'Orders', render: (r) => fmtWhole(r.orders), numeric: true },
            { key: 'g', label: 'Gross', render: (r) => fmtMoney(r.gross_sales), numeric: true },
            { key: 'r', label: 'Returns', render: (r) => fmtMoney(r.returns_value), numeric: true },
            { key: 'n', label: 'Net revenue', render: (r) => fmtMoney(r.net_revenue), numeric: true },
            { key: 'a', label: 'Avg order', render: (r) => fmtMoney(r.avg_order_value), numeric: true },
          ]}
        />
      </Section>
    </TabPanel>
  )
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { rows } from '../api/types'
import { ErrorPanel, Loading, Notice, SessionGate } from '../components/Status'
import { BarList, CsvButton, DatasetGate, DataTable, Details, FilterBar, Figures, PageHead, SceneHint, Section, StandardOnly, Takeaway, ThreeDOnly } from '../components/ui'
import { CategoryChart, Panel, shortMonth } from '../components/charts'
import { heat, SERIES } from '../lib/palette'
import { useIsStandard } from '../lib/viewMode'
import { useDataset } from '../lib/dataset'
import { fmtMonth, fmtPct, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { setDistrict, setFocus, setHover, useFocus, useHover, type CohortRing } from '../scene/store'

interface LongRow {
  cohort_month: string
  month_index: number
  cohort_size: number
  active_customers: number
  retention_pct: number
}
interface MomRow {
  month: string
  active_customers: number
  prior_month_customers: number
  retained_customers: number
  retention_rate_pct: number | null
}

interface CurveRow {
  month_index: number
  cohorts: number
  eligible_customers: number
  active_customers: number
  retention_pct: number | null
}
interface RetentionAvg {
  m1: number | null
  m3: number | null
  curve: CurveRow[]
}

export default function Cohorts() {
  return (
    <div className="env env--cohorts">
      <PageHead slug="cohorts" lede="How each acquisition cohort keeps buying, month after month.">
        How long each intake keeps buying
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <CohortsData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function CohortsData() {
  const { filters, key } = useDataset()
  const [result, reload] = useAsync((signal) => api.batch(['cohort_long', 'monthly_retention', 'retention_summary'], filters, signal), [key])
  const parsed = useMemo(() => {
    if (result.state !== 'done') return null
    const long = rows<LongRow>(result.data.cohort_long)
    const byCohort = new Map<string, CohortRing>()
    long.forEach((r) => {
      const ring = byCohort.get(r.cohort_month) ?? { cohort: r.cohort_month, size: r.cohort_size, points: [] }
      ring.points.push({ k: r.month_index, pct: r.retention_pct, active: r.active_customers })
      byCohort.set(r.cohort_month, ring)
    })
    const rings = [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort))
    const s = result.data.retention_summary
    const avg: RetentionAvg = { m1: s.month_1_pct, m3: s.month_3_pct, curve: rows<CurveRow>(s.curve) }
    return { rings, maxK: Math.max(0, ...long.map((r) => r.month_index)), mom: rows<MomRow>(result.data.monthly_retention), avg }
  }, [result])

  useEffect(() => {
    if (parsed) setDistrict('cohorts', { rings: parsed.rings, maxK: parsed.maxK })
  }, [parsed])
  useEffect(() => () => (setFocus('cohorts', null), setHover('cohorts', null)), [])

  if (result.state === 'loading') return <Loading />
  if (result.state === 'error') return <ErrorPanel error={result.error} onRetry={reload} />
  if (!parsed || !parsed.rings.length) {
    return (
      <Notice title="No cohorts in this selection">
        <p>No customer made a first purchase inside the selected period. Widen the period to see cohorts.</p>
      </Notice>
    )
  }
  return <CohortsBody rings={parsed.rings} maxK={parsed.maxK} mom={parsed.mom} avg={parsed.avg} />
}

/** Streamlit's "Months after acquisition" slider (3 … horizon, default 12); one value drives curve and matrix. */
function HorizonSlider({ horizon, horizonMax, maxK, onChange }: { horizon: number; horizonMax: number; maxK: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span className="field__label">Months after acquisition: {Math.min(horizon, maxK)}</span>
      <input type="range" min={3} max={horizonMax} value={horizon} onChange={(e) => onChange(Number(e.target.value))} aria-label="Months after acquisition" />
    </label>
  )
}

function AverageRetention({ avg, cohorts, horizon, slider, ring }: { avg: RetentionAvg; cohorts: number; horizon: number; slider: ReactNode; ring: CohortRing | null }) {
  // The API returns the full curve; only the display is trimmed (Streamlit: average_retention_curve(max_months=...)).
  const later = avg.curve.filter((r) => r.month_index >= 1 && r.month_index <= horizon && r.retention_pct != null)
  return (
    <Section title="Average retention across cohorts">
      <div className="toolbar">{slider}</div>
      <Figures
        items={[
          { label: 'Cohorts', value: fmtWhole(cohorts) },
          { label: 'Month-1 retention', value: avg.m1 != null ? fmtPct(avg.m1) : 'n/a', note: 'Customer-weighted average across all cohorts old enough to be observed at month 1.' },
          { label: 'Month-3 retention', value: avg.m3 != null ? fmtPct(avg.m3) : 'n/a', note: 'Customer-weighted average across all cohorts old enough to be observed at month 3.' },
        ]}
      />
      <StandardOnly>
        {later.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <CategoryChart
              caption={ring ? `Average retention curve compared with the ${fmtMonth(ring.cohort)} cohort` : 'Average retention curve'}
              categories={later.map((r) => `M+${r.month_index}`)}
              titles={later.map((r) => `Month +${r.month_index} after first purchase`)}
              series={[
                { key: 'avg', label: 'Average across cohorts', color: SERIES[0], type: 'area' },
                ...(ring ? [{ key: 'sel', label: `Cohort ${fmtMonth(ring.cohort)}`, color: SERIES[3], type: 'line' as const, dashed: true }] : []),
              ]}
              values={{
                avg: later.map((r) => r.retention_pct),
                ...(ring ? { sel: later.map((r) => ring.points.find((p) => p.k === r.month_index)?.pct ?? null) } : {}),
              }}
              format={(v) => fmtPct(v)}
              axisFormat={(v) => `${Math.round(v)}%`}
              endLabel
              height={280}
            />
            <p className="muted small">Only cohorts old enough to be observed count at each month. Select a cohort in the matrix or the cohort-size chart to compare it with the average.</p>
          </div>
        )}
      </StandardOnly>
      <ThreeDOnly>
      {later.length > 0 && (
        <BarList
          max={Math.max(1, ...later.map((r) => r.retention_pct!))}
          caption="Average retention curve: for each month after first purchase, only cohorts old enough to be observed count."
          items={later.map((r) => ({
            key: String(r.month_index),
            label: `Month +${r.month_index}`,
            value: r.retention_pct!,
            display: fmtPct(r.retention_pct),
            color: SERIES[0],
            note: `${fmtWhole(r.active_customers)} of ${fmtWhole(r.eligible_customers)} customers · ${fmtWhole(r.cohorts)} cohorts`,
          }))}
        />
      )}
      </ThreeDOnly>
    </Section>
  )
}

function CohortsBody({ rings, maxK, mom, avg }: { rings: CohortRing[]; maxK: number; mom: MomRow[]; avg: RetentionAvg }) {
  const focus = useFocus('cohorts')
  const hover = useHover('cohorts')
  const idx = typeof focus === 'number' ? focus : typeof hover === 'number' ? hover : null
  const ring = idx != null ? rings[idx] : null
  const later = ring?.points.filter((p) => p.k >= 1) ?? []
  const horizonMax = Math.max(3, maxK)
  const [horizon, setHorizon] = useState(Math.min(12, horizonMax))
  const slider = <HorizonSlider horizon={horizon} horizonMax={horizonMax} maxK={maxK} onChange={setHorizon} />
  const standard = useIsStandard()

  return (
    <>
      <Takeaway categories={['Retention', 'Behaviour']} />
      <SceneHint>One ring per cohort, oldest outside; months run clockwise from the top. Click a ring to isolate it.</SceneHint>

      {(ring || !standard) && (
      <Section
        title={ring ? `Cohort ${fmtMonth(ring.cohort)}` : 'Select a cohort'}
        aside={focus != null && <button type="button" className="linkish" onClick={() => setFocus('cohorts', null)}>Show all</button>}
      >
        {ring ? (
          <div aria-live="polite">
            <p className="muted small">
              {fmtWhole(ring.size)} customers first bought in {fmtMonth(ring.cohort)}. Share of them buying again in each later month:
            </p>
            {later.length ? (
              <BarList
                max={Math.max(1, ...later.map((p) => p.pct))}
                items={later.map((p) => ({
                  key: String(p.k),
                  label: `Month +${p.k}`,
                  value: p.pct,
                  display: fmtPct(p.pct),
                  color: SERIES[3],
                  note: `${fmtWhole(p.active)} customers`,
                }))}
              />
            ) : (
              <p className="muted">This cohort is the most recent; no later months yet.</p>
            )}
          </div>
        ) : (
          <p className="muted small">{standard ? 'Pick a cohort in the matrix or the cohort-size chart to read its retention month by month.' : 'Hover or click a ring in the scene, or pick a cohort in the matrix.'}</p>
        )}
      </Section>
      )}

      <AverageRetention avg={avg} cohorts={rings.length} horizon={horizon} slider={slider} ring={ring} />

      <StandardOnly>
        <div className="grid grid--2">
          <Panel title="Cohort sizes" note="New customers acquired in each month. Click a bar to select that cohort.">
            <CategoryChart
              caption="Customers in each acquisition cohort"
              categories={rings.map((r) => shortMonth(r.cohort))}
              titles={rings.map((r) => `Cohort ${fmtMonth(r.cohort)}`)}
              series={[{ key: 'n', label: 'Customers acquired', color: SERIES[0], type: 'bar' }]}
              values={{ n: rings.map((r) => r.size) }}
              format={(v) => `${fmtWhole(v)} customers`}
              axisFormat={(v) => fmtWhole(v)}
              selected={typeof focus === 'number' ? focus : null}
              onSelect={(i) => setFocus('cohorts', focus === i ? null : i)}
              height={240}
            />
          </Panel>
          <Panel title="Month-over-month retention" note="Of last month’s customers, the share who ordered again this month.">
            <CategoryChart
              caption="Month-over-month customer retention"
              categories={mom.map((m) => shortMonth(m.month))}
              titles={mom.map((m) => fmtMonth(m.month))}
              series={[{ key: 'p', label: 'Retention rate', color: SERIES[3], type: 'line' }]}
              values={{ p: mom.map((m) => m.retention_rate_pct) }}
              format={(v) => fmtPct(v)}
              axisFormat={(v) => `${Math.round(v)}%`}
              endLabel
              height={240}
            />
          </Panel>
        </div>
      </StandardOnly>

      <CohortMatrix rings={rings} maxK={maxK} idx={idx} focus={typeof focus === 'number' ? focus : null} horizon={horizon} slider={slider} />

      <Section title="Month-over-month customer retention" aside={<CsvButton rows={mom} name="customeriq_monthly_retention.csv" />}>
        <p className="muted small">Of the customers who ordered last month, the share who ordered again this month. A falling line means fewer regulars are coming back.</p>
        <DataTable
          caption="Month-over-month retention"
          rows={mom}
          rowKey={(r) => r.month}
          columns={[
            { key: 'm', label: 'Month', render: (r) => fmtMonth(r.month) },
            { key: 'a', label: 'Active', render: (r) => fmtWhole(r.active_customers), numeric: true },
            { key: 'p', label: 'Prior month', render: (r) => fmtWhole(r.prior_month_customers), numeric: true },
            { key: 'r', label: 'Retained', render: (r) => fmtWhole(r.retained_customers), numeric: true },
            { key: 'pct', label: 'Retention', render: (r) => fmtPct(r.retention_rate_pct), numeric: true },
          ]}
        />
      </Section>
    </>
  )
}

const monthNum = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1

/**
 * Retention matrix with the same cell rules as src/analytics/cohorts.py `cohort_matrix`:
 * a month the cohort has reached but where nobody bought shows 0 (the SQL returns no row for it);
 * a month after the analysis end date is blank, so it is never mistaken for zero retention.
 */
function CohortMatrix({ rings, maxK, idx, focus, horizon, slider }: { rings: CohortRing[]; maxK: number; idx: number | null; focus: number | null; horizon: number; slider: ReactNode }) {
  const { window: [, end] } = useDataset()
  const [metric, setMetric] = useState<'pct' | 'active'>('pct')
  const endNum = end ? monthNum(end) : Infinity
  const first = metric === 'pct' ? 1 : 0 // Streamlit drops month 0 (always 100%) from the % view
  const cols = Array.from({ length: Math.min(horizon, maxK) - first + 1 }, (_, i) => i + first)
  const cell = (r: CohortRing, k: number): number | null => {
    if (k > endNum - monthNum(r.cohort)) return null
    const p = r.points.find((x) => x.k === k)
    return p ? (metric === 'pct' ? p.pct : p.active) : 0
  }
  const values = rings.flatMap((r) => cols.map((k) => cell(r, k))).filter((v): v is number => v != null).sort((a, b) => a - b)
  const scale = values.length ? values[Math.min(values.length - 1, Math.floor(values.length * 0.98))] || 1 : 1
  const csvRows = rings.map((r) => ({
    cohort_month: r.cohort,
    cohort_size: r.size,
    ...Object.fromEntries(Array.from({ length: Math.min(horizon, maxK) + 1 }, (_, k) => [`M${k}`, cell(r, k)])),
  }))
  return (
    <Section title="Retention matrix" aside={<CsvButton rows={csvRows} name="customeriq_cohort_matrix.csv" />}>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Show">
          <button type="button" className="chip" aria-pressed={metric === 'pct'} onClick={() => setMetric('pct')}>Retention %</button>
          <button type="button" className="chip" aria-pressed={metric === 'active'} onClick={() => setMetric('active')}>Returning customers</button>
        </div>
        {slider}
      </div>
      <div className="table-wrap" role="region" aria-label="Cohort retention matrix" tabIndex={0} style={{ maxHeight: 460 }}>
        <table className="heat heat--dense">
          <caption className="sr-only">
            {metric === 'pct' ? 'Retention %' : 'Returning customers'} by cohort (rows) and months since first purchase (columns)
          </caption>
          <thead>
            <tr>
              <th scope="col">Cohort</th>
              <th scope="col">n</th>
              {cols.map((k) => (
                <th key={k} scope="col">M{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rings.map((r, i) => (
              <tr key={r.cohort} className={idx === i ? 'is-selected' : undefined} onClick={() => setFocus('cohorts', focus === i ? null : i)} style={{ cursor: 'pointer' }}>
                <th scope="row">
                  <button type="button" className="linkish" onClick={(e) => (e.stopPropagation(), setFocus('cohorts', focus === i ? null : i))}>
                    {fmtMonth(r.cohort)}
                  </button>
                </th>
                <td className="heat__n">{fmtWhole(r.size)}</td>
                {cols.map((k) => {
                  const v = cell(r, k)
                  if (v == null) return <td key={k} className="heat__na" />
                  const c = heat(Math.min(1, v / scale))
                  return (
                    <td key={k} style={{ background: c.bg, color: c.fg }} title={`${fmtMonth(r.cohort)} · M${k}: ${metric === 'pct' ? fmtPct(v) : `${fmtWhole(v)} customers`}`}>
                      {metric === 'pct' ? Math.round(v) : fmtWhole(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="heat-scale" aria-hidden="true">Fewer <span className="heat-scale__bar" /> More</p>
      <p className="muted small">
        Each row is the customers who first bought in that month (n). Moving right, each cell shows {metric === 'pct' ? 'the share' : 'how many'} who
        bought again 1, 2, 3… months later; lighter means more came back. Blank cells are months not reached yet.
      </p>
      <Details summary="Methodology">
        <ul className="small">
          <li><strong>Cohort month</strong>: month of the customer’s first sales order across the entire dataset, so the date filter never re-assigns a customer to a later cohort.</li>
          <li><strong>Active in month N</strong>: at least one sales order (returns excluded) in calendar month cohort + N.</li>
          <li><strong>Retention %</strong> = active customers in month N / cohort size.</li>
          <li>Calculated in SQL (src/sql/queries/cohort_retention.sql); validated against hand-computed test datasets in tests/test_cohorts.py.</li>
        </ul>
      </Details>
    </Section>
  )
}

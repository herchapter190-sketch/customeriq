import { useEffect, useState } from 'react'
import { api, saveBlob } from '../api/client'
import type { Insight } from '../api/types'
import { ErrorPanel, Loading, SessionGate } from '../components/Status'
import { DatasetGate, FilterBar, PageHead, SceneHint, Section } from '../components/ui'
import { toCsv } from '../lib/csv'
import { useDataset } from '../lib/dataset'
import { CSV_LABELS } from '../lib/domain'
import { useAsync } from '../lib/hooks'
import { patchDistrict, sceneStore, setDistrict, setFocus, setHover, setPick, useDistrict, useHover } from '../scene/store'

const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'risk', label: 'Risks' },
  { id: 'opportunity', label: 'Opportunities' },
  { id: 'info', label: 'Information' },
] as const
type Exp = 'pdf' | 'xlsx' | 'csv'

export default function Reports() {
  return (
    <div className="env env--reports">
      <PageHead slug="reports" lede="PDF executive report, Excel workbook and formula-safe CSV extracts, built by the API from the current filters.">
        Reports to take into the room
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <ReportsBody />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function ReportsBody() {
  const { filters, key, meta, dataset, currency } = useDataset()
  const csvNames = meta?.csv_exports ?? []
  const [csv, setCsv] = useState(0)
  const [status, setStatus] = useState<Partial<Record<Exp, { ok: boolean; text: string }>>>({})
  const [busy, setBusy] = useState<Exp | null>(null)
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('all')
  const [insights, reload] = useAsync((signal) => api.analytics('insights', filters, signal, currency ? { currency } : {}), [key, currency])
  const findings: Insight[] = insights.state === 'done' ? insights.data : []

  useEffect(() => {
    setDistrict('reports', { findings: findings.map((f) => ({ kind: f.kind, title: f.title })), busy: null, done: [], csvTables: csvNames.length })
    // findings identity changes only when the API answers
  }, [insights, csvNames.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPick('reports', csv), [csv])
  useEffect(() => () => (setFocus('reports', null), setHover('reports', null), setPick('reports', null)), [])

  const make = async (which: Exp) => {
    setBusy(which)
    patchDistrict('reports', { busy: which })
    setStatus((s) => ({ ...s, [which]: undefined }))
    try {
      const name =
        which === 'pdf' ? await api.reportPdf(filters, currency) : which === 'xlsx' ? await api.reportXlsx(filters, currency) : await api.reportCsv(csvNames[csv], filters)
      setStatus((s) => ({ ...s, [which]: { ok: true, text: `Saved ${name}` } }))
      const prev = sceneStore.get().data.reports?.done ?? []
      patchDistrict('reports', { busy: null, done: [...prev.filter((d) => d !== which), which] })
    } catch (e) {
      setStatus((s) => ({ ...s, [which]: { ok: false, text: e instanceof Error ? e.message : 'The export failed.' } }))
      patchDistrict('reports', { busy: null })
    } finally {
      setBusy(null)
    }
  }
  const hoverProps = (k: Exp) => ({ onMouseEnter: () => setFocus('reports', k), onFocus: () => setFocus('reports', k) })
  const shown = findings.filter((f) => kind === 'all' || f.kind === kind)

  return (
    <>
      <SceneHint>Hover an export to light its object; generating one sets it in motion. The orbs above are this period's findings; hover one to read its title.</SceneHint>
      {dataset?.meta.is_synthetic && <p className="muted small">The demo dataset is loaded, so every report is labelled as synthetic.</p>}
      <p className="muted small">
        Reports use the filters currently selected (period, segments, scoring and inactivity rules) and the currency symbol chosen in the
        filter bar{currency ? ` (${currency})` : ' (currently not specified)'}.
      </p>
      <div className="exports">
        <article className="export" {...hoverProps('pdf')}>
          <h3>PDF report</h3>
          <p>Executive summary, KPIs, revenue, RFM segmentation, cohort retention, inactive customers, findings and recommendations, with charts and page numbers.</p>
          <div className="actions">
            <button type="button" className="btn btn--solid" disabled={busy !== null} onClick={() => make('pdf')}>
              {busy === 'pdf' ? 'Building…' : 'Download PDF'}
            </button>
          </div>
          {status.pdf && <p className={`status-line ${status.pdf.ok ? 'is-ok' : 'is-bad'}`} role="status">{status.pdf.text}</p>}
        </article>
        <article className="export" {...hoverProps('xlsx')}>
          <h3>Excel workbook</h3>
          <p>KPIs, segments, RFM customers, a colour-scaled cohort matrix, products, inactive customers and insights. Text cells are formula-safe.</p>
          <div className="actions">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => make('xlsx')}>
              {busy === 'xlsx' ? 'Building…' : 'Download workbook'}
            </button>
          </div>
          {status.xlsx && <p className={`status-line ${status.xlsx.ok ? 'is-ok' : 'is-bad'}`} role="status">{status.xlsx.text}</p>}
        </article>
        <article className="export" {...hoverProps('csv')}>
          <h3>CSV extract</h3>
          <p>Any analytical table as a CSV for further analysis.</p>
          <div className="actions">
            <select aria-label="CSV table" value={csv} onChange={(e) => setCsv(Number(e.target.value))}>
              {csvNames.map((n, i) => (
                <option key={n} value={i}>{CSV_LABELS[n] ?? n}</option>
              ))}
            </select>
            <button type="button" className="btn" disabled={busy !== null || !csvNames.length} onClick={() => make('csv')}>
              {busy === 'csv' ? 'Exporting…' : 'Download CSV'}
            </button>
          </div>
          {status.csv && <p className={`status-line ${status.csv.ok ? 'is-ok' : 'is-bad'}`} role="status">{status.csv.text}</p>}
        </article>
      </div>

      <Section
        title="Business findings"
        aside={
          findings.length > 0 && (
            <button
              type="button"
              className="linkish"
              onClick={() =>
                saveBlob(
                  toCsv(
                    ['key', 'category', 'kind', 'title', 'observation', 'metric', 'why_it_matters', 'action'],
                    findings.map((f) => [f.key, f.category, f.kind, f.title, f.observation, f.metric, f.why_it_matters, f.action]),
                  ),
                  `customeriq_findings_${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_')}.csv`,
                )
              }
            >
              Download findings (CSV)
            </button>
          )
        }
      >
        <p className="muted small">Each finding comes from a documented rule applied to the calculated metrics; rules without enough data are skipped rather than estimated.</p>
        <div className="chips" role="group" aria-label="Finding type" style={{ marginTop: 14 }}>
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        {insights.state === 'loading' && <Loading label="Reading findings" />}
        {insights.state === 'error' && <ErrorPanel error={insights.error} onRetry={reload} />}
        {insights.state === 'done' && (
          <FindingsList list={shown} all={findings} />
        )}
      </Section>
    </>
  )
}

function FindingsList({ list, all }: { list: Insight[]; all: Insight[] }) {
  const hover = useHover('reports')
  const scene = useDistrict('reports')
  if (!all.length) return <p className="muted">Not enough data to generate findings for this selection.</p>
  if (!list.length) return <p className="muted">No findings of this type for the current selection.</p>
  const hot = typeof hover === 'number' && scene ? all[hover] : null
  return (
    <ol className="insights__list" style={{ marginTop: 14 }}>
      {list.map((ins) => (
        <li
          key={ins.key}
          className={`insight is-${ins.kind}`}
          style={hot?.key === ins.key ? { background: 'rgb(244 235 217 / 0.05)' } : undefined}
          onMouseEnter={() => setHover('reports', all.indexOf(ins))}
          onMouseLeave={() => setHover('reports', null)}
        >
          <span className="insight__num">{String(all.indexOf(ins) + 1).padStart(2, '0')}</span>
          <div>
            <p className="insight__meta">{ins.category} · {ins.kind}</p>
            <h3 className="insight__title">{ins.title}</h3>
            <p className="insight__obs">{ins.observation}</p>
            <p className="insight__obs"><strong>{ins.metric}</strong></p>
            <p className="insight__obs">{ins.why_it_matters}</p>
            <p className="insight__action"><span>Action</span> {ins.action}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

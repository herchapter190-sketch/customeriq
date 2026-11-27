import { useEffect, useState } from 'react'
import { api, saveBlob } from '../api/client'
import type { Insight } from '../api/types'
import { ErrorPanel, Loading, SessionGate } from '../components/Status'
import { DatasetGate, FilterBar, PageHead, SceneHint, Section, Signal } from '../components/ui'
import { toCsv } from '../lib/csv'
import { useDataset } from '../lib/dataset'
import { CSV_LABELS } from '../lib/domain'
import { useAsync } from '../lib/hooks'
import { patchDistrict, sceneStore, setDistrict, setFocus, setHover, setPick, useDistrict, useHover } from '../scene/store'

/** YYYYMMDD_HHMM in local time, matching the API's report file names (time.strftime). */
function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'risk', label: 'Risks' },
  { id: 'opportunity', label: 'Opportunities' },
  { id: 'info', label: 'Notes' },
] as const
type Exp = 'pdf' | 'xlsx' | 'csv'

export default function Reports() {
  return (
    <div className="env env--reports">
      <PageHead slug="reports" lede="PDF report, Excel workbook and CSV extracts.">
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
  const { filters, key, meta, currency } = useDataset()
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
      <SceneHint>Hover an export to light it. The orbs are this period's findings.</SceneHint>
      <p className="muted small">Uses the current filters and currency{currency ? ` (${currency.trim()})` : ''}.</p>
      <div className="exports">
        <article className="export" {...hoverProps('pdf')}>
          <span className="export__format" style={{ ['--c' as string]: '#6E1530' }}>PDF</span>
          <h3>Executive report</h3>
          <p>KPIs, revenue, segments, cohorts, win-backs and findings, with charts.</p>
          <div className="actions">
            <button type="button" className="btn btn--solid" disabled={busy !== null} onClick={() => make('pdf')}>
              {busy === 'pdf' ? 'Building…' : 'Download PDF'}
            </button>
          </div>
          {status.pdf && <p className={`status-line ${status.pdf.ok ? 'is-ok' : 'is-bad'}`} role="status">{status.pdf.text}</p>}
        </article>
        <article className="export" {...hoverProps('xlsx')}>
          <span className="export__format" style={{ ['--c' as string]: '#A8334F' }}>XLSX</span>
          <h3>Excel workbook</h3>
          <p>Every analysis as its own sheet. Formula-safe.</p>
          <div className="actions">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => make('xlsx')}>
              {busy === 'xlsx' ? 'Building…' : 'Download workbook'}
            </button>
          </div>
          {status.xlsx && <p className={`status-line ${status.xlsx.ok ? 'is-ok' : 'is-bad'}`} role="status">{status.xlsx.text}</p>}
        </article>
        <article className="export" {...hoverProps('csv')}>
          <span className="export__format" style={{ ['--c' as string]: '#D27A8B' }}>CSV</span>
          <h3>Table extract</h3>
          <p>{csvNames.length} tables, raw values, filtered like this page.</p>
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
        title="What your report will say"
        note="These findings are written into the PDF and Excel exports above, so check them before you download. Overview shows only the top few; this is the full list for the current filters."
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
                  `customeriq_findings_${localStamp()}.csv`,
                )
              }
            >
              Download findings (CSV)
            </button>
          )
        }
      >
        <div className="chips" role="group" aria-label="Finding type" style={{ marginTop: 14 }}>
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label} {insights.state === 'done' && <span className="chip__count">{k.id === 'all' ? findings.length : findings.filter((f) => f.kind === k.id).length}</span>}
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
    <ul className="signals" style={{ marginTop: 14 }}>
      {list.map((ins) => (
        <Signal
          key={ins.key}
          ins={ins}
          style={hot?.key === ins.key ? { background: 'var(--elev)' } : undefined}
          onMouseEnter={() => setHover('reports', all.indexOf(ins))}
          onMouseLeave={() => setHover('reports', null)}
        />
      ))}
    </ul>
  )
}

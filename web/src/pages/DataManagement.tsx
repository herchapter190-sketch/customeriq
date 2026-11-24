import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, saveBlob, type CleaningOptions } from '../api/client'
import { rows, type CleaningSummary, type ImportPreview, type ImportResult } from '../api/types'
import { ErrorPanel, Loading, SessionGate } from '../components/Status'
import { BarList, DatasetGate, DataTable, Figures, PageHead, SceneHint, Section, TabPanel, Tabs, ThreeDOnly } from '../components/ui'
import { SERIES } from '../lib/palette'
import { toCsv } from '../lib/csv'
import { useDataset } from '../lib/dataset'
import { REJECTION_REASONS } from '../lib/domain'
import { fmtDate, fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useIsStandard } from '../lib/viewMode'
import { setDistrict, type DataStage } from '../scene/store'

const TABS = [
  { id: 'import', label: 'Import your data' },
  { id: 'current', label: 'What is loaded now' },
  { id: 'demo', label: 'Try the demo data' },
] as const
type TabId = (typeof TABS)[number]['id']

/** Same template as the Streamlit page (src/ui/pages/data_management.py). */
const TEMPLATE = {
  columns: ['InvoiceNo', 'CustomerID', 'InvoiceDate', 'StockCode', 'Description', 'Category', 'Quantity', 'UnitPrice', 'Country'],
  data: [
    ['100001', 'C-1001', '2024-01-05 10:15', 'SKU-1', 'Ceramic mug', 'Kitchen', 2, 8.5, 'United Kingdom'],
    ['100001', 'C-1001', '2024-01-05 10:15', 'SKU-2', 'Tea towel', 'Kitchen', 1, 6.0, 'United Kingdom'],
    ['100002', 'C-1002', '2024-01-06 14:02', 'SKU-1', 'Ceramic mug', 'Kitchen', 4, 8.5, 'France'],
    ['C100001', 'C-1001', '2024-01-09 09:30', 'SKU-2', 'Tea towel', 'Kitchen', -1, 6.0, 'United Kingdom'],
  ],
}

const STEPS = ['Upload', 'Map columns', 'Validate', 'Clean', 'Import'] as const
const STEP_OF: Record<DataStage, number> = { empty: -1, loaded: 5, uploaded: 0, mapping: 1, validated: 3, importing: 4, imported: 5, failed: 4 }
/** Plain-language guidance for where the reader is in the import workflow. */
const STAGE_HELP: Record<DataStage, string> = {
  empty: 'No dataset is loaded. Start by uploading a transaction file in “Import your data”, or load the synthetic demo.',
  loaded: 'A dataset is loaded. To replace it, upload a new file: you will map its columns, review validation, then confirm the import.',
  uploaded: 'Step 1 — reading your file. Large files can take a few seconds.',
  mapping: 'Step 2 — check that each standard field points at the right column. Required fields are marked *. The validation below shows how the rows would be cleaned.',
  validated: 'Step 3–4 — validation and cleaning reviewed. Confirm the replacement in step 4 to import.',
  importing: 'Step 5 — importing. A verified backup of the current dataset is taken first.',
  imported: 'Import complete. Every view now reads the new dataset.',
  failed: 'The import did not complete. The current dataset was not changed; see the message below.',
}

const countsOf = (s?: CleaningSummary) =>
  s ? { valid: s.sales_rows, returns: s.return_rows, rejected: s.rejected_rows, total: s.input_rows } : { valid: 0, returns: 0, rejected: 0, total: 0 }

export default function DataManagement() {
  return (
    <div className="env env--data">
      <PageHead slug="data" lede="Import, validate and replace the active dataset. Every change is preceded by a verified backup.">
        The data behind every view
      </PageHead>
      <SessionGate>
        <DatasetGate allowEmpty>
          <DataBody />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function DataBody() {
  const { dataset, meta, refresh } = useDataset()
  const [tab, setTab] = useState<TabId>(dataset?.has_data ? 'current' : 'import')
  const [stage, setStage] = useState<DataStage>(dataset?.has_data ? 'loaded' : 'empty')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const fields = meta?.standard_fields ?? {}

  // Resting state follows the database whenever no import is in progress.
  useEffect(() => {
    if (!preview && (stage === 'loaded' || stage === 'empty')) setStage(dataset?.has_data ? 'loaded' : 'empty')
  }, [dataset, preview, stage])

  useEffect(() => {
    const summary =
      stage === 'imported' || stage === 'failed'
        ? result?.summary
        : preview && stage !== 'loaded' && stage !== 'empty'
          ? preview.validation.summary
          : dataset?.meta.cleaning_summary
    const counts = preview && (stage === 'uploaded' || stage === 'mapping') ? { valid: 0, returns: 0, rejected: 0, total: preview.rows } : countsOf(summary)
    setDistrict('data', {
      stage,
      counts,
      fields: Object.entries(fields).map(([key, f]) => ({
        key,
        required: f.required,
        mapped: preview ? !!mapping[key] : !!dataset?.meta.mapping?.[key],
      })),
    })
  }, [stage, preview, mapping, result, dataset, fields])

  const reset = () => {
    setPreview(null)
    setResult(null)
    setMapping({})
    setStage(dataset?.has_data ? 'loaded' : 'empty')
  }

  return (
    <>
      <ol className="stepper" aria-label="Import progress">
        {STEPS.map((s, i) => {
          const cur = STEP_OF[stage]
          const cls = stage === 'failed' && i === 4 ? 'is-failed' : i < cur ? 'is-done' : i === cur ? 'is-current' : ''
          return (
            <li key={s} className={cls} aria-current={i === cur ? 'step' : undefined}>
              {s}
            </li>
          )
        })}
      </ol>
      <p className="muted small" role="status" style={{ marginTop: 10 }}>{STAGE_HELP[stage]}</p>
      <SceneHint>Cubes are your rows in proportion: ivory valid, wine returns, rose rejected.</SceneHint>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Data management" />
      {tab === 'import' && (
        <ImportTab
          preview={preview}
          setPreview={(p) => {
            setPreview(p)
            setResult(null)
            setMapping(p?.suggested_mapping ?? {})
            setStage(p ? 'mapping' : dataset?.has_data ? 'loaded' : 'empty')
          }}
          mapping={mapping}
          setMapping={setMapping}
          stage={stage}
          setStage={setStage}
          result={result}
          onResult={(r, ok) => {
            setResult(r)
            setStage(ok ? 'imported' : 'failed')
            if (ok) {
              setPreview(null)
              refresh()
            }
          }}
          onReset={reset}
        />
      )}
      {tab === 'current' && <CurrentTab />}
      {tab === 'demo' && <DemoTab onLoaded={() => (reset(), refresh(), setTab('current'))} />}
    </>
  )
}

function ImportTab(props: {
  preview: ImportPreview | null
  setPreview: (p: ImportPreview | null) => void
  mapping: Record<string, string | null>
  setMapping: (m: Record<string, string | null>) => void
  stage: DataStage
  setStage: (s: DataStage) => void
  result: ImportResult | null
  onResult: (r: ImportResult, ok: boolean) => void
  onReset: () => void
}) {
  const { meta } = useDataset()
  const { preview, mapping, setMapping, stage } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [options, setOptions] = useState<CleaningOptions>({ return_invoice_prefix: 'C', dayfirst: false, drop_zero_price: true })
  const input = useRef<HTMLInputElement>(null)
  const fields = meta?.standard_fields ?? {}
  const maxMb = meta?.max_upload_mb ?? 0

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setBusy(true)
    props.setStage('uploaded')
    try {
      props.setPreview(await api.importPreview(file))
    } catch (e) {
      props.setPreview(null)
      setError(e instanceof Error ? e.message : 'The file could not be read.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void upload(e.dataTransfer.files[0])
  }

  const missing = Object.entries(fields).filter(([k, f]) => f.required && !mapping[k]).map(([, f]) => f.label)
  const customised =
    !!preview &&
    (JSON.stringify(mapping) !== JSON.stringify(preview.suggested_mapping) ||
      options.return_invoice_prefix !== 'C' || options.dayfirst || !options.drop_zero_price)

  const runImport = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    props.setStage('importing')
    try {
      const r = await api.importCommit(preview.upload_id, mapping, options)
      props.onResult(r, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.')
      props.onResult({ backup_created: false, detail: e instanceof ApiError ? e.message : undefined }, false)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <TabPanel id="import">
      {!preview && (
        <>
          <p className="muted small" style={{ marginTop: 20 }}>
            One row per item sold, as CSV or Excel (.xlsx), up to {maxMb} MB. Required: invoice ID, customer ID, date, quantity
            and unit price. Compatible with the UCI Online Retail datasets.
          </p>
          <label
            className={`drop${over ? ' is-over' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <strong>{busy ? 'Reading the file…' : 'Drop a transaction file here'}</strong>
            <span className="small">or choose one from this computer</span>
            <input ref={input} type="file" accept=".csv,.txt,.xlsx,.xlsm" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          <div className="actions">
            <button type="button" className="btn" onClick={() => saveBlob(toCsv(TEMPLATE.columns, TEMPLATE.data), 'customeriq_template.csv')}>
              Download a CSV template
            </button>
          </div>
        </>
      )}
      {error && <p className="status-line is-bad" role="alert">{error}</p>}
      {stage === 'imported' && props.result && (
        <Section title="Import complete">
          <p className="status-line is-ok" role="status">
            Imported {fmtWhole(props.result.summary?.clean_rows)} transaction lines.
            {props.result.backup_created ? ' The previous dataset was backed up first.' : ''}
          </p>
          {props.result.summary && <SummaryFigures s={props.result.summary} />}
          <div className="actions">
            <Link className="btn btn--solid" to="/">See the overview</Link>
            <button type="button" className="btn" onClick={props.onReset}>Import another file</button>
          </div>
        </Section>
      )}

      {preview && (
        <>
          <Section title={`1 · ${preview.filename}`} aside={<button type="button" className="linkish" onClick={props.onReset}>Choose another file</button>}>
            <p className="muted small">
              {fmtWhole(preview.rows)} rows · {preview.columns.length} columns. CustomerIQ suggested a column for each field;
              correct any that are wrong.
            </p>
            <div className="form-grid">
              {Object.entries(fields).map(([key, f]) => (
                <label key={key} className="field field--stack">
                  <span className="field__label">
                    {f.label}
                    {f.required ? ' *' : ''}
                  </span>
                  <select
                    value={mapping[key] ?? ''}
                    onChange={(e) => (setMapping({ ...mapping, [key]: e.target.value || null }), props.setStage('mapping'))}
                  >
                    <option value="">(not mapped)</option>
                    {preview.columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {missing.length > 0 && <p className="status-line is-bad">Map the required fields: {missing.join(', ')}.</p>}
          </Section>

          <Section title="2 · Cleaning options">
            <div className="form-grid">
              <label className="check">
                <input type="checkbox" checked={options.dayfirst} onChange={(e) => setOptions({ ...options, dayfirst: e.target.checked })} />
                Dates are day-first (DD/MM/YYYY)
              </label>
              <label className="check">
                <input type="checkbox" checked={options.drop_zero_price} onChange={(e) => setOptions({ ...options, drop_zero_price: e.target.checked })} />
                Exclude zero-price lines
              </label>
              <label className="field field--stack">
                <span className="field__label">Cancellation invoice prefix</span>
                <input
                  className="input"
                  maxLength={5}
                  value={options.return_invoice_prefix}
                  onChange={(e) => setOptions({ ...options, return_invoice_prefix: e.target.value.replace(/[^A-Za-z0-9-]/g, '') })}
                />
              </label>
            </div>
          </Section>

          <Section title="3 · Validation">
            {preview.validation.error ? (
              <p className="status-line is-bad">{preview.validation.error}</p>
            ) : preview.validation.summary ? (
              <>
                <SummaryFigures s={preview.validation.summary} />
                <Rejections counts={preview.validation.rejected_by_reason ?? {}} />
                {!!preview.validation.warnings?.length && (
                  <ul className="warnlist">{preview.validation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                )}
              </>
            ) : null}
            <p className="muted small">
              {customised
                ? 'This preview used the suggested columns and default options. The import re-validates with your choices and reports the exact result.'
                : 'Validated with the suggested columns and default cleaning options.'}
            </p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => props.setStage('validated')} disabled={stage === 'validated'}>
                <ThreeDOnlyText scene="Show the validation in the scene" std="Mark validation as reviewed" />
              </button>
            </div>
          </Section>

          <Section title="4 · Import">
            <label className="check">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              Replace the current dataset with this file. A verified backup is taken first.
            </label>
            <div className="actions">
              <button type="button" className="btn btn--solid" disabled={!confirm || busy || missing.length > 0} onClick={runImport}>
                {busy ? 'Importing…' : 'Import and replace current dataset'}
              </button>
            </div>
            {stage === 'failed' && props.result?.detail && <p className="status-line is-bad">{props.result.detail}</p>}
          </Section>
        </>
      )}
    </TabPanel>
  )
}

function SummaryFigures({ s }: { s: CleaningSummary }) {
  return (
    <Figures
      items={[
        { label: 'Rows read', value: fmtWhole(s.input_rows) },
        { label: 'Valid sales lines', value: fmtWhole(s.sales_rows) },
        { label: 'Return lines', value: fmtWhole(s.return_rows), note: 'kept and analysed as returns' },
        { label: 'Rejected rows', value: fmtWhole(s.rejected_rows) },
        { label: 'Customers', value: fmtWhole(s.customers) },
        { label: 'Date range', value: <span className="small">{fmtDate(s.date_min)} – {fmtDate(s.date_max)}</span> },
      ]}
    />
  )
}

function Rejections({ counts }: { counts: Record<string, number> }) {
  const items = Object.entries(counts).filter(([, v]) => v > 0)
  if (!items.length) return <p className="status-line is-ok">No rows were rejected.</p>
  return (
    <div style={{ marginTop: 20 }}>
      <BarList
        caption="Rows excluded by rule"
        items={items.map(([k, v]) => ({ key: k, label: REJECTION_REASONS[k] ?? k, value: v, display: fmtWhole(v), color: SERIES[1] }))}
      />
    </div>
  )
}

function CurrentTab() {
  const { dataset, refresh, refreshing } = useDataset()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [rejected, reload] = useAsync((signal) => (dataset?.has_data ? api.rejected(100, signal) : Promise.resolve(null)), [dataset?.version])
  const rejectedRows = useMemo(
    () => (rejected.state === 'done' ? rows<{ source_row: number; reason: string; raw: string }>(rejected.data) : []),
    [rejected],
  )
  if (!dataset) return null
  // Right after an import, demo load or clear the context still holds the previous dataset for a moment;
  // never show it (or offer to clear it) as if it were the one loaded now.
  if (refreshing) {
    return (
      <TabPanel id="current">
        <Loading label="Reading the updated dataset" />
      </TabPanel>
    )
  }
  if (!dataset.has_data) {
    return (
      <TabPanel id="current">
        {msg && <p className="status-line" role="status">{msg}</p>}
        <p className="lede">No dataset is loaded. Import a file or load the demo data.</p>
      </TabPanel>
    )
  }
  const { meta, overview: ov } = dataset
  const clear = async () => {
    setBusy(true)
    setMsg('')
    try {
      const r = await api.clearDataset()
      setMsg(r.backup_created ? 'Dataset cleared. A verified backup was taken first.' : 'Dataset cleared.')
      refresh()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'The dataset could not be cleared.')
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <TabPanel id="current">
      {meta.is_synthetic && (
        <p className="status-line">
          {meta.data_label ?? 'Synthetic demo data'}
          {/not real/i.test(meta.data_label ?? '') ? '.' : ': generated for demonstration, not real customers.'}
        </p>
      )}
      <Figures
        items={[
          { label: 'Source', value: <span className="small">{meta.source_name ?? '—'}</span>, note: meta.loaded_at ? `Loaded ${fmtDate(meta.loaded_at)}` : undefined },
          { label: 'Transaction lines', value: fmtWhole(ov.total_rows) },
          { label: 'Customers', value: fmtWhole(ov.customers) },
          { label: 'Sales invoices', value: fmtWhole(ov.sales_invoices) },
          { label: 'Products', value: fmtWhole(ov.products) },
          { label: 'Date range', value: <span className="small">{fmtDate(ov.first_date)} – {fmtDate(ov.last_date)}</span> },
        ]}
      />
      {meta.cleaning_summary && (
        <Section title="Import validation summary">
          <SummaryFigures s={meta.cleaning_summary} />
          <Rejections counts={meta.cleaning_summary.rejection_counts ?? {}} />
          {meta.warnings?.length ? <ul className="warnlist">{meta.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted small">No warnings.</p>}
        </Section>
      )}
      <Section title="Rejected rows · first 100">
        {rejected.state === 'loading' && <Loading label="Reading rejected rows" />}
        {rejected.state === 'error' && <ErrorPanel error={rejected.error} onRetry={reload} />}
        {rejected.state === 'done' &&
          (rejectedRows.length ? (
            <DataTable
              caption="Rejected source rows"
              rows={rejectedRows}
              rowKey={(r) => `${r.source_row}-${r.reason}`}
              maxHeight={300}
              columns={[
                { key: 'row', label: 'Source row', render: (r) => r.source_row, numeric: true },
                { key: 'reason', label: 'Rule', render: (r) => REJECTION_REASONS[r.reason] ?? r.reason },
                { key: 'raw', label: 'Original values', render: (r) => <code className="small">{String(r.raw).slice(0, 120)}</code> },
              ]}
            />
          ) : (
            <p className="muted small">None.</p>
          ))}
      </Section>
      <Section title="Clear dataset">
        <label className="check">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I understand this removes the loaded dataset from the local database.
        </label>
        <div className="actions">
          <button type="button" className="btn btn--danger" disabled={!confirm || busy} onClick={clear}>
            {busy ? 'Clearing…' : 'Clear dataset'}
          </button>
        </div>
        {msg && <p className="status-line" role="status">{msg}</p>}
      </Section>
    </TabPanel>
  )
}

function DemoTab({ onLoaded }: { onLoaded: () => void }) {
  const [seed, setSeed] = useState(20240101)
  const [customers, setCustomers] = useState(1600)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const valid = seed >= 1 && seed <= 99_999_999 && customers >= 200 && customers <= 6000
  const load = async () => {
    setBusy(true)
    setMsg('')
    try {
      await api.loadDemo(seed, customers)
      onLoaded()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'The demo dataset could not be loaded.')
    } finally {
      setBusy(false)
    }
  }
  const downloadRaw = async () => {
    setBusy(true)
    setMsg('')
    try {
      await api.demoRawCsv(seed, customers)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'The raw demo file could not be downloaded.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <TabPanel id="demo">
      <p className="muted" style={{ marginTop: 20, maxWidth: '60ch' }}>
        The demo dataset is synthetic: a deterministic generator simulates an online homeware retailer with customer personas,
        churn, seasonal peaks, partial returns and a few deliberate data-quality problems for the cleaning rules to catch. It
        is labelled as synthetic everywhere, including reports.
      </p>
      <div className="form-grid">
        <label className="field field--stack">
          <span className="field__label">Random seed (same seed, same data)</span>
          <input className="input" type="number" min={1} max={99999999} value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>
        <label className="field field--stack">
          <span className="field__label">Customers to simulate (200–6,000)</span>
          <input className="input" type="number" min={200} max={6000} step={100} value={customers} onChange={(e) => setCustomers(Number(e.target.value))} />
        </label>
      </div>
      <label className="check" style={{ marginTop: 16 }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        Replace the current dataset with synthetic demo data. A verified backup is taken first.
      </label>
      <div className="actions">
        <button type="button" className="btn btn--solid" disabled={!confirm || busy || !valid} onClick={load}>
          {busy ? 'Generating…' : 'Load synthetic demo dataset'}
        </button>
        <button type="button" className="btn" disabled={busy || !valid} onClick={downloadRaw}>
          Download raw synthetic CSV
        </button>
      </div>
      {msg && <p className="status-line is-bad" role="alert">{msg}</p>}
    </TabPanel>
  )
}

function ThreeDOnlyText(props: { scene: string; std: string }) {
  return (
    <>
      <ThreeDOnly>{props.scene}</ThreeDOnly>
      {useIsStandard() && props.std}
    </>
  )
}

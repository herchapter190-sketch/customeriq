import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, pending, saveBlob } from '../api/client'
import { toCsv } from '../lib/csv'
import { CURRENCIES, PRESETS, useDataset, type Preset } from '../lib/dataset'
import { useAsync } from '../lib/hooks'
import { segmentColor, SEGMENTS } from '../lib/domain'
import { ROUTES } from '../routes'
import { useScene } from '../scene/store'
import { useIsStandard } from '../lib/viewMode'
import { ErrorPanel, Loading, Notice } from './Status'

/* ------------------------------------------------------------------ page head */

export function PageHead({ slug, children, lede }: { slug: string; children: ReactNode; lede?: ReactNode }) {
  const i = ROUTES.findIndex((r) => r.slug === slug)
  const route = ROUTES[i]
  return (
    <header className="page-head">
      <p className="eyebrow">{route?.title}</p>
      <h1 className="display">{children}</h1>
      {lede && <p className="lede">{lede}</p>}
    </header>
  )
}

/** Wraps a page's data: waits for dataset info, explains an empty database. */
export function DatasetGate({ children, allowEmpty = false }: { children: ReactNode; allowEmpty?: boolean }) {
  const { dataset, error, refresh } = useDataset()
  if (error) return <ErrorPanel error={error} onRetry={refresh} />
  if (!dataset) return <Loading label="Reading the dataset" />
  if (!dataset.has_data && !allowEmpty) {
    return (
      <Notice title="No dataset is loaded yet">
        <p>Load the demo dataset or import your own file, then come back to this view.</p>
        <Link className="btn btn--solid" to="/data">
          Open Data Management
        </Link>
      </Notice>
    )
  }
  return <>{children}</>
}

/* ------------------------------------------------------------------ filters */

/** The Streamlit sidebar as one bar: period (presets or a custom window), segments, currency
 *  and the reset / refresh actions. Every analytical page shares it, so a change follows the reader. */
export function FilterBar({ segments = true }: { segments?: boolean }) {
  const d = useDataset()
  const { dataset, preset, setPreset, setRange, segments: picked, setSegments, window: [start, end] } = d
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const id = useId()
  const [lo, hi] = dataset?.bounds ?? [null, null]
  const names = Object.keys(SEGMENTS)
  const toggle = (s: string) => setSegments(picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s])
  const say = (text: string) => {
    setNote(text)
    window.setTimeout(() => setNote((n) => (n === text ? '' : n)), 3500)
  }
  const onDate = (which: 0 | 1, v: string) => {
    if (!v || !start || !end) return
    const next: [string, string] = which === 0 ? [v, end] : [start, v]
    if (next[0] > next[1]) return say('The start date must be on or before the end date.')
    setRange(next[0], next[1])
  }
  return (
    <section className="filters" aria-label="Filters">
      <div className="filters__row">
        <label className="field">
          <span className="field__label">Period</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => (
              <option key={p}>{p}</option>
            ))}
            {preset === 'Custom' && <option>Custom</option>}
          </select>
        </label>
        <div className="filters__dates" role="group" aria-label="Date range" title="Analyses use the transaction dates in your file. Pick a preset or type exact dates.">
          <span className="field__label">From</span>
          <input type="date" aria-label="Start date" value={start ?? ''} min={lo ?? undefined} max={end ?? undefined} onChange={(e) => onDate(0, e.target.value)} />
          <span className="field__label">to</span>
          <input type="date" aria-label="End date" value={end ?? ''} min={start ?? undefined} max={hi ?? undefined} onChange={(e) => onDate(1, e.target.value)} />
        </div>
        {segments && (
          <div className="field">
            <span className="field__label" id={`${id}-l`}>Customer groups</span>
            <button type="button" className="chip" aria-expanded={open} aria-controls={id} aria-describedby={`${id}-l`} onClick={() => setOpen((o) => !o)} title="Limit every view to chosen RFM segments, such as Champions or At Risk.">
              {picked.length ? `${picked.length} segment${picked.length > 1 ? 's' : ''} ▾` : 'All segments ▾'}
            </button>
          </div>
        )}
        <label className="field">
          <span className="field__label">Currency</span>
          <select value={d.currency} onChange={(e) => d.setCurrency(e.target.value)} title="Set from your file when it names one currency; otherwise amounts are plain numbers until you pick one. Display only: nothing is converted.">
            {CURRENCIES.map((c) => (
              <option key={c.label} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="filters__meta">
        <p className="filters__badge">
          {dataset?.meta.is_synthetic ? (
            <span title="Generated by CustomerIQ to show how it works. Findings describe a simulated shop, not a real business.">Synthetic demo data</span>
          ) : (
            <span className="is-real" title="Rows from a file you imported.">Your imported data</span>
          )}
          Source: {dataset?.meta.source_name ?? 'unknown'}
        </p>
        <div className="filters__actions">
          <button type="button" className="linkish" onClick={() => (d.resetFilters(), say('All dates and all segments again.'))}>Reset filters</button>
          <button type="button" className="linkish" onClick={() => (d.refresh(), say('Data re-read from the database.'))}>Refresh data</button>
          <button type="button" className="linkish" onClick={() => (d.resetAll(), say('Settings restored to defaults. Your data was not changed.'))} title="Filters, scoring rules, inactivity rules, currency and animations back to their defaults. Your data is not touched.">Reset everything</button>
        </div>
      </div>
      <Updating />
      {note && <p className="filters__note" role="status">{note}</p>}
      {segments && open && (
        <fieldset id={id} className="filters__segments">
          <legend className="sr-only">Customer segments</legend>
          {names.map((s) => (
            <label key={s} className={`seg-toggle${picked.includes(s) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={picked.includes(s)} onChange={() => toggle(s)} />
              <span className="seg-dot" style={{ background: segmentColor(s) }} aria-hidden="true" />
              {s}
            </label>
          ))}
          {picked.length > 0 && (
            <button type="button" className="linkish" onClick={() => setSegments([])}>
              Clear
            </button>
          )}
        </fieldset>
      )}

    </section>
  )
}

function Updating() {
  const n = useSyncExternalStore(pending.subscribe, pending.get)
  return <span className={`updating${n > 0 ? ' is-on' : ''}`} aria-hidden={n === 0}>Updating…</span>
}

/* ------------------------------------------------------------------ table helpers */

/** Case-insensitive search across a few text columns (Streamlit components.search_filter). */
export function searchRows<T>(list: T[], query: string, cols: (keyof T)[]): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((r) => cols.some((c) => String(r[c] ?? '').toLowerCase().includes(q)))
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="field field--grow">
      <span className="field__label">{label}</span>
      <input className="input" type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Download the rows a table currently shows, as formula-safe CSV (same rules as safe_export.py). */
export function CsvButton<T extends object>({ rows, name, label = 'Download CSV' }: { rows: T[]; name: string; label?: string }) {
  if (!rows.length) return null
  const cols = Object.keys(rows[0]) as (keyof T)[]
  return (
    <button
      type="button"
      className="btn btn--small"
      onClick={() => saveBlob(toCsv(cols.map(String), rows.map((r) => cols.map((c) => r[c]))), name)}
    >
      {label} ({rows.length.toLocaleString('en')} rows)
    </button>
  )
}

/** Small multi-toggle (pills) used by table filters. */
export function Pills({ options, value, onChange, label }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="pills" role="group" aria-label={label}>
      <span className="field__label">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" className="chip chip--small" aria-pressed={value.includes(o)} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** First API insight in the given categories, shown as a one-line takeaway (Streamlit story.takeaway). */
export function Takeaway({ categories }: { categories: string[] }) {
  const { filters, key, currency } = useDataset()
  const [res] = useAsync((signal) => api.analytics('insights', filters, signal, currency ? { currency } : {}), [key, currency])
  if (res.state !== 'done') return null
  const ins = res.data.find((i) => categories.includes(i.category))
  if (!ins) return null
  return (
    <aside className={`takeaway is-${ins.kind}`} aria-label="Key finding">
      <p className="takeaway__meta">
        {ins.category.toLowerCase() === ins.kind.toLowerCase() ? ins.category : `${ins.category} · ${ins.kind}`}
      </p>
      <p className="takeaway__title">{ins.title}</p>
      <p className="takeaway__action"><span>Action</span> {ins.action}</p>
    </aside>
  )
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="details">
      <summary>{summary}</summary>
      <div className="details__body">{children}</div>
    </details>
  )
}

/* ------------------------------------------------------------------ tabs */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + tabs.length) % tabs.length
    onChange(tabs[n].id)
    refs.current[n]?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => void (refs.current[i] = el)}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className="tabs__tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="tabpanel">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ bars + tables */

export interface BarItem {
  key: string
  label: ReactNode
  value: number
  display: string
  color?: string
  note?: ReactNode
}

/** Horizontal bars on one shared scale; values are printed, so colour is never the only cue. */
export function BarList({
  items,
  max,
  onSelect,
  selected,
  caption,
}: {
  items: BarItem[]
  max?: number
  onSelect?: (key: string) => void
  selected?: string | null
  caption?: string
}) {
  const top = max ?? Math.max(1e-9, ...items.map((i) => Math.abs(i.value)))
  return (
    <figure className="bars">
      {caption && <figcaption className="bars__caption">{caption}</figcaption>}
      <ul className="bars__list">
        {items.map((it) => {
          const body = (
            <>
              <span className="bars__label">
                {it.color && <span className="seg-dot" style={{ background: it.color }} aria-hidden="true" />}
                {it.label}
              </span>
              <span className="bars__value">{it.display}</span>
              <span className="bars__track" aria-hidden="true">
                <span
                  className="bars__fill"
                  style={{ width: `${Math.max(0.6, (Math.abs(it.value) / top) * 100)}%`, background: it.color }}
                />
              </span>
              {it.note && <span className="bars__note">{it.note}</span>}
            </>
          )
          return (
            <li key={it.key} className={selected === it.key ? 'is-selected' : undefined}>
              {onSelect ? (
                <button type="button" className="bars__row" aria-pressed={selected === it.key} onClick={() => onSelect(it.key)}>
                  {body}
                </button>
              ) : (
                <div className="bars__row">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

export interface Column<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
  numeric?: boolean
}

export function DataTable<T>({
  rows,
  columns,
  caption,
  rowKey,
  onRow,
  selected,
  maxHeight = 380,
}: {
  rows: T[]
  columns: Column<T>[]
  caption: string
  rowKey: (row: T) => string
  onRow?: (row: T) => void
  selected?: string | null
  maxHeight?: number
}) {
  return (
    <div className="table-wrap" style={{ maxHeight }} tabIndex={0} role="region" aria-label={caption}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r)
            return (
              <tr
                key={k}
                className={`${onRow ? 'is-clickable' : ''}${selected === k ? ' is-selected' : ''}`}
                onClick={onRow ? () => onRow(r) : undefined}
                onKeyDown={onRow ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRow(r)) : undefined}
                tabIndex={onRow ? 0 : undefined}
                aria-selected={onRow ? selected === k : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Compact figures row (label above, serif number below). */
export function Figures({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="figures">
      {items.map((f) => (
        <div key={f.label} className="figures__item">
          <dt>{f.label}</dt>
          <dd className="figures__value">{f.value}</dd>
          {f.note && <dd className="figures__note">{f.note}</dd>}
        </div>
      ))}
    </dl>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId()
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Tells the reader how to use the 3D scene (or that the 2D view is active). */
export function SceneHint({ children }: { children: ReactNode }) {
  const mode = useScene((s) => s.mode)
  if (useIsStandard()) return null
  return <p className="scene-hint">{mode === 'webgl' ? children : '3D is unavailable here, so every value is listed below.'}</p>
}

/** Content only for Standard Analytics (2D charts) or only for 3D Exploration. */
export function StandardOnly({ children }: { children: ReactNode }) {
  return useIsStandard() ? <>{children}</> : null
}
export function ThreeDOnly({ children }: { children: ReactNode }) {
  return useIsStandard() ? null : <>{children}</>
}

/** Lays sections side by side in Standard Analytics; in 3D they stay one narrow column. */
export function StdGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return useIsStandard() ? <div className={`grid grid--sections${cols === 2 ? ' grid--2' : ''}`}>{children}</div> : <>{children}</>
}

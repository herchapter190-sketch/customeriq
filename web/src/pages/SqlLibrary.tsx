import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, saveBlob } from '../api/client'
import { rows, type SqlResult } from '../api/types'
import { ErrorPanel, Loading, SessionGate } from '../components/Status'
import { DatasetGate, DataTable, FilterBar, PageHead, SceneHint, Section } from '../components/ui'
import { toCsv } from '../lib/csv'
import { useDataset } from '../lib/dataset'
import { SQL_DOCS, SQL_FAMILY_COLORS, type SqlFamily } from '../lib/domain'
import { fmtWhole } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { patchDistrict, sceneStore, setDistrict, setFocus, useFocus } from '../scene/store'

const FAMILIES: SqlFamily[] = ['Revenue', 'Customers', 'Retention', 'Behaviour', 'Dataset']
/** Queries whose file binds :customer_id (from the query headers). */
const NEEDS_CUSTOMER = new Set(['customer_orders'])

export default function SqlLibrary() {
  return (
    <div className="env env--sql">
      <PageHead slug="sql" lede="The documented SQL behind every analysis, run read-only against the current filters. Only these fixed files can run; there is no free-form SQL.">
        The queries behind each analysis
      </PageHead>
      <SessionGate>
        <DatasetGate>
          <FilterBar />
          <SqlData />
        </DatasetGate>
      </SessionGate>
    </div>
  )
}

function SqlData() {
  const [list, reload] = useAsync((signal) => api.sqlList(signal), [])
  const queries = useMemo(() => {
    if (list.state !== 'done') return []
    const famOf = (n: string) => SQL_DOCS[n]?.family ?? 'Dataset'
    return [...list.data.queries].sort(
      (a, b) => FAMILIES.indexOf(famOf(a.name)) - FAMILIES.indexOf(famOf(b.name)) || a.name.localeCompare(b.name),
    )
  }, [list])

  useEffect(() => {
    if (!queries.length) return
    setDistrict('sql', {
      names: queries.map((q) => q.name),
      families: queries.map((q) => SQL_DOCS[q.name]?.family ?? 'Dataset'),
      resultRows: null,
      running: false,
    })
    if (!queries.some((q) => q.name === sceneStore.get().focus.sql)) setFocus('sql', queries.find((q) => q.name === 'repeat_purchase')?.name ?? queries[0].name)
  }, [queries])
  useEffect(() => () => setFocus('sql', null), [])

  if (list.state === 'loading') return <Loading label="Reading the query library" />
  if (list.state === 'error') return <ErrorPanel error={list.error} onRetry={reload} />
  return <SqlBody queries={queries} />
}

function SqlBody({ queries }: { queries: { name: string; sql?: string }[] }) {
  const focus = useFocus('sql') as string | null
  const { filters, key } = useDataset()
  const [customer, setCustomer] = useState('')
  const [run, setRun] = useState<{ name: string; key: string; result?: SqlResult; error?: unknown; busy: boolean } | null>(null)
  const q = queries.find((x) => x.name === focus) ?? queries[0]
  const doc = SQL_DOCS[q.name]
  const needsCustomer = NEEDS_CUSTOMER.has(q.name) || !!q.sql?.includes(':customer_id')
  const current = run && run.name === q.name && run.key === key ? run : null

  useEffect(() => {
    patchDistrict('sql', { resultRows: current?.result ? current.result.rows : null, running: !!current?.busy })
  }, [current])

  const execute = async () => {
    const id = customer.trim()
    const base = { name: q.name, key, busy: true }
    setRun(base)
    try {
      setRun({ ...base, busy: false, result: await api.sqlRun(q.name, filters, needsCustomer ? id : undefined) })
    } catch (error) {
      setRun({ ...base, busy: false, error })
    }
  }

  return (
    <>
      <SceneHint>Each slab is one query file, edged by family. Select one here or in the scene; running it lays one line of light per returned row.</SceneHint>
      <div className="sql-columns">
        <nav aria-label="Query library">
          {FAMILIES.map((fam) => {
            const items = queries.filter((x) => (SQL_DOCS[x.name]?.family ?? 'Dataset') === fam)
            if (!items.length) return null
            return (
              <div key={fam}>
                <p className="sql-index__fam">
                  <span className="seg-dot" style={{ background: SQL_FAMILY_COLORS[fam] }} aria-hidden="true" /> {fam}
                </p>
                <ul className="sql-index">
                  {items.map((x) => (
                    <li key={x.name}>
                      <button type="button" aria-current={x.name === q.name} onClick={() => setFocus('sql', x.name)}>
                        {x.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <p className="muted small" style={{ marginTop: 14 }}>{queries.length} queries</p>
        </nav>

        <div>
          <h2 className="profile__title" style={{ fontFamily: 'var(--mono)', fontSize: '1.25rem' }}>{q.name}</h2>
          <dl className="doc-list">
            <dt>Purpose</dt>
            <dd>{doc?.purpose ?? 'Documented in the query file header.'}</dd>
            <dt>Techniques</dt>
            <dd>{doc?.techniques ?? '—'}</dd>
            <dt>Parameters</dt>
            <dd>Period and segment filters, bound as parameters{needsCustomer ? ', plus one customer ID' : ''}.</dd>
          </dl>
          {q.sql ? (
            <pre className="code" tabIndex={0} aria-label={`SQL for ${q.name}`}>{highlight(q.sql)}</pre>
          ) : (
            <p className="muted small" style={{ marginTop: 14 }}>
              The SQL text stays on the server (the API runs with SQL text hidden). It can be read in src/sql/queries/{q.name}.sql
              or in the Streamlit SQL Library.
            </p>
          )}
          {needsCustomer && (
            <label className="field field--stack" style={{ marginTop: 16, maxWidth: 260 }}>
              <span className="field__label">Customer ID (required)</span>
              <input className="input" value={customer} maxLength={64} onChange={(e) => setCustomer(e.target.value)} />
            </label>
          )}
          <div className="actions">
            <button type="button" className="btn btn--solid" disabled={current?.busy || (needsCustomer && !customer.trim())} onClick={execute}>
              {current?.busy ? 'Running…' : 'Run with current filters'}
            </button>
            {current?.result && current.result.rows > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => saveBlob(toCsv(current.result!.result.columns, current.result!.result.data), `${q.name}.csv`)}
              >
                Download result (CSV)
              </button>
            )}
          </div>
        </div>
      </div>

      {current?.error != null && <ErrorPanel error={current.error} onRetry={execute} />}
      {current?.result && <Result name={q.name} result={current.result} />}
    </>
  )
}

function Result({ name, result }: { name: string; result: SqlResult }) {
  const data = rows<Record<string, unknown>>(result.result)
  const cols = result.result.columns
  return (
    <Section title={`Result · ${fmtWhole(result.rows)} rows`}>
      {result.truncated && <p className="muted small">Showing the first {fmtWhole(data.length)} rows; the CSV holds the same rows.</p>}
      {data.length === 0 ? (
        <p className="muted">The query ran successfully but returned no rows for the current filters.</p>
      ) : (
        <DataTable
          caption={`Result of ${name}`}
          rows={data.map((r, i) => ({ ...r, __i: i }))}
          rowKey={(r) => String(r.__i)}
          columns={cols.map((c) => ({
            key: c,
            label: c,
            numeric: typeof data[0][c] === 'number',
            render: (r: Record<string, unknown>) => fmtCell(r[c]),
          }))}
        />
      )}
    </Section>
  )
}

function fmtCell(v: unknown): ReactNode {
  if (v == null) return <span className="muted">—</span>
  if (typeof v === 'number') return Number.isInteger(v) ? fmtWhole(v) : v.toLocaleString('en', { maximumFractionDigits: 2 })
  return String(v)
}

/** Minimal, safe SQL highlighting (React text nodes only; nothing is injected as HTML). */
const KW = /\b(SELECT|FROM|WHERE|WITH|AS|JOIN|LEFT|INNER|ON|GROUP|BY|ORDER|HAVING|CASE|WHEN|THEN|ELSE|END|AND|OR|NOT|IN|DISTINCT|OVER|PARTITION|WINDOW|UNION|ALL|LIMIT|DESC|ASC|COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|PERCENT_RANK|VALUES|IS|NULL|BETWEEN|LIKE|CAST|ROUND)\b/i
function highlight(sql: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(--[^\n]*)|(:[a-z_]+)|([A-Za-z_]+)|([^A-Za-z_:-]+|-|:)/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(sql))) {
    if (m[1]) out.push(<span key={i++} className="cm">{m[1]}</span>)
    else if (m[2]) out.push(<span key={i++} className="pm">{m[2]}</span>)
    else if (m[3] && KW.test(m[3])) out.push(<span key={i++} className="kw">{m[3]}</span>)
    else out.push(m[0])
  }
  return out
}

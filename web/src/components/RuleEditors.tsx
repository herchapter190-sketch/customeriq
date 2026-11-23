import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { Filters, RfmRules, RiskRules } from '../api/types'
import { useDataset } from '../lib/dataset'
import { Details } from './ui'

/**
 * Editors for the configurable rules (Streamlit: segmentation.py `_config_editor`, inactive.py
 * `_threshold_editor`). The API validates every rule set (src/config.py `validate`); a set is only
 * applied after the API accepted it, and its own message is shown when it does not.
 */
async function check(filters: Filters): Promise<string | null> {
  try {
    await api.analytics('risk_summary', filters)
    return null
  } catch (e) {
    return e instanceof ApiError ? e.message : 'The rules could not be checked.'
  }
}

const list = (v: readonly number[]) => v.join(', ')
function parseFour(text: string): number[] | null {
  const parts = text.split(',').map((x) => x.trim()).filter(Boolean)
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  return nums.every(Number.isFinite) ? nums : null
}

export function RfmEditor() {
  const { rfm, rules, setRfm, filters, meta } = useDataset()
  const cur = rules.rfm
  const [method, setMethod] = useState<RfmRules['method']>(cur?.method ?? 'quantile')
  const [rec, setRec] = useState(cur ? list(cur.recency_thresholds) : '')
  const [fre, setFre] = useState(cur ? list(cur.frequency_thresholds) : '')
  const [mon, setMon] = useState(cur ? list(cur.monetary_thresholds) : '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // Follow outside changes (e.g. "Reset everything") so the boxes always show the active rules.
  useEffect(() => {
    if (!cur) return
    setMethod(cur.method)
    setRec(list(cur.recency_thresholds))
    setFre(list(cur.frequency_thresholds))
    setMon(list(cur.monetary_thresholds))
  }, [cur])
  if (!cur) return null

  const apply = async (e: FormEvent) => {
    e.preventDefault()
    const r = parseFour(rec), f = parseFour(fre), m = parseFour(mon)
    if (!r || !f || !m) return setMsg({ ok: false, text: 'Scoring rules not applied: enter four ascending, comma-separated numbers in each box.' })
    const next: RfmRules = {
      method,
      recency_thresholds: r.map((x) => Math.trunc(x)) as RfmRules['recency_thresholds'],
      frequency_thresholds: f.map((x) => Math.trunc(x)) as RfmRules['frequency_thresholds'],
      monetary_thresholds: m as RfmRules['monetary_thresholds'],
    }
    setBusy(true)
    const err = await check({ ...filters, rfm: next })
    setBusy(false)
    if (err) return setMsg({ ok: false, text: `Scoring rules not applied: ${err}.` })
    setRfm(next)
    setMsg({ ok: true, text: 'Scoring rules applied to every page.' })
  }
  const restore = () => {
    const d = meta?.defaults.rfm
    setRfm(null)
    if (d) (setMethod(d.method), setRec(list(d.recency_thresholds)), setFre(list(d.frequency_thresholds)), setMon(list(d.monetary_thresholds)))
    setMsg({ ok: true, text: 'Default scoring rules restored.' })
  }

  return (
    <Details summary={`Scoring rules (configurable)${rfm ? ' · custom rules active' : ''}`}>
      <p className="small">
        Each customer receives a 1–5 score for Recency (days since last order), Frequency (distinct orders) and Monetary (net
        revenue). <strong>Quantile</strong> scoring ranks customers against each other with PERCENT_RANK() (ties share a score).{' '}
        <strong>Fixed</strong> scoring uses the absolute cut points below. Segments are then assigned by the ordered rules.
      </p>
      <form className="rules" onSubmit={apply} noValidate>
        <div className="chips" role="radiogroup" aria-label="Scoring method">
          {(['quantile', 'fixed'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
              {m === 'quantile' ? 'Quantile (relative)' : 'Fixed thresholds (absolute)'}
            </button>
          ))}
        </div>
        <p className="muted small">Fixed thresholds: four ascending cut points. Recency: at or below the first cut scores 5. Frequency and monetary: at or below the first cut scores 1.</p>
        <div className="rules__grid">
          <label className="field field--stack"><span className="field__label">Recency cut points (days)</span><input className="input" value={rec} onChange={(e) => setRec(e.target.value)} /></label>
          <label className="field field--stack"><span className="field__label">Frequency cut points (orders)</span><input className="input" value={fre} onChange={(e) => setFre(e.target.value)} /></label>
          <label className="field field--stack"><span className="field__label">Monetary cut points</span><input className="input" value={mon} onChange={(e) => setMon(e.target.value)} /></label>
        </div>
        <div className="actions">
          <button type="submit" className="btn btn--solid" disabled={busy}>{busy ? 'Checking…' : 'Apply scoring rules'}</button>
          <button type="button" className="btn" disabled={!rfm} onClick={restore}>Restore defaults</button>
        </div>
        {msg && <p className={`status-line ${msg.ok ? 'is-ok' : 'is-bad'}`} role="status">{msg.text}</p>}
      </form>
    </Details>
  )
}

export function RiskEditor() {
  const { risk, rules, setRisk, filters, meta } = useDataset()
  const cur = rules.risk
  const [v, setV] = useState<RiskRules | null>(cur)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(cur), [cur])
  if (!cur || !v) return null
  const num = (k: keyof RiskRules, label: string, min: number, max: number, step: number, help?: string) => (
    <label className="field field--stack" title={help}>
      <span className="field__label">{label}</span>
      <input className="input" type="number" min={min} max={max} step={step} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
    </label>
  )
  const apply = async (e: FormEvent) => {
    e.preventDefault()
    const next: RiskRules = {
      active_days: Math.trunc(v.active_days),
      cooling_days: Math.trunc(v.cooling_days),
      at_risk_days: Math.trunc(v.at_risk_days),
      overdue_multiplier: v.overdue_multiplier,
    }
    setBusy(true)
    const err = await check({ ...filters, risk: next })
    setBusy(false)
    if (err) return setMsg({ ok: false, text: `Rules not applied: ${err}.` })
    setRisk(next)
    setMsg({ ok: true, text: 'Inactivity rules applied to every page.' })
  }
  return (
    <Details summary={`Inactivity rules (days since last purchase)${risk ? ' · custom rules active' : ''}`}>
      <form className="rules" onSubmit={apply} noValidate>
        <div className="rules__grid rules__grid--4">
          {num('active_days', 'Active up to', 1, 3650, 5)}
          {num('cooling_days', 'Cooling up to', 2, 3650, 5)}
          {num('at_risk_days', 'At Risk up to', 3, 3650, 5, 'Customers beyond this are Lapsed.')}
          {num('overdue_multiplier', 'Overdue multiplier', 1, 10, 0.5, 'Repeat customers are overdue when days inactive exceed this multiple of their own average days between orders.')}
        </div>
        <div className="actions">
          <button type="submit" className="btn btn--solid" disabled={busy}>{busy ? 'Checking…' : 'Apply rules'}</button>
          <button
            type="button"
            className="btn"
            disabled={!risk}
            onClick={() => {
              setRisk(null)
              if (meta) setV(meta.defaults.risk)
              setMsg({ ok: true, text: 'Default inactivity rules restored.' })
            }}
          >
            Defaults
          </button>
        </div>
        {msg && <p className={`status-line ${msg.ok ? 'is-ok' : 'is-bad'}`} role="status">{msg.text}</p>}
      </form>
    </Details>
  )
}

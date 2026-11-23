import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { useSession } from '../api/session'
import type { ApiMeta, DatasetInfo, Filters, RfmRules, RiskRules } from '../api/types'
import { setCurrencySymbol } from './format'

/** Period presets, the same windows as the Streamlit sidebar (src/ui/state.py `_preset_range`). */
export const PRESETS = ['All data', 'Last 12 months', 'Last 6 months', 'Last 3 months', 'Year to date'] as const
export type Preset = (typeof PRESETS)[number] | 'Custom'

/** Display symbol only; nothing is converted (src/ui/state.py CURRENCIES). */
export const CURRENCIES = [
  { label: 'Not specified', value: '' },
  { label: '£ GBP', value: '£' },
  { label: '$ USD', value: '$' },
  { label: '€ EUR', value: '€' },
] as const

const DAY = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)

export function presetRange(preset: Preset, lo: string, hi: string): [string, string] {
  const end = parse(hi)
  let start: Date
  if (preset === 'Last 12 months') start = new Date(end.getTime() - 364 * DAY)
  else if (preset === 'Last 6 months') start = new Date(end.getTime() - 182 * DAY)
  else if (preset === 'Last 3 months') start = new Date(end.getTime() - 90 * DAY)
  else if (preset === 'Year to date') start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1))
  else start = parse(lo)
  const s = iso(start) < lo ? lo : iso(start)
  return [s, hi]
}

const MOTION_KEY = 'ciq.motion'
function readMotion(): boolean {
  try {
    return window.localStorage.getItem(MOTION_KEY) !== 'off'
  } catch {
    return true
  }
}

interface DatasetValue {
  dataset: DatasetInfo | null
  meta: ApiMeta | null
  error: unknown
  /** Re-read dataset + meta (after an import, demo load or clear, or "Refresh data"). */
  refresh: () => void
  preset: Preset
  setPreset: (p: Preset) => void
  /** Custom window (ISO dates) — setting it switches the preset to "Custom", as in Streamlit. */
  setRange: (start: string, end: string) => void
  segments: string[]
  setSegments: (s: string[]) => void
  currency: string
  setCurrency: (c: string) => void
  /** null = the API defaults (src/config.py RFMConfig / RiskConfig). */
  rfm: RfmRules | null
  setRfm: (r: RfmRules | null) => void
  risk: RiskRules | null
  setRisk: (r: RiskRules | null) => void
  /** Effective rules (custom or the API defaults). */
  rules: { rfm: RfmRules | null; risk: RiskRules | null }
  /** "Show animations" (Streamlit sidebar toggle); combined with prefers-reduced-motion. */
  motion: boolean
  setMotion: (m: boolean) => void
  resetFilters: () => void
  resetAll: () => void
  /** API filters for the current selection; stable identity while unchanged. */
  filters: Filters
  /** The effective analysis window (the API's defaults when no period is set). */
  window: [string | null, string | null]
  /** Stable key for effects that depend on the filters or dataset version. */
  key: string
}

const Ctx = createContext<DatasetValue | null>(null)

export function DatasetProvider({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const [dataset, setDataset] = useState<DatasetInfo | null>(null)
  const [meta, setMeta] = useState<ApiMeta | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)
  const [preset, setPresetState] = useState<Preset>('All data')
  const [custom, setCustom] = useState<[string, string] | null>(null)
  const [segments, setSegments] = useState<string[]>([])
  const [currency, setCurrency] = useState('')
  const [rfm, setRfm] = useState<RfmRules | null>(null)
  const [risk, setRisk] = useState<RiskRules | null>(null)
  const [motion, setMotionState] = useState(readMotion)

  useEffect(() => {
    if (status !== 'ready') return
    const c = new AbortController()
    Promise.all([api.dataset(c.signal), api.meta(c.signal)])
      .then(([d, m]) => {
        setDataset(d)
        setMeta(m)
        setError(null)
      })
      .catch((e: unknown) => !c.signal.aborted && setError(e))
    return () => c.abort()
  }, [status, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  const [lo, hi] = dataset?.bounds ?? [null, null]

  // A new dataset (different bounds) drops a custom window, like Streamlit's `_bounds` reset.
  useEffect(() => {
    setCustom(null)
    setPresetState((p) => (p === 'Custom' ? 'All data' : p))
  }, [lo, hi])

  const setPreset = useCallback((p: Preset) => {
    setPresetState(p)
    if (p !== 'Custom') setCustom(null)
  }, [])
  const setRange = useCallback((start: string, end: string) => {
    setCustom([start, end])
    setPresetState('Custom')
  }, [])
  const setMotion = useCallback((m: boolean) => {
    setMotionState(m)
    try {
      window.localStorage.setItem(MOTION_KEY, m ? 'on' : 'off')
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  }, [])
  const resetFilters = useCallback(() => {
    setPreset('All data')
    setSegments([])
  }, [setPreset])
  const resetAll = useCallback(() => {
    resetFilters()
    setRfm(null)
    setRisk(null)
    setCurrency('')
    setMotion(true)
  }, [resetFilters, setMotion])

  // Formatting reads the symbol synchronously, so set it before children render.
  setCurrencySymbol(currency)

  const filters = useMemo<Filters>(() => {
    const f: Filters = {}
    if (lo && hi) {
      if (preset === 'Custom' && custom) [f.start_date, f.end_date] = custom
      else if (preset !== 'All data' && preset !== 'Custom') [f.start_date, f.end_date] = presetRange(preset, lo, hi)
    }
    if (segments.length) f.segments = segments
    if (rfm) f.rfm = rfm
    if (risk) f.risk = risk
    return f
  }, [lo, hi, preset, custom, segments, rfm, risk])

  const window_: [string | null, string | null] = [filters.start_date ?? lo, filters.end_date ?? hi]
  const rules = useMemo(() => ({ rfm: rfm ?? meta?.defaults.rfm ?? null, risk: risk ?? meta?.defaults.risk ?? null }), [rfm, risk, meta])
  const key = `${dataset?.version ?? '-'}|${nonce}|${JSON.stringify(filters)}`
  const value = useMemo<DatasetValue>(
    () => ({
      dataset, meta, error, refresh, preset, setPreset, setRange, segments, setSegments, currency, setCurrency,
      rfm, setRfm, risk, setRisk, rules, motion, setMotion, resetFilters, resetAll, filters,
      window: window_, key,
    }),
    // window_ derives from filters + bounds, both covered by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, meta, error, refresh, preset, setPreset, setRange, segments, currency, rfm, risk, rules, motion, setMotion,
      resetFilters, resetAll, filters, key, lo, hi],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDataset(): DatasetValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDataset must be used inside DatasetProvider')
  return v
}

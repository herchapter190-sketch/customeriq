// No dataset declares a currency (Streamlit default "Not specified"), so amounts are plain numbers.
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const money = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtCompact = (v: number | null | undefined) => (v == null ? '—' : compact.format(v))
export const fmtWhole = (v: number | null | undefined) => (v == null ? '—' : whole.format(v))
export const fmtMoney = (v: number | null | undefined) => (v == null ? '—' : money.format(v))
export const fmtPct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}%`)

export function fmtDelta(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'no prior period'
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${Math.abs(v).toFixed(1)}% vs prior`
}

export function fmtMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
}

// No dataset declares a currency (Streamlit default "Not specified"), so amounts are plain numbers
// unless the reader picks a display symbol in the filter bar. Nothing is ever converted.
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const money = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let symbol = ''
/** Called by DatasetProvider on every render, before any page formats a value. */
export function setCurrencySymbol(s: string): void {
  symbol = s
}
export const currencySymbol = () => symbol
/** "Amounts in GBP" / "Currency not specified", as Streamlit's currency_caption(). */
export const currencyCaption = () =>
  symbol ? `Amounts in ${({ '£': 'GBP', $: 'USD', '€': 'EUR' } as Record<string, string>)[symbol] ?? symbol}` : 'Currency not specified'

const signed = (v: number, body: (x: number) => string) => `${v < 0 ? '−' : ''}${symbol}${body(Math.abs(v))}`

export const fmtCompact = (v: number | null | undefined) => (v == null ? '—' : compact.format(v))
export const fmtWhole = (v: number | null | undefined) => (v == null ? '—' : whole.format(v))
/** Money with two decimals and the chosen display symbol. */
export const fmtMoney = (v: number | null | undefined) => (v == null ? '—' : signed(v, (x) => money.format(x)))
/** Compact money (e.g. £1.2M) for headline figures. */
export const fmtMoneyCompact = (v: number | null | undefined) => (v == null ? '—' : signed(v, (x) => compact.format(x)))
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`

export function fmtDelta(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'no prior period'
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${Math.abs(v).toFixed(1)}% vs prior`
}

export function fmtMonth(iso: string): string {
  const d = new Date(`${String(iso).slice(0, 7)}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
}

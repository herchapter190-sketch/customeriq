/**
 * CustomerIQ palette. Standard Analytics: ivory page, white cards, espresso sidebar and text,
 * red-family data colours. 3D Exploration keeps its dark maroon stage; data colours are lifted
 * for it with onDark().
 * Chart series were checked against the white card: every series is >= 3:1 and every pair stays
 * separable (OKLab ΔE) under normal, deuteranope and protanope vision.
 */
export const THEME = {
  bg: '#F4EBD9',
  sidebar: '#27231F',
  card: '#FFFFFF',
  ink: '#27231F',
  burgundy: '#4F0D27',
  maroon: '#6E1530',
  wine: '#A8334F',
  rose: '#D27A8B',
  muted: '#8E7F76',
} as const

/** Fixed series order (never cycled): deep burgundy, muted rose, plum maroon, wine red. */
export const SERIES = ['#6E1530', '#D27A8B', '#7A2E5E', '#A8334F'] as const

/** Sequential ramp, blush → deep burgundy: magnitude only (heatmaps). */
const RAMP = ['#FAF1EC', '#F0D4D3', '#E2ABB2', '#CB7A89', '#A84A61', '#7F2541', '#4F0F27']

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

/** Colour for t in 0..1 on the sequential ramp, and the text colour that stays readable on it. */
export function heat(t: number): { bg: string; fg: string } {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const [a, b] = [hex(RAMP[i]), hex(RAMP[i + 1])]
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return { bg: `rgb(${c[0]} ${c[1]} ${c[2]})`, fg: t > 0.6 ? '#FFFFFF' : THEME.ink }
}

/** Lift a red-family data colour so it reads on the dark 3D stage (keeps hue, raises lightness).
 *  `minS` floors the saturation: dusty pinks otherwise drift to taupe/bronze under scene lighting. */
export function onDark(h: string, minL = 0.62, minS = 0): string {
  const [r, g, b] = hex(h).map((v) => v / 255)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (l >= minL && s >= minS) return h
  const hue = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  const L = l >= minL ? l : minL + (l / minL) * 0.12 // keep relative order between colours
  const C = (1 - Math.abs(2 * L - 1)) * Math.min(1, Math.max(minS, l >= minL ? s : s * 1.1))
  const X = C * (1 - Math.abs((hue % 2) - 1))
  const [p, q, w] = hue < 1 ? [C, X, 0] : hue < 2 ? [X, C, 0] : hue < 3 ? [0, C, X] : hue < 4 ? [0, X, C] : hue < 5 ? [X, 0, C] : [C, 0, X]
  const m = L - C / 2
  return `#${[p, q, w].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

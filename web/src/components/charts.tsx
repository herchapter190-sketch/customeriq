import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { SERIES, THEME } from '../lib/palette'

/** Surface-coloured outline so segments and markers separate on any card. */
const EDGE = 'var(--card)'

/*
 * Lightweight SVG charts for Standard Analytics. No dependencies; values arrive already
 * calculated by the API — these components only draw them. Every chart has a fixed height
 * (no layout shift), measures its width, offers a hover/keyboard tooltip and a legend for
 * two or more series. Exact values stay available in the tables next to each chart.
 */

/** Container width, measured before paint and on resize. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** 4–6 round ticks from lo to hi. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) hi = lo + 1
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Number(v.toPrecision(12)))
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step)
  return out
}

const textW = (s: string) => s.length * 6.4 + 4

export interface Series {
  key: string
  label: string
  color: string
  type: 'bar' | 'line' | 'area'
  /** bars with the same stack id are stacked */
  stack?: string
  /** dashed line (comparison / reference series) */
  dashed?: boolean
}

function Legend({ series }: { series: { key: string; label: string; color: string; type?: string; dashed?: boolean }[] }) {
  if (series.length < 2) return null
  return (
    <ul className="chart__legend">
      {series.map((s) => (
        <li key={s.key}>
          <span
            className={`chart__swatch${s.type === 'line' ? ' is-line' : ''}${s.dashed ? ' is-dashed' : ''}`}
            style={{ ['--c' as string]: s.color }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function Tooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: ReactNode; rows: { key: string; color: string; label: string; value: string }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(180)
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth)
  })
  const left = Math.max(0, Math.min(width - w, x + 14 + w > width ? x - w - 14 : x + 14))
  return (
    <div ref={ref} className="chart__tip" style={{ left, top: Math.max(0, y) }} role="status" aria-live="polite">
      <p className="chart__tip-title">{title}</p>
      {rows.map((r) => (
        <p key={r.key} className="chart__tip-row">
          <span className="chart__swatch" style={{ ['--c' as string]: r.color }} aria-hidden="true" />
          <span>{r.label}</span>
          <strong>{r.value}</strong>
        </p>
      ))}
    </div>
  )
}

/** Arrow-key navigation over n points; Escape clears. */
function useKeyNav(n: number, hover: number | null, setHover: (i: number | null) => void) {
  return (e: KeyboardEvent) => {
    if (!n) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const d = e.key === 'ArrowRight' ? 1 : -1
      setHover(hover == null ? (d > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, hover + d)))
    } else if (e.key === 'Escape') setHover(null)
  }
}

/* ------------------------------------------------------------------ category chart */

export function CategoryChart({
  categories,
  titles,
  series,
  values,
  format,
  axisFormat,
  height: fullHeight = 260,
  caption,
  yMax,
  endLabel = false,
  selected,
  onSelect,
}: {
  /** short x labels (e.g. "Jan 24") */
  categories: string[]
  /** full tooltip titles; defaults to categories */
  titles?: string[]
  series: Series[]
  values: Record<string, (number | null)[]>
  /** tooltip formatter (per series key allowed) */
  format: (v: number, key: string) => string
  /** y tick formatter; defaults to format */
  axisFormat?: (v: number) => string
  height?: number
  caption: string
  yMax?: number
  /** direct-label the last value of each line */
  endLabel?: boolean
  selected?: number | null
  onSelect?: (i: number) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const descId = useId()
  // phones: keep tall charts compact (width is measured before the first paint)
  const height = width > 0 && width < 560 ? Math.min(fullHeight, 260) : fullHeight
  const n = categories.length
  const tickFmt = axisFormat ?? ((v: number) => format(v, series[0]?.key ?? ''))

  const { ticks, lo, hi } = useMemo(() => {
    let mn = 0
    let mx = 0
    const stacks = new Map<string, number[]>()
    for (const s of series) {
      const vs = values[s.key] ?? []
      if (s.type === 'bar' && s.stack) {
        const acc = stacks.get(s.stack) ?? Array(n).fill(0)
        vs.forEach((v, i) => (acc[i] += v ?? 0))
        stacks.set(s.stack, acc)
      } else vs.forEach((v) => v != null && ((mx = Math.max(mx, v)), (mn = Math.min(mn, v))))
    }
    stacks.forEach((acc) => acc.forEach((v) => (mx = Math.max(mx, v))))
    if (yMax != null) mx = Math.max(mx, yMax)
    const t = niceTicks(mn, mx || 1, height < 200 ? 3 : 4)
    return { ticks: t, lo: t[0], hi: t[t.length - 1] }
  }, [series, values, n, yMax, height])

  const padL = Math.max(...ticks.map((t) => textW(tickFmt(t)))) + 8
  const endW = endLabel ? 64 : 12
  const pad = { l: padL, r: endW, t: 12, b: 28 }
  const iw = Math.max(10, width - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const band = iw / Math.max(1, n)
  const y = (v: number) => pad.t + ih * (1 - (v - lo) / (hi - lo || 1))
  const cx = (i: number) => pad.l + band * i + band / 2

  const bars = series.filter((s) => s.type === 'bar')
  const slots = [...new Set(bars.map((s) => s.stack ?? s.key))]
  const slotW = Math.min(40, Math.max(2, (band * 0.72) / Math.max(1, slots.length)))
  const groupW = slotW * slots.length
  const every = Math.max(1, Math.ceil((Math.max(...categories.map(textW), 30) + 10) / band))
  const nav = useKeyNav(n, hover, setHover)
  const active = hover ?? null

  const linePath = (vs: (number | null)[]) => {
    let d = ''
    let pen = false
    vs.forEach((v, i) => {
      if (v == null) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  return (
    <figure className="chart">
      <Legend series={series} />
      <div ref={ref} className="chart__plot" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={caption}
            aria-describedby={descId}
            tabIndex={0}
            onKeyDown={(e) => {
              nav(e)
              if (onSelect && active != null && (e.key === 'Enter' || e.key === ' ')) (e.preventDefault(), onSelect(active))
            }}
            onMouseLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
          >
            <desc id={descId}>{`${caption}. Use the left and right arrow keys to read each point.`}</desc>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart__zero' : 'chart__grid'} />
                <text x={pad.l - 8} y={y(t) + 4} className="chart__tick" textAnchor="end">{tickFmt(t)}</text>
              </g>
            ))}
            {categories.map((c, i) =>
              i % every === 0 ? (
                <text key={i} x={cx(i)} y={height - 8} className="chart__tick" textAnchor="middle">{c}</text>
              ) : null,
            )}
            {active != null && <rect x={pad.l + band * active} y={pad.t} width={band} height={ih} className="chart__band" />}
            {selected != null && selected >= 0 && <rect x={pad.l + band * selected} y={pad.t} width={band} height={ih} className="chart__band is-selected" />}

            {/* bars */}
            {slots.map((slot, si) => {
              const members = bars.filter((s) => (s.stack ?? s.key) === slot)
              return categories.map((_, i) => {
                let acc = 0
                const x0 = cx(i) - groupW / 2 + si * slotW + 1
                return members.map((s, mi) => {
                  const v = values[s.key]?.[i]
                  if (v == null || v === 0) return null
                  const top = y(acc + v)
                  const base = y(acc)
                  acc += v
                  const h = Math.max(1, Math.abs(base - top))
                  const isTop = mi === members.length - 1
                  const r = Math.min(3, (slotW - 2) / 2, h / 2)
                  const w = slotW - 2
                  const yy = Math.min(top, base)
                  // rounded data end, square baseline; 2px surface gap between stacked segments
                  const d = isTop && v > 0
                    ? `M${x0},${yy + h}V${yy + r}Q${x0},${yy} ${x0 + r},${yy}H${x0 + w - r}Q${x0 + w},${yy} ${x0 + w},${yy + r}V${yy + h}Z`
                    : `M${x0},${yy + h}V${yy}H${x0 + w}V${yy + h}Z`
                  return (
                    <path
                      key={`${s.key}-${i}`}
                      d={d}
                      fill={s.color}
                      className="chart__bar"
                      opacity={active != null && active !== i ? 0.55 : 1}
                      stroke={EDGE}
                      strokeWidth={members.length > 1 ? 1 : 0}
                    />
                  )
                })
              })
            })}

            {/* lines and areas */}
            {series
              .filter((s) => s.type !== 'bar')
              .map((s) => {
                const vs = values[s.key] ?? []
                const d = linePath(vs)
                const lastI = vs.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop()
                return (
                  <g key={s.key}>
                    {s.type === 'area' && d && lastI != null && (
                      <path
                        d={`${d}L${cx(lastI)},${y(Math.max(lo, 0))}L${cx(vs.findIndex((v) => v != null))},${y(Math.max(lo, 0))}Z`}
                        fill={s.color}
                        opacity={0.12}
                      />
                    )}
                    <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
                    {n <= 1 && vs[0] != null && <circle cx={cx(0)} cy={y(vs[0]!)} r={4} fill={s.color} />}
                    {endLabel && lastI != null && (
                      <>
                        <circle cx={cx(lastI)} cy={y(vs[lastI]!)} r={4} fill={s.color} stroke={EDGE} strokeWidth={2} />
                        <text x={cx(lastI) + 8} y={y(vs[lastI]!) + 4} className="chart__end">{format(vs[lastI]!, s.key)}</text>
                      </>
                    )}
                    {active != null && vs[active] != null && (
                      <circle cx={cx(active)} cy={y(vs[active]!)} r={4.5} fill={s.color} stroke={EDGE} strokeWidth={2} />
                    )}
                  </g>
                )
              })}

            {/* hit targets: whole column per category */}
            {categories.map((_, i) => (
              <rect
                key={i}
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={onSelect ? () => onSelect(i) : undefined}
                style={{ cursor: onSelect ? 'pointer' : 'crosshair' }}
              />
            ))}
          </svg>
        )}
        {active != null && width > 0 && (
          <Tooltip
            x={cx(active)}
            y={pad.t}
            width={width}
            title={(titles ?? categories)[active]}
            rows={series
              .filter((s) => values[s.key]?.[active] != null)
              .map((s) => ({ key: s.key, color: s.color, label: s.label, value: format(values[s.key][active]!, s.key) }))}
          />
        )}
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ concentration (Lorenz / Pareto) curve */

export function CurveChart({
  points,
  height = 280,
  caption,
  xLabel,
  yLabel,
  tip,
}: {
  /** x and y in percent, 0..100, ascending x */
  points: { x: number; y: number }[]
  height?: number
  caption: string
  xLabel: string
  yLabel: string
  tip: (p: { x: number; y: number }) => string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  // thin the curve for drawing; the hover still snaps to the API's own points
  const shown = useMemo(() => {
    if (points.length <= 400) return points
    const step = points.length / 400
    return Array.from({ length: 400 }, (_, i) => points[Math.floor(i * step)]).concat(points[points.length - 1])
  }, [points])
  const pad = { l: 46, r: 14, t: 12, b: 40 }
  const iw = Math.max(10, width - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const X = (v: number) => pad.l + (v / 100) * iw
  const Y = (v: number) => pad.t + ih * (1 - v / 100)
  const ticks = [0, 25, 50, 75, 100]
  const d = shown.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('')
  const nearest = (px: number) => {
    const v = ((px - pad.l) / iw) * 100
    let best = 0
    shown.forEach((p, i) => Math.abs(p.x - v) < Math.abs(shown[best].x - v) && (best = i))
    return best
  }
  const nav = useKeyNav(shown.length, hover, setHover)
  const p = hover != null ? shown[hover] : null
  return (
    <figure className="chart">
      <Legend
        series={[
          { key: 'c', label: 'Actual revenue curve', color: SERIES[0], type: 'line' },
          { key: 'e', label: 'Perfect equality', color: THEME.muted, type: 'line', dashed: true },
        ]}
      />
      <div ref={ref} className="chart__plot" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={caption}
            tabIndex={0}
            onKeyDown={nav}
            onMouseMove={(e) => setHover(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
            onMouseLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + iw} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'chart__zero' : 'chart__grid'} />
                <text x={pad.l - 8} y={Y(t) + 4} className="chart__tick" textAnchor="end">{t}%</text>
                <text x={X(t)} y={pad.t + ih + 16} className="chart__tick" textAnchor="middle">{t}%</text>
              </g>
            ))}
            <text x={pad.l + iw / 2} y={height - 4} className="chart__axis" textAnchor="middle">{xLabel}</text>
            <text transform={`translate(11 ${pad.t + ih / 2}) rotate(-90)`} className="chart__axis" textAnchor="middle">{yLabel}</text>
            <line x1={X(0)} y1={Y(0)} x2={X(100)} y2={Y(100)} stroke={THEME.muted} strokeWidth={1.5} strokeDasharray="5 4" />
            <path d={`${d}L${X(100)},${Y(0)}L${X(0)},${Y(0)}Z`} fill={SERIES[0]} opacity={0.08} />
            <path d={d} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinejoin="round" />
            {p && (
              <>
                <line x1={X(p.x)} x2={X(p.x)} y1={pad.t} y2={pad.t + ih} className="chart__cross" />
                <circle cx={X(p.x)} cy={Y(p.y)} r={4.5} fill={SERIES[0]} stroke={EDGE} strokeWidth={2} />
              </>
            )}
          </svg>
        )}
        {p && width > 0 && (
          <Tooltip x={X(p.x)} y={pad.t} width={width} title={tip(p)} rows={[]} />
        )}
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ donut */

export function Donut({
  items,
  format,
  centerLabel,
  caption,
  size = 200,
  selected,
  onSelect,
}: {
  items: { key: string; label: string; value: number; color: string; note?: string }[]
  /** formats a slice's value (e.g. as % share) */
  format: (v: number) => string
  centerLabel: string
  caption: string
  size?: number
  selected?: string | null
  onSelect?: (key: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const total = items.reduce((t, i) => t + Math.max(0, i.value), 0) || 1
  const r = size / 2
  const ro = r - 2
  const ri = r * 0.62
  let a0 = -Math.PI / 2
  const arcs = items.map((it) => {
    const a = (Math.max(0, it.value) / total) * Math.PI * 2
    const a1 = a0 + a
    const large = a > Math.PI ? 1 : 0
    const pt = (rad: number, ang: number) => `${(r + rad * Math.cos(ang)).toFixed(2)},${(r + rad * Math.sin(ang)).toFixed(2)}`
    const d = a >= Math.PI * 2 - 1e-6
      ? `M${pt(ro, 0)}A${ro},${ro} 0 1 1 ${pt(ro, Math.PI)}A${ro},${ro} 0 1 1 ${pt(ro, 0)}M${pt(ri, 0)}A${ri},${ri} 0 1 0 ${pt(ri, Math.PI)}A${ri},${ri} 0 1 0 ${pt(ri, 0)}Z`
      : `M${pt(ro, a0)}A${ro},${ro} 0 ${large} 1 ${pt(ro, a1)}L${pt(ri, a1)}A${ri},${ri} 0 ${large} 0 ${pt(ri, a0)}Z`
    a0 = a1
    return { ...it, d }
  })
  const focus = items.find((i) => i.key === (hover ?? selected)) ?? null
  return (
    <figure className="donut">
      <div className="donut__ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={caption}>
          {arcs.map((a) => (
            <path
              key={a.key}
              d={a.d}
              fill={a.color}
              stroke={EDGE}
              strokeWidth={2}
              fillRule="evenodd"
              opacity={focus && focus.key !== a.key ? 0.4 : 1}
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover(null)}
              onClick={onSelect ? () => onSelect(a.key) : undefined}
              style={{ cursor: onSelect ? 'pointer' : 'default', transition: 'opacity 200ms' }}
            >
              <title>{`${a.label}: ${format(a.value)}`}</title>
            </path>
          ))}
        </svg>
        <div className="donut__center" aria-hidden="true">
          <span className="donut__value">{focus ? format(focus.value) : ''}</span>
          <span className="donut__label">{focus ? focus.label : centerLabel}</span>
        </div>
      </div>
      <ul className="donut__legend">
        {items.map((it) => {
          const body = (
            <>
              <span className="chart__swatch" style={{ ['--c' as string]: it.color }} aria-hidden="true" />
              <span className="donut__name">{it.label}</span>
              <strong>{format(it.value)}</strong>
              {it.note && <span className="donut__note">{it.note}</span>}
            </>
          )
          return (
            <li key={it.key} className={focus?.key === it.key ? 'is-on' : undefined} onMouseEnter={() => setHover(it.key)} onMouseLeave={() => setHover(null)}>
              {onSelect ? (
                <button type="button" aria-pressed={selected === it.key} onClick={() => onSelect(it.key)}>{body}</button>
              ) : (
                <div>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

/* ------------------------------------------------------------------ panel */

/** A chart card: title, optional note and actions, body. Grid placement via `span`. */
export function Panel({
  title,
  note,
  aside,
  children,
  span = 1,
  className = '',
}: {
  title: string
  note?: ReactNode
  aside?: ReactNode
  children: ReactNode
  span?: 1 | 2 | 3
  className?: string
}) {
  const id = useId()
  return (
    <section className={`panel panel--span${span} ${className}`} aria-labelledby={id}>
      <header className="panel__head">
        <div>
          <h2 id={id} className="panel__title">{title}</h2>
          {note && <p className="panel__note">{note}</p>}
        </div>
        {aside && <div className="panel__aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

/** Short month label for chart axes: "Jan 24". */
export function shortMonth(iso: string): string {
  const d = new Date(`${String(iso).slice(0, 7)}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

/* ------------------------------------------------------------------ horizontal stacked rows */

/** One stacked bar per row (shared scale), labelled on the left with the row total on the right.
 *  Each segment has its own tooltip; the legend names every part. */
export function StackRows({
  rows,
  parts,
  format,
  caption,
}: {
  rows: { key: string; label: string; values: Record<string, number> }[]
  parts: { key: string; label: string; color: string }[]
  format: (v: number) => string
  caption: string
}) {
  const totals = rows.map((r) => parts.reduce((t, p) => t + (r.values[p.key] ?? 0), 0))
  const max = Math.max(1e-9, ...totals)
  return (
    <figure className="chart" aria-label={caption}>
      <Legend series={parts} />
      <ul className="stackrows">
        {rows.map((r, i) => (
          <li key={r.key}>
            <span className="stackrows__label">{r.label}</span>
            <span className="stackrows__track">
              {parts.map((p) => {
                const v = r.values[p.key] ?? 0
                if (!v) return null
                return (
                  <span
                    key={p.key}
                    className="stackrows__seg"
                    style={{ width: `${(v / max) * 100}%`, background: p.color }}
                    title={`${r.label} · ${p.label}: ${format(v)}`}
                  />
                )
              })}
            </span>
            <span className="stackrows__total">{format(totals[i])}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

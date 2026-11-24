import { useMemo } from 'react'
import { fmtWhole } from '../lib/format'
import { useWidth } from './charts'

/**
 * Stacked histogram in SVG. Binning is display-only (Streamlit's Plotly histograms bin in the
 * browser the same way); every bar is also readable as text in the table below the chart.
 */
export function Histogram({
  values,
  groups,
  bin,
  xLabel,
  yLabel,
  clip,
}: {
  values: { x: number; group: string }[]
  groups: { key: string; color: string }[]
  bin: number
  xLabel: string
  yLabel: string
  /** values above this go into the last bin, labelled "+" */
  clip?: number
}) {
  const [ref, measured] = useWidth<HTMLDivElement>()
  const bins = useMemo(() => {
    if (!values.length) return []
    const top = clip ?? Math.max(...values.map((v) => v.x))
    const n = Math.max(1, Math.floor(top / bin) + 1)
    const out = Array.from({ length: n }, (_, i) => ({ lo: i * bin, counts: new Map<string, number>(), total: 0 }))
    for (const v of values) {
      const i = Math.min(n - 1, Math.max(0, Math.floor(Math.min(v.x, top) / bin)))
      out[i].counts.set(v.group, (out[i].counts.get(v.group) ?? 0) + 1)
      out[i].total++
    }
    return out
  }, [values, bin, clip])
  if (!bins.length) return <p className="muted">No values to show.</p>
  const max = Math.max(1, ...bins.map((b) => b.total))
  const W = measured || 720
  const H = 220
  const pad = { l: 44, r: 8, t: 10, b: 34 }
  const bw = (W - pad.l - pad.r) / bins.length
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ticks = [0, Math.round(max / 2), max]
  const labelEvery = Math.max(1, Math.ceil(bins.length / Math.max(4, Math.floor(W / 70))))
  return (
    <figure className="hist">
      <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="hist__grid" />
            <text x={pad.l - 8} y={y(t) + 4} className="hist__tick" textAnchor="end">{fmtWhole(t)}</text>
          </g>
        ))}
        {bins.map((b, i) => {
          let acc = 0
          return (
            <g key={b.lo}>
              <title>{`${b.lo}–${b.lo + bin - 1}${clip && i === bins.length - 1 ? '+' : ''} days: ${fmtWhole(b.total)}`}</title>
              {groups.map((g) => {
                const c = b.counts.get(g.key) ?? 0
                if (!c) return null
                const y0 = y(acc + c)
                const h = y(acc) - y0
                acc += c
                return <rect key={g.key} x={pad.l + i * bw + 1} width={Math.max(1, bw - 2)} y={y0} height={h} fill={g.color} />
              })}
              {i % labelEvery === 0 && (
                <text x={pad.l + i * bw + bw / 2} y={H - pad.b + 16} className="hist__tick" textAnchor="middle">{b.lo}</text>
              )}
            </g>
          )
        })}
        <text x={(W + pad.l) / 2} y={H - 4} className="hist__axis" textAnchor="middle">{xLabel}</text>
      </svg>
      </div>
      <figcaption className="hist__legend">
        {groups.map((g) => (
          <span key={g.key}><span className="seg-dot" style={{ background: g.color }} aria-hidden="true" /> {g.key}</span>
        ))}
        <span className="muted">· {yLabel} per bin</span>
      </figcaption>
    </figure>
  )
}

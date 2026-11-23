import { HEX } from './store'

/** Static-friendly SVG woven sphere for browsers without WebGL. Motion is CSS-only and
 *  is switched off by prefers-reduced-motion in global.css. */
export function Fallback2D({ dim }: { dim: boolean }) {
  const meridians = Array.from({ length: 14 }, (_, i) => i)
  return (
    <div className={`stage stage--2d${dim ? ' is-dim' : ''}`} aria-hidden="true">
      <svg viewBox="-200 -200 400 400" className="fallback-sphere">
        <defs>
          <radialGradient id="ciq-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={HEX.burgundy} stopOpacity="0.55" />
            <stop offset="70%" stopColor={HEX.burgundy} stopOpacity="0.12" />
            <stop offset="100%" stopColor={HEX.orange} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r="150" fill="url(#ciq-core)" />
        <g className="fallback-spin">
          {meridians.map((i) => (
            <ellipse
              key={i}
              rx="150"
              ry={18 + ((i * 37) % 132)}
              transform={`rotate(${(i * 180) / meridians.length})`}
              fill="none"
              stroke={i % 5 === 2 ? HEX.lime : HEX.ivory}
              strokeOpacity={i % 5 === 2 ? 0.7 : 0.28}
              strokeWidth={i % 5 === 2 ? 0.9 : 0.7}
            />
          ))}
        </g>
        <ellipse rx="185" ry="46" transform="rotate(-8)" fill="none" stroke={HEX.ivory} strokeOpacity="0.16" />
      </svg>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useSession } from '../api/session'
import { useDataset } from '../lib/dataset'
import { setViewMode, useViewMode } from '../lib/viewMode'
import { ROUTES } from '../routes'

const STATUS_LABEL = { checking: 'Connecting…', ready: 'API connected', 'signed-out': 'Not signed in', offline: 'API offline' }

/** Standard Analytics ↔ 3D Exploration. */
export function ModeSwitch() {
  const mode = useViewMode()
  return (
    <div className="mode-switch" role="group" aria-label="View mode">
      <button type="button" aria-pressed={mode === 'standard'} onClick={() => setViewMode('standard')}>
        Standard
      </button>
      <button type="button" aria-pressed={mode === '3d'} onClick={() => setViewMode('3d')} title="Optional immersive view; loads the 3D engine on first use.">
        3D Exploration
      </button>
    </div>
  )
}

export function Nav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { status } = useSession()
  const { motion, setMotion } = useDataset()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? 'on' : 'off'
  }, [motion])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  let group = ''
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="CustomerIQ home">
          Customer<span>IQ</span>
        </Link>
        <button
          type="button"
          className="menu-btn"
          aria-expanded={open}
          aria-controls="primary-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="menu-btn__bars" aria-hidden="true" />
          {open ? 'Close' : 'Menu'}
        </button>
      </header>

      <nav id="primary-nav" className={`rail${open ? ' is-open' : ''}`} aria-label="Primary">
        <Link to="/" className="brand rail__brand" aria-label="CustomerIQ home">
          Customer<span>IQ</span>
        </Link>
        <p className="rail__tag">Customer intelligence</p>
        <ModeSwitch />
        <ol className="rail__list">
          {ROUTES.map((r, i) => {
            const heading = r.group !== group ? (group = r.group) : null
            return (
              <li key={r.path}>
                {heading && <p className="rail__group">{heading}</p>}
                <NavLink to={r.path} end={r.path === '/'} className="rail__link">
                  <span className="rail__idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="rail__title">{r.title}</span>
                </NavLink>
              </li>
            )
          })}
        </ol>
        <div className="rail__foot">
          <button type="button" className="rail__motion" aria-pressed={motion} onClick={() => setMotion(!motion)} title="Turn off for less motion and a lighter 3D load on slow machines.">
            Animations {motion ? 'on' : 'off'}
          </button>
          <p className={`rail__status is-${status}`} role="status">
            <span className="dot" aria-hidden="true" />
            {STATUS_LABEL[status]}
          </p>
        </div>
      </nav>
    </>
  )
}

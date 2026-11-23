import { lazy, Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider } from './api/session'
import { Nav } from './components/Nav'
import { BootVeil, Loading } from './components/Status'
import Planned, { NotFound } from './pages/Planned'
import { routeFor, ROUTES } from './routes'
import { Stage } from './scene/Stage'

const Overview = lazy(() => import('./pages/Overview'))

function Shell() {
  const { pathname } = useLocation()
  const route = routeFor(pathname)
  const main = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    document.title = `${route?.title ?? 'Not found'} · CustomerIQ`
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    main.current?.focus({ preventScroll: true }) // move focus to new content for keyboard/screen-reader users
    window.scrollTo({ top: 0 })
  }, [route])

  return (
    <>
      <Stage slug={route?.slug ?? 'none'} />
      <div className="scrim" aria-hidden="true" />
      <Nav />
      <main ref={main} tabIndex={-1} className={`page page--${route?.slug ?? 'none'}`} key={pathname}>
        <Suspense fallback={<Loading label="Loading view" />}>
          <Routes>
            <Route path="/" element={<Overview />} />
            {ROUTES.slice(1).map((r) => (
              <Route key={r.path} path={r.path} element={<Planned route={r} />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <BootVeil />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </BrowserRouter>
  )
}

import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider } from './api/session'
import { Nav } from './components/Nav'
import { BootVeil, Loading } from './components/Status'
import { DatasetProvider } from './lib/dataset'
import Planned, { NotFound } from './pages/Planned'
import { hasWebGL } from './lib/hooks'
import { routeFor, ROUTES } from './routes'
import { Fallback2D } from './scene/Fallback2D'
import { sceneStore } from './scene/store'
import { useViewMode } from './lib/viewMode'

const Overview = lazy(() => import('./pages/Overview'))
/** three.js + R3F + every scene: only fetched once the reader enters 3D Exploration. */
const Stage = lazy(() => import('./scene/Stage'))

function Scene({ slug }: { slug: string }) {
  if (!hasWebGL()) return <Fallback2DStage slug={slug} />
  return (
    <Suspense fallback={<Fallback2D dim={slug !== 'overview'} />}>
      <Stage slug={slug} />
    </Suspense>
  )
}
function Fallback2DStage({ slug }: { slug: string }) {
  useEffect(() => sceneStore.set({ mode: '2d', ready: true }), [])
  return <Fallback2D dim={slug !== 'overview'} />
}

/**
 * On narrow screens the scene sits above the text, then stays fixed behind it once the
 * page scrolls. This veil (CSS: only shown below 960px) thickens with scroll so headlines
 * never read across the sphere's wires.
 */
function ScrollVeil() {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      el.current?.style.setProperty('opacity', String(Math.min(1, window.scrollY / 260)))
    }
    const onScroll = () => void (raf ||= requestAnimationFrame(update))
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])
  return <div ref={el} className="scroll-veil" aria-hidden="true" />
}

/** Each environment's HTML layer is its own chunk, loaded on first visit. */
const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  segments: lazy(() => import('./pages/Segments')),
  revenue: lazy(() => import('./pages/Revenue')),
  cohorts: lazy(() => import('./pages/Cohorts')),
  behaviour: lazy(() => import('./pages/Behaviour')),
  inactive: lazy(() => import('./pages/Inactive')),
  data: lazy(() => import('./pages/DataManagement')),
  sql: lazy(() => import('./pages/SqlLibrary')),
  reports: lazy(() => import('./pages/Reports')),
}

function Shell() {
  const { pathname } = useLocation()
  const route = routeFor(pathname)
  const main = useRef<HTMLElement>(null)
  const firstRender = useRef(true)
  const mode = useViewMode()
  // The brand veil waits for the first 3D frame, so it only belongs to a visit that opens in 3D.
  const veil = useRef(mode === '3d').current

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
      {mode === '3d' && (
        <>
          <Scene slug={route?.slug ?? 'none'} />
          <div className="scrim" aria-hidden="true" />
          <ScrollVeil />
        </>
      )}
      <Nav />
      <main ref={main} tabIndex={-1} className={`page page--${route?.slug ?? 'none'}`} key={pathname}>
        <Suspense fallback={<Loading label="Loading view" />}>
          <Routes>
            <Route path="/" element={<Overview />} />
            {ROUTES.slice(1).map((r) => {
              const Page = PAGES[r.slug]
              return <Route key={r.path} path={r.path} element={Page ? <Page /> : <Planned route={r} />} />
            })}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {veil && mode === '3d' && <BootVeil />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <DatasetProvider>
          <Shell />
        </DatasetProvider>
      </SessionProvider>
    </BrowserRouter>
  )
}

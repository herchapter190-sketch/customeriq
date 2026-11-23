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

const Overview = lazy(() => import('./pages/Overview'))
/** three.js + R3F + every scene: fetched in parallel with the first page, never blocking it. */
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
      <Scene slug={route?.slug ?? 'none'} />
      <div className="scrim" aria-hidden="true" />
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
      <BootVeil />
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

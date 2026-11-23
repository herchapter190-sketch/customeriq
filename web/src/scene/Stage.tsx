import { Component, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { useDataset } from '../lib/dataset'
import { useReducedMotion } from '../lib/hooks'
import { CameraRig } from './CameraRig'
import { Fallback2D } from './Fallback2D'
import { District, SceneEnvProvider, StudioLighting } from './kit'
import { Particles } from './Particles'
import { RevenueOrbit } from './RevenueOrbit'
import { sceneStore } from './store'
import { WovenSphere } from './WovenSphere'

/* Each environment is its own chunk, fetched the first time its district is visited. */
const SCENES: Record<string, ReturnType<typeof lazy>> = {
  segments: lazy(() => import('./districts/SegmentsScene')),
  revenue: lazy(() => import('./districts/RevenueScene')),
  cohorts: lazy(() => import('./districts/CohortsScene')),
  behaviour: lazy(() => import('./districts/BehaviourScene')),
  inactive: lazy(() => import('./districts/InactiveScene')),
  data: lazy(() => import('./districts/DataScene')),
  sql: lazy(() => import('./districts/SqlScene')),
  reports: lazy(() => import('./districts/ReportsScene')),
}

/** After a lost GPU context the scene is rebuilt this many times before staying in 2D. */
const MAX_RESTORES = 2
const RESTORE_DELAY_MS = 1500

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('3D scene unavailable, using the 2D fallback:', error)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function ReadySignal() {
  useFrame(() => {
    if (!sceneStore.get().ready) sceneStore.set({ ready: true })
  })
  return null
}

/**
 * One persistent WebGL canvas for every route; the route moves the camera between districts.
 * Loaded as its own chunk (three.js + R3F) so the HTML layer paints before the 3D arrives.
 */
export default function Stage({ slug }: { slug: string }) {
  const systemReduced = useReducedMotion()
  const { motion: motionOn } = useDataset()
  const reduced = systemReduced || !motionOn
  const [failed, setFailed] = useState(false)
  // 'lost' = the GPU dropped the context; the canvas is rebuilt after a short pause.
  const [lost, setLost] = useState(false)
  const [generation, setGeneration] = useState(0)
  const restores = useRef(0)
  const [quality, setQuality] = useState<'high' | 'low'>(() =>
    navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 'low' : 'high',
  )
  const dim = useMemo(() => ({ value: 0 }), [])
  const motion = reduced ? 0 : 1
  const env = useMemo(() => ({ quality, motion, reduced }), [quality, motion, reduced])
  const twoD = failed || lost

  useEffect(() => {
    sceneStore.set({ mode: twoD ? '2d' : 'webgl', ...(twoD ? { ready: true } : {}) })
  }, [twoD])

  useEffect(() => {
    if (!lost) return
    const t = window.setTimeout(() => {
      setLost(false)
      setGeneration((g) => g + 1) // fresh Canvas = fresh WebGL context and GPU resources
    }, RESTORE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [lost])

  if (twoD) return <Fallback2D dim={slug !== 'overview'} />

  return (
    <div className="stage" aria-hidden="true">
      <SceneBoundary key={generation} onError={() => setFailed(true)}>
        <Canvas
          dpr={quality === 'high' ? [1, 1.75] : [1, 1.25]}
          frameloop={reduced ? 'demand' : 'always'}
          gl={{ antialias: quality === 'high', alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
          camera={{ fov: 35, near: 0.1, far: 80, position: [0.6, 1.8, 13] }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0)
            // Neutral tone mapping keeps the brand colours true on physical materials.
            gl.toneMapping = THREE.NeutralToneMapping
            gl.toneMappingExposure = 1.05
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              if (restores.current < MAX_RESTORES) {
                restores.current += 1
                console.warn('WebGL context lost; rebuilding the scene.')
                setLost(true)
              } else {
                setFailed(true)
              }
            })
          }}
        >
          <SceneEnvProvider value={env}>
            <PerformanceMonitor onDecline={() => setQuality('low')} flipflops={2} />
            <CameraRig slug={slug} reduced={reduced} dim={dim} />
            <StudioLighting />
            <WovenSphere motion={motion} dim={dim} quality={quality} />
            <RevenueOrbit motion={motion} dim={dim} interactive={slug === 'overview'} />
            <Particles count={quality === 'high' ? 1400 : 600} motion={motion} dim={dim} />
            {Object.entries(SCENES).map(([key, Scene]) => (
              <District key={key} slug={key} active={slug === key}>
                <Scene />
              </District>
            ))}
            <ReadySignal />
          </SceneEnvProvider>
        </Canvas>
      </SceneBoundary>
    </div>
  )
}

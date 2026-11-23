import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { hasWebGL, useReducedMotion } from '../lib/hooks'
import { CameraRig } from './CameraRig'
import { Fallback2D } from './Fallback2D'
import { Particles } from './Particles'
import { RevenueOrbit } from './RevenueOrbit'
import { sceneStore } from './store'
import { WovenSphere } from './WovenSphere'

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

/** One persistent WebGL canvas for every route; the route only changes the camera and emphasis. */
export function Stage({ slug }: { slug: string }) {
  const reduced = useReducedMotion()
  const [failed, setFailed] = useState(() => !hasWebGL())
  const [quality, setQuality] = useState<'high' | 'low'>(() =>
    navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 'low' : 'high',
  )
  const dim = useMemo(() => ({ value: 0 }), [])
  const motion = reduced ? 0 : 1

  useEffect(() => {
    sceneStore.set({ mode: failed ? '2d' : 'webgl', ...(failed ? { ready: true } : {}) })
  }, [failed])

  if (failed) return <Fallback2D dim={slug !== 'overview'} />

  return (
    <div className="stage" aria-hidden="true">
      <SceneBoundary onError={() => setFailed(true)}>
        <Canvas
          dpr={quality === 'high' ? [1, 1.75] : [1, 1.25]}
          frameloop={reduced ? 'demand' : 'always'}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
          camera={{ fov: 35, near: 0.1, far: 60, position: [0.6, 1.8, 13] }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0)
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              setFailed(true)
            })
          }}
        >
          <PerformanceMonitor onDecline={() => setQuality('low')} flipflops={2} />
          <CameraRig slug={slug} reduced={reduced} dim={dim} />
          <WovenSphere motion={motion} dim={dim} quality={quality} />
          <RevenueOrbit motion={motion} dim={dim} interactive={slug === 'overview'} />
          <Particles count={quality === 'high' ? 1400 : 600} motion={motion} dim={dim} />
          <ReadySignal />
        </Canvas>
      </SceneBoundary>
    </div>
  )
}

import { createContext, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Html, Lightformer } from '@react-three/drei'
import gsap from 'gsap'
import * as THREE from 'three'
import { DISTRICTS } from './districts'

/* ------------------------------------------------------------------ presence */

/** 0 → 1 as a district assembles; scenes read `.value` inside useFrame (no React re-renders). */
export interface Presence {
  value: number
  active: boolean
}
const PresenceCtx = createContext<Presence>({ value: 1, active: true })
export const usePresence = () => useContext(PresenceCtx)

/** Quality and motion settings shared by all district scenes. */
export interface SceneEnv {
  quality: 'high' | 'low'
  motion: number
  reduced: boolean
}
const EnvCtx = createContext<SceneEnv>({ quality: 'high', motion: 1, reduced: false })
export const useSceneEnv = () => useContext(EnvCtx)
export const SceneEnvProvider = EnvCtx.Provider

/**
 * Places a district in the world and mounts its scene only while it is the active route
 * (plus a short exit). Scenes are lazy chunks, so unvisited districts cost nothing.
 */
export function District({ slug, active, children }: { slug: string; active: boolean; children: ReactNode }) {
  const def = DISTRICTS[slug]
  const { reduced, quality } = useSceneEnv()
  const invalidate = useThree((s) => s.invalidate)
  const [mounted, setMounted] = useState(active)
  const presence = useMemo<Presence>(() => ({ value: 0, active }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    presence.active = active
    gsap.killTweensOf(presence)
    if (active) setMounted(true)
    if (reduced) {
      presence.value = active ? 1 : 0
      if (!active) setMounted(false)
      invalidate()
      return
    }
    gsap.to(presence, {
      value: active ? 1 : 0,
      duration: active ? 2.1 : 0.7,
      delay: active ? 0.45 : 0,
      ease: active ? 'power3.out' : 'power2.in',
      onUpdate: invalidate,
      onComplete: () => !active && setMounted(false),
    })
  }, [active, reduced, presence, invalidate])

  if (!def || !mounted) return null
  return (
    <group position={def.position} rotation={[0, def.rotationY, 0]}>
      <PresenceCtx.Provider value={presence}>
        <Suspense fallback={null}>{children}</Suspense>
      </PresenceCtx.Provider>
      {active && (
        <ContactShadows
          position={[0, -1.62, 0]}
          scale={9}
          far={4}
          blur={2.6}
          opacity={0.55}
          resolution={quality === 'high' ? 512 : 256}
          frames={reduced ? 1 : Infinity}
          color="#12050a"
        />
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ lighting */

/**
 * Studio lighting built from procedural light panels (no HDR download): a blush-white key,
 * a burgundy bounce and a rose kicker, so lacquer, satin and glass read as physical materials.
 * The key is deliberately blush rather than warm ivory: a yellow-leaning key turned rose and
 * maroon surfaces bronze in their highlights. Rendered once into an environment map.
 */
const KEY = '#F6ECEF'
export function StudioLighting() {
  return (
    <>
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} color={KEY} position={[-4, 5, 3]} scale={[6, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.1} color={KEY} position={[5, 2, 4]} scale={[3, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={1.6} color="#D18A98" position={[4, -3, -4]} scale={3} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.8} color="#641C36" position={[0, -5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#E6A1AE" position={[-6, 0, -3]} scale={[1, 6, 1]} target={[0, 0, 0]} />
      </Environment>
      <ambientLight intensity={0.18} color={KEY} />
      <directionalLight position={[-5, 8, 6]} intensity={1.6} color={KEY} />
      <directionalLight position={[6, -2, -4]} intensity={0.7} color="#D18A98" />
    </>
  )
}

/* ------------------------------------------------------------------ materials */

export const lacquer = (color: string, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.3,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.1,
    ...extra,
  })

export const satin = (color: string, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.38,
    metalness: 0.55,
    sheen: 1,
    sheenColor: new THREE.Color('#D18A98'),
    sheenRoughness: 0.35,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    side: THREE.DoubleSide,
    envMapIntensity: 1.2,
    ...extra,
  })

export const copper = (extra: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({ color: '#B34A59', metalness: 1, roughness: 0.32, envMapIntensity: 1.3, ...extra })

/** Glass is real transmission on capable GPUs and a cheap clear-coat shell otherwise. */
export const glass = (quality: 'high' | 'low', extra: THREE.MeshPhysicalMaterialParameters = {}) =>
  quality === 'high'
    ? new THREE.MeshPhysicalMaterial({
        color: '#F4EBD9',
        transmission: 1,
        thickness: 0.35,
        roughness: 0.08,
        ior: 1.45,
        envMapIntensity: 1.4,
        clearcoat: 1,
        ...extra,
      })
    : new THREE.MeshPhysicalMaterial({
        color: '#F4EBD9',
        transparent: true,
        opacity: 0.32,
        roughness: 0.1,
        clearcoat: 1,
        envMapIntensity: 1.6,
        depthWrite: false,
        ...extra,
      })

/** Dispose materials/geometries created in useMemo when a district unmounts. */
type Disposable = { dispose: () => void }
/** Pass the memoised object or array itself: the effect depends on its identity, so the
 *  dependency list always has exactly one entry however many items it holds. */
export function useDisposable(item: Disposable | Disposable[]) {
  useEffect(() => () => (Array.isArray(item) ? item : [item]).forEach((i) => i.dispose()), [item])
}

/* ------------------------------------------------------------------ labels */

/** A small editorial label pinned in 3D space (HTML, so it stays crisp at any size). */
export function Label({
  position,
  children,
  tone = 'default',
  align = 'center',
}: {
  position: [number, number, number]
  children: ReactNode
  tone?: 'default' | 'strong' | 'muted' | 'axis' | 'lime' | 'orange'
  align?: 'center' | 'left' | 'right'
}) {
  return (
    <Html position={position} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }} center={align === 'center'}>
      <div className={`slabel slabel--${tone} slabel--${align}`}>{children}</div>
    </Html>
  )
}

/* ------------------------------------------------------------------ helpers */

export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
/** Staggered entrance for item i of n given district presence p (0..1). */
export const stagger = (p: number, i: number, n: number, spread = 0.55) =>
  easeOut((p - (i / Math.max(1, n)) * spread) / (1 - spread))
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  THREE.MathUtils.damp(current, target, lambda, dt)

/** Cursor feedback for interactive meshes. */
export const pointerCursor = (on: boolean) => {
  document.body.style.cursor = on ? 'pointer' : ''
}

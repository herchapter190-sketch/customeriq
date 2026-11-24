import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { fmtMoneyCompact, fmtWhole } from '../../lib/format'
import { Label, pointerCursor, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setHover, useDistrict, useHover, type HourCell } from '../store'

/**
 * Weekday × hour field: 7 rows × 24 columns. Column height and brightness are the orders
 * (or sales) placed in that hour of that weekday (weekday_hour). Translucent bands mark
 * 25 / 50 / 75 % of the busiest hour, and a light hangs over the real peak.
 */
const PITCH_X = 0.19
const PITCH_Z = 0.27
const BASE = -1.15
const MAX_H = 2.1
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LOW = new THREE.Color('#4A1526')
const HIGH = new THREE.Color('#E6A1AE')

const xOf = (h: number) => (h - 11.5) * PITCH_X
const zOf = (wd: number) => (wd - 3) * PITCH_Z

export default function BehaviourScene() {
  const data = useDistrict('behaviour')
  const hover = useHover('behaviour')
  const { motion } = useSceneEnv()
  const presence = usePresence()
  const metric = data?.metric ?? 'orders'

  // Full 7 × 24 grid; hours with no orders are present at zero height.
  const grid = useMemo(() => {
    const by = new Map((data?.cells ?? []).map((c) => [`${c.wd}-${c.hour}`, c]))
    const out: (HourCell & { v: number })[] = []
    for (let wd = 0; wd < 7; wd++) {
      for (let h = 0; h < 24; h++) {
        const c = by.get(`${wd}-${h}`)
        const base = c ?? { wd, weekday: DAYS[wd], hour: h, orders: 0, sales: 0 }
        out.push({ ...base, v: metric === 'orders' ? base.orders : base.sales })
      }
    }
    return out
  }, [data, metric])
  const max = Math.max(1e-9, ...grid.map((c) => c.v))
  const peak = grid.reduce((b, c, i) => (c.v > grid[b].v ? i : b), 0)

  const geometry = useMemo(() => new THREE.BoxGeometry(0.15, 1, 0.21).translate(0, 0.5, 0), [])
  const material = useMemo(
    () => new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    [],
  )
  const bandMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#F4EBD9', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    [],
  )
  const floorMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4EBD9', transparent: true, opacity: 0.08 }), [])
  useDisposable(geometry)
  useDisposable(material)
  useDisposable(bandMat)
  useDisposable(floorMat)

  const mesh = useRef<THREE.InstancedMesh>(null)
  const heights = useRef(new Float32Array(168))
  const light = useRef<THREE.PointLight>(null)
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const colour = useMemo(() => new THREE.Color(), [])

  useFrame((state, dt) => {
    const m = mesh.current
    if (!m) return
    const p = presence.value
    grid.forEach((c, i) => {
      const grow = THREE.MathUtils.clamp(p * 1.6 - (c.hour / 24) * 0.6, 0, 1)
      const target = Math.max(0.015, (c.v / max) * MAX_H) * grow
      const h = (heights.current[i] = THREE.MathUtils.damp(heights.current[i], target, 7, dt))
      tmp.position.set(xOf(c.hour), BASE, zOf(c.wd))
      tmp.scale.set(1, Math.max(0.001, h), 1)
      tmp.updateMatrix()
      m.setMatrixAt(i, tmp.matrix)
      const isHover = hover === `${c.wd}-${c.hour}`
      colour.copy(LOW).lerp(HIGH, Math.pow(c.v / max, 0.8))
      if (isHover) colour.set('#D18A98')
      m.setColorAt(i, colour)
    })
    m.count = grid.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (light.current) {
      const c = grid[peak]
      light.current.position.set(xOf(c.hour), BASE + MAX_H + 0.6, zOf(c.wd))
      light.current.intensity = (2.2 + Math.sin(state.clock.elapsedTime * 1.4) * 0.4 * motion) * p
    }
  })

  if (!data) return null

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return
    e.stopPropagation()
    const c = grid[e.instanceId]
    setHover('behaviour', `${c.wd}-${c.hour}`)
    pointerCursor(true)
  }
  const onOut = () => {
    setHover('behaviour', null)
    pointerCursor(false)
  }
  const fmt = metric === 'orders' ? fmtWhole : fmtMoneyCompact
  const pk = grid[peak]
  const width = 24 * PITCH_X
  const depth = 7 * PITCH_Z

  return (
    <group position={[0.05, 0.2, 0]} rotation={[0, -0.32, 0]} scale={0.72}>
      <instancedMesh ref={mesh} args={[geometry, material, 168]} onPointerMove={onMove} onPointerOut={onOut} frustumCulled={false} />
      <mesh position={[0, BASE - 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMat}>
        <planeGeometry args={[width + 0.2, depth + 0.1]} />
      </mesh>
      {[0.25, 0.5, 0.75].map((f) => (
        <group key={f}>
          <mesh position={[0, BASE + f * MAX_H, 0]} rotation={[-Math.PI / 2, 0, 0]} material={bandMat}>
            <planeGeometry args={[width + 0.2, depth + 0.1]} />
          </mesh>
          <Label position={[width / 2 + 0.2, BASE + f * MAX_H, -depth / 2]} tone="muted" align="left">
            {fmt(max * f)} {metric === 'orders' ? 'orders' : ''}
          </Label>
        </group>
      ))}
      <pointLight ref={light} color="#E6A1AE" distance={3.5} decay={1.6} />
      {DAYS.map((d, wd) => (
        <Label key={d} position={[-width / 2 - 0.12, BASE + 0.02, zOf(wd)]} tone="muted" align="right">
          {d}
        </Label>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
        <Label key={h} position={[xOf(h), BASE - 0.02, depth / 2 + 0.22]} tone="muted">
          {String(h).padStart(2, '0')}:00
        </Label>
      ))}
      {pk.v > 0 && (
        <Label position={[xOf(pk.hour), BASE + MAX_H + 0.35, zOf(pk.wd)]} tone="lime">
          Busiest · {pk.weekday} {String(pk.hour).padStart(2, '0')}:00
          <small>{fmt(pk.v)}</small>
        </Label>
      )}
    </group>
  )
}

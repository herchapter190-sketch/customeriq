import { useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { onDark } from '../../lib/palette'
import { hash01, RISK_COLORS, RISK_ZONES, SEGMENTS } from '../../lib/domain'
import { Label, lacquer, pointerCursor, secondTap, stagger, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setFocus, setHover, setPick, useDistrict, useFocus, useHover, usePick } from '../store'

/**
 * Risk zones. Concentric floor bands are the four inactivity categories, with borders at
 * the API's rule thresholds (active / cooling / at-risk days). Each customer stands at a
 * distance from the centre set by their own days since last purchase (inactive_customers),
 * in the sector of their segment; sphere size follows historical revenue, colour the
 * value tier, and an orange ring marks customers flagged overdue.
 */
const BASE = -1.2
const INNER = 0.3
const BAND = 0.62
const TIER: Record<string, string> = { High: '#E6A1AE', Medium: '#F4EBD9', Low: '#B97A88' }

export default function InactiveScene() {
  const data = useDistrict('inactive')
  const focus = useFocus('inactive')
  const hover = useHover('inactive')
  const pick = usePick('inactive')
  const { motion } = useSceneEnv()
  const presence = usePresence()
  // Phones: the page headline starts mid-screen, so the scene is lifted into the band above it.
  const phone = useThree((s) => s.size.width < 640)
  // Tablets (below the 1024px desktop layout) also stack the headline under the scene.
  const tablet = useThree((s) => s.size.width >= 640 && s.size.width < 1024)

  const layout = useMemo(() => {
    if (!data) return null
    const { customers, rules } = data
    const maxDays = Math.max(rules.at_risk_days + 1, ...customers.map((c) => c.days))
    const edges = [0, rules.active_days, rules.cooling_days, rules.at_risk_days, maxDays]
    const radiusOf = (days: number) => {
      const z = days <= edges[1] ? 0 : days <= edges[2] ? 1 : days <= edges[3] ? 2 : 3
      const f = (days - edges[z]) / Math.max(1, edges[z + 1] - edges[z])
      return INNER + (z + THREE.MathUtils.clamp(f, 0, 1)) * BAND
    }
    // Sectors per segment, proportional to how many customers each holds.
    const order = Object.keys(SEGMENTS).filter((s) => customers.some((c) => c.segment === s))
    customers.forEach((c) => !order.includes(c.segment) && order.push(c.segment))
    const counts = order.map((s) => customers.filter((c) => c.segment === s).length)
    const total = Math.max(1, customers.length)
    const gap = 0.05
    let a = Math.PI / 2
    const sectors = order.map((s, i) => {
      const span = (counts[i] / total) * (Math.PI * 2 - gap * order.length)
      const sec = { segment: s, start: a, span }
      a -= span + gap
      return sec
    })
    const secOf = new Map(sectors.map((s) => [s.segment, s]))
    const maxRev = Math.max(1e-9, ...customers.map((c) => c.revenue))
    const points = customers.map((c) => {
      const sec = secOf.get(c.segment)!
      const ang = sec.start - hash01(c.id) * sec.span
      const r = radiusOf(c.days)
      const size = 0.016 + 0.06 * Math.sqrt(Math.max(0, c.revenue) / maxRev)
      return { x: Math.cos(ang) * r, z: -Math.sin(ang) * r, size }
    })
    return { edges, sectors, points, outer: INNER + 4 * BAND }
  }, [data])

  const sphere = useMemo(() => new THREE.SphereGeometry(1, 16, 12), [])
  const ring = useMemo(() => new THREE.TorusGeometry(1, 0.08, 6, 28).rotateX(Math.PI / 2), [])
  const mat = useMemo(() => lacquer('#ffffff'), [])
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#D18A98', toneMapped: false }), [])
  const zoneMats = useMemo(
    () => RISK_ZONES.map((z) => new THREE.MeshBasicMaterial({ color: onDark(RISK_COLORS[z]), transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })),
    [],
  )
  const edgeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4EBD9', transparent: true, opacity: 0.25 }), [])
  useDisposable(sphere)
  useDisposable(ring)
  useDisposable(mat)
  useDisposable(ringMat)
  useDisposable(zoneMats)
  useDisposable(edgeMat)

  const mesh = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const colour = useMemo(() => new THREE.Color(), [])
  const dimmed = useMemo(() => new THREE.Color('#46202d'), [])

  useFrame((state, dt) => {
    const p = presence.value
    if (group.current) group.current.rotation.y += dt * 0.012 * motion
    zoneMats.forEach((m, z) => {
      const on = focus == null || focus === RISK_ZONES[z]
      m.opacity = THREE.MathUtils.damp(m.opacity, (on ? (focus ? 0.2 : 0.09) : 0.03) * p, 6, dt)
    })
    const m = mesh.current
    const rm = rings.current
    if (!m || !rm || !data || !layout) return
    let ri = 0
    data.customers.forEach((c, i) => {
      const pt = layout.points[i]
      const s = stagger(p, i % 97, 97, 0.7)
      const inFocus = focus == null || focus === c.risk
      const picked = pick === c.id
      const k = (picked ? 1.8 : 1) * pt.size * s
      tmp.position.set(pt.x, BASE + k + Math.sin(state.clock.elapsedTime * 0.8 + i) * 0.006 * motion, pt.z)
      tmp.scale.setScalar(Math.max(0.0001, k))
      tmp.updateMatrix()
      m.setMatrixAt(i, tmp.matrix)
      colour.set(hover === i || picked ? '#D18A98' : TIER[c.tier] ?? '#B97A88')
      if (!inFocus) colour.lerp(dimmed, 0.8)
      m.setColorAt(i, colour)
      if (c.overdue && inFocus) {
        tmp.position.set(pt.x, BASE + 0.004, pt.z)
        tmp.scale.setScalar(Math.max(0.0001, pt.size * 1.7 * s))
        tmp.updateMatrix()
        rm.setMatrixAt(ri++, tmp.matrix)
      }
    })
    m.count = data.customers.length
    rm.count = ri
    m.instanceMatrix.needsUpdate = true
    rm.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  if (!data || !layout) return null

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return
    e.stopPropagation()
    setHover('inactive', e.instanceId)
    pointerCursor(true)
  }
  const onOut = () => {
    setHover('inactive', null)
    pointerCursor(false)
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return
    e.stopPropagation()
    const c = data.customers[e.instanceId]
    if (!secondTap(c.id)) return
    setPick('inactive', c.id)
    setFocus('inactive', c.risk)
  }
  const n = data.customers.length
  const shownSegment = (typeof hover === 'number' ? data.customers[hover] : data.customers.find((c) => c.id === pick))?.segment

  return (
    // Centred (CameraRig already centres the free area) and sized so the rotating outer
    // segment labels stay inside the viewport at 1440px.
    <group position={[0, phone ? 1.7 : tablet ? 1.2 : 0.1, 0]} scale={phone ? 0.95 : tablet ? 0.64 : 0.76}>
      <group ref={group}>
        {RISK_ZONES.map((z, k) => (
          <group key={z}>
            <mesh position={[0, BASE, 0]} rotation={[-Math.PI / 2, 0, 0]} material={zoneMats[k]}>
              <ringGeometry args={[INNER + k * BAND, INNER + (k + 1) * BAND, 128]} />
            </mesh>
            <mesh position={[0, BASE + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} material={edgeMat}>
              <ringGeometry args={[INNER + (k + 1) * BAND - 0.004, INNER + (k + 1) * BAND, 160]} />
            </mesh>
          </group>
        ))}
        <instancedMesh ref={mesh} args={[sphere, mat, Math.max(1, n)]} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} frustumCulled={false} />
        <instancedMesh ref={rings} args={[ring, ringMat, Math.max(1, n)]} frustumCulled={false} />
        {layout.sectors.map((s) => {
          // Phones: segment labels crowd the zone labels, so only the hovered/picked customer's shows.
          if (phone && s.segment !== shownSegment) return null
          const a = s.start - s.span / 2
          const r = layout.outer + 0.25
          return (
            <Label key={s.segment} position={[Math.cos(a) * r, BASE + 0.05, -Math.sin(a) * r]} tone="muted">
              {s.segment}
            </Label>
          )
        })}
      </group>
      {RISK_ZONES.map((z, k) => (
        <Label key={z} position={[0, BASE + 0.02, INNER + (k + 0.5) * BAND]} tone={focus === z ? 'strong' : 'default'}>
          {z}
          <small>
            {k === 3 ? `> ${layout.edges[3]} d` : `≤ ${layout.edges[k + 1]} d`}
          </small>
        </Label>
      ))}
    </group>
  )
}

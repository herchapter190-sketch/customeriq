import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { hash01, segmentColor } from '../../lib/domain'
import { fmtWhole } from '../../lib/format'
import { Label, lacquer, pointerCursor, stagger, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setFocus, setHover, setPick, useDistrict, useFocus, useHover, type SegCustomer, type SegSummary } from '../store'

/**
 * Customer clusters. Every sphere is one real customer (rfm_customers); its size follows
 * the customer's monetary value. Each segment's cluster holds exactly its customers, so
 * cluster volume tracks segment size, and the cluster sits on a recency × frequency map
 * built from the segment's own averages (segment_summary): recent buyers to the right,
 * frequent buyers higher up.
 */
interface Cluster {
  seg: SegSummary
  centre: THREE.Vector3
  radius: number
  members: SegCustomer[]
  /** index of members[0] in the flat customers array */
  offsets: number[]
  local: THREE.Vector3[]
  sizes: number[]
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function layout(summary: SegSummary[], customers: SegCustomer[]): Cluster[] {
  if (!summary.length) return []
  const index = new Map<string, number[]>()
  customers.forEach((c, i) => {
    const list = index.get(c.segment) ?? []
    list.push(i)
    index.set(c.segment, list)
  })
  const rec = summary.map((s) => s.avg_recency_days)
  const freq = summary.map((s) => Math.log(Math.max(1, s.avg_frequency)))
  const [rLo, rHi] = [Math.min(...rec), Math.max(...rec)]
  const [fLo, fHi] = [Math.min(...freq), Math.max(...freq)]
  const maxMonetary = Math.max(1e-9, ...customers.map((c) => Math.max(0, c.monetary)))

  const clusters: Cluster[] = summary.map((seg, i) => {
    const rx = rHi > rLo ? 1 - (seg.avg_recency_days - rLo) / (rHi - rLo) : 0.5
    const fy = fHi > fLo ? (freq[i] - fLo) / (fHi - fLo) : 0.5
    const ids = (index.get(seg.segment) ?? []).slice().sort((a, b) => hash01(customers[a].id) - hash01(customers[b].id))
    const n = Math.max(1, ids.length)
    const radius = 0.15 * Math.cbrt(n) + 0.12
    const local: THREE.Vector3[] = []
    const sizes: number[] = []
    ids.forEach((ci, j) => {
      // Even fill of a ball: radius ∝ cube root of rank, direction on a golden spiral.
      const r = radius * Math.cbrt((j + 0.5) / n)
      const y = 1 - (2 * (j + 0.5)) / n
      const ring = Math.sqrt(1 - y * y)
      const a = j * GOLDEN
      local.push(new THREE.Vector3(Math.cos(a) * ring * r, y * r, Math.sin(a) * ring * r))
      sizes.push(0.022 + 0.075 * Math.sqrt(Math.max(0, customers[ci].monetary) / maxMonetary))
    })
    return {
      seg,
      centre: new THREE.Vector3(-2.5 + rx * 5, -0.9 + fy * 2.1, i % 2 ? -0.7 : 0.35),
      radius,
      members: ids.map((ci) => customers[ci]),
      offsets: ids,
      local,
      sizes,
    }
  })

  // Gentle relaxation so neighbouring clusters never interpenetrate, keeping the map's meaning.
  for (let it = 0; it < 60; it++) {
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const A = clusters[a]
        const B = clusters[b]
        const d = new THREE.Vector3().subVectors(B.centre, A.centre)
        const min = A.radius + B.radius + 0.28
        const len = d.length() || 0.001
        if (len < min) {
          const push = d.multiplyScalar(((min - len) / len) * 0.5)
          A.centre.sub(push)
          B.centre.add(push)
        }
      }
    }
  }
  return clusters
}

const DIM = new THREE.Color('#2b2420')
const geometryHigh = () => new THREE.SphereGeometry(1, 20, 14)
const geometryLow = () => new THREE.IcosahedronGeometry(1, 2)

export default function SegmentsScene() {
  const data = useDistrict('segments')
  const focus = useFocus('segments')
  const hover = useHover('segments')
  const { quality, motion } = useSceneEnv()
  const presence = usePresence()
  const clusters = useMemo(() => (data ? layout(data.summary, data.customers) : []), [data])
  // Labels sit above their cluster; where two would overlap (similar height, close in x),
  // the later one is lifted so every name stays readable. Display layout only.
  const labelPos = useMemo(() => {
    const pts = clusters.map((c) => [c.centre.x, c.centre.y + c.radius + 0.32, c.centre.z] as [number, number, number])
    const order = pts.map((_, i) => i).sort((a, b) => pts[a][1] - pts[b][1])
    for (let it = 0; it < 8; it++) {
      for (let a = 0; a < order.length; a++) {
        for (let b = a + 1; b < order.length; b++) {
          const A = pts[order[a]]
          const B = pts[order[b]]
          if (Math.abs(A[0] - B[0]) < 1.5 && Math.abs(A[1] - B[1]) < 0.26) B[1] = A[1] + 0.26
        }
      }
    }
    return pts
  }, [clusters])
  const axisTop = useMemo(() => Math.min(2.05, Math.max(1.7, ...labelPos.filter((p) => p[0] < -1.6).map((p) => p[1] + 0.3))), [labelPos])
  const geometry = useMemo(() => (quality === 'high' ? geometryHigh() : geometryLow()), [quality])
  const materials = useMemo(() => clusters.map((c) => lacquer(segmentColor(c.seg.segment))), [clusters])
  const ringMats = useMemo(
    () =>
      clusters.map(
        (c) => new THREE.MeshBasicMaterial({ color: segmentColor(c.seg.segment), transparent: true, opacity: 0.22, toneMapped: false }),
      ),
    [clusters],
  )
  useDisposable(geometry)
  useDisposable(materials)
  useDisposable(ringMats)

  const groups = useRef<(THREE.Group | null)[]>([])
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([])
  const halo = useRef<THREE.Mesh>(null)
  const emphasis = useRef<number[]>([])
  const tmpObj = useMemo(() => new THREE.Object3D(), [])
  const world = useMemo(() => new THREE.Vector3(), [])

  // Write instance matrices once per layout.
  const setMesh = (ci: number) => (m: THREE.InstancedMesh | null) => {
    meshes.current[ci] = m
    if (!m) return
    const c = clusters[ci]
    c.local.forEach((p, j) => {
      tmpObj.position.copy(p)
      tmpObj.scale.setScalar(c.sizes[j])
      tmpObj.updateMatrix()
      m.setMatrixAt(j, tmpObj.matrix)
    })
    m.count = c.local.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }

  // Which cluster/instance is hovered (flat index into data.customers).
  const hovered = useMemo(() => {
    if (hover == null || typeof hover !== 'number') return null
    for (let ci = 0; ci < clusters.length; ci++) {
      const j = clusters[ci].offsets.indexOf(hover)
      if (j >= 0) return { ci, j }
    }
    return null
  }, [hover, clusters])

  useFrame((state, dt) => {
    const p = presence.value
    clusters.forEach((c, ci) => {
      const g = groups.current[ci]
      if (!g) return
      const target = focus == null || focus === c.seg.segment ? 1 : 0
      const e = (emphasis.current[ci] = THREE.MathUtils.damp(emphasis.current[ci] ?? 1, target, 5, dt))
      const s = stagger(p, ci, clusters.length) * (0.86 + 0.14 * e)
      g.scale.setScalar(Math.max(0.0001, s))
      g.rotation.y += dt * 0.05 * motion * (ci % 2 ? 1 : -1)
      g.position.copy(c.centre)
      g.position.y += Math.sin(state.clock.elapsedTime * 0.4 + ci) * 0.03 * motion
      const mat = materials[ci]
      mat.color.set(segmentColor(c.seg.segment)).lerp(DIM, (1 - e) * 0.78)
      mat.envMapIntensity = 0.35 + 0.8 * e
      ringMats[ci].opacity = 0.22 * e * p
    })
    const h = halo.current
    if (h) {
      h.visible = !!hovered
      if (hovered) {
        const c = clusters[hovered.ci]
        const g = groups.current[hovered.ci]
        if (g) {
          world.copy(c.local[hovered.j])
          g.localToWorld(world)
          h.parent?.worldToLocal(world)
          h.position.copy(world)
          h.scale.setScalar(c.sizes[hovered.j] * g.scale.x * 1.9)
          h.quaternion.copy(state.camera.quaternion)
          if (h.parent) h.quaternion.premultiply(h.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
        }
      }
    }
  })

  if (!data) return null

  const onMove = (ci: number) => (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return
    e.stopPropagation()
    setHover('segments', clusters[ci].offsets[e.instanceId])
    pointerCursor(true)
  }
  const onOut = () => {
    setHover('segments', null)
    pointerCursor(false)
  }
  const onClick = (ci: number) => (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return
    e.stopPropagation()
    const c = clusters[ci]
    setFocus('segments', c.seg.segment)
    setPick('segments', c.members[e.instanceId].id)
  }

  return (
    <group position={[-0.45, 0.2, 0]} scale={0.5}>
      {clusters.map((c, ci) => {
        return (
          <group key={c.seg.segment} ref={(g) => void (groups.current[ci] = g)} position={c.centre}>
            <instancedMesh
              ref={setMesh(ci)}
              args={[geometry, materials[ci], Math.max(1, c.local.length)]}
              onPointerMove={onMove(ci)}
              onPointerOut={onOut}
              onClick={onClick(ci)}
            />
            <mesh rotation={[Math.PI / 2 - 0.3, 0, ci * 0.7]} material={ringMats[ci]}>
              <torusGeometry args={[c.radius * 1.18, 0.0035, 6, 160]} />
            </mesh>
          </group>
        )
      })}
      {clusters.map((c, ci) => (
        <Label
          key={`l-${c.seg.segment}`}
          position={labelPos[ci]}
          tone={focus === c.seg.segment ? 'strong' : focus ? 'muted' : 'default'}
        >
          <span className="slabel__dot" style={{ background: segmentColor(c.seg.segment) }} />
          {c.seg.segment}
          <small>{fmtWhole(c.seg.customers)}</small>
        </Label>
      ))}
      <mesh ref={halo} visible={false}>
        <torusGeometry args={[1, 0.06, 8, 48]} />
        <meshBasicMaterial color="#D6FF3F" toneMapped={false} />
      </mesh>
      <Label position={[-3.2, -1.55, 0.6]} tone="muted" align="left">
        ← Longer since last order
      </Label>
      <Label position={[2.9, -1.55, 0.6]} tone="muted" align="right">
        More recent →
      </Label>
      <Label position={[-3.3, axisTop, -0.4]} tone="muted" align="left">
        ↑ More orders per customer
      </Label>
    </group>
  )
}

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fmtWhole } from '../../lib/format'
import { copper, Label, lacquer, useDisposable, usePresence, useSceneEnv } from '../kit'
import { useDistrict, type DataAssembly } from '../store'

/**
 * Geometric assembly. 216 cubes stand for the source rows in proportion: valid sales lines,
 * return lines and rejected rows are split exactly as the API's cleaning summary reports.
 * The workflow stage (empty → uploaded → mapping → validated → importing → imported)
 * decides where they go: scattered, sorted into one column per mapped field, or assembled
 * into the lattice with rejected rows set down outside it.
 */
const N = 216
const SIDE = 6
const PITCH = 0.3
const CUBE = 0.2
const FLOOR = -1.25
type Kind = 'valid' | 'return' | 'rejected'
const COLOR: Record<Kind, string> = { valid: '#F4EBD9', return: '#B34A59', rejected: '#D18A98' }

function kinds(a: DataAssembly): Kind[] {
  const { returns, rejected, total } = a.counts
  const t = Math.max(1, total)
  const nR = returns > 0 ? Math.max(1, Math.round((returns / t) * N)) : 0
  const nX = rejected > 0 ? Math.max(1, Math.round((rejected / t) * N)) : 0
  return Array.from({ length: N }, (_, i) => (i < nX ? 'rejected' : i < nX + nR ? 'return' : 'valid'))
}

function seeded(i: number, k: number) {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function targets(a: DataAssembly, kind: Kind[]): { pos: THREE.Vector3[]; scale: number[]; spin: number } {
  const pos: THREE.Vector3[] = []
  const scale: number[] = []
  const lattice = (i: number) => {
    const x = i % SIDE
    const y = Math.floor(i / (SIDE * SIDE))
    const z = Math.floor(i / SIDE) % SIDE
    return new THREE.Vector3((x - 2.5) * PITCH, FLOOR + 0.15 + y * PITCH, (z - 2.5) * PITCH)
  }
  const scatter = (i: number, r0: number, r1: number) => {
    const u = seeded(i, 1) * 2 - 1
    const th = seeded(i, 2) * Math.PI * 2
    const r = r0 + seeded(i, 3) * (r1 - r0)
    const s = Math.sqrt(1 - u * u)
    return new THREE.Vector3(Math.cos(th) * s * r, u * r * 0.55 + 0.1, Math.sin(th) * s * r * 0.6)
  }
  // Lattice order puts valid rows at the bottom, rejected rows last so they can leave.
  const order = [...kind.keys()].sort((x, y) => (kind[x] === kind[y] ? x - y : kind[x] === 'valid' ? -1 : kind[y] === 'valid' ? 1 : kind[x] === 'return' ? -1 : 1))
  const slot = new Array<number>(N)
  order.forEach((idx, s) => (slot[idx] = s))
  const mapped = a.fields.filter((f) => f.mapped)

  for (let i = 0; i < N; i++) {
    switch (a.stage) {
      case 'empty':
        pos.push(scatter(i, 2.2, 3.4))
        scale.push(0.45)
        break
      case 'uploaded':
      case 'failed':
        pos.push(scatter(i, 1.1, 2.3))
        scale.push(0.8)
        break
      case 'mapping': {
        const cols = Math.max(1, mapped.length)
        const c = i % cols
        const h = Math.floor(i / cols)
        const fi = a.fields.indexOf(mapped[c])
        pos.push(new THREE.Vector3((fi - (a.fields.length - 1) / 2) * 0.4, FLOOR + 0.08 + h * 0.075, 0))
        scale.push(0.34)
        break
      }
      default: {
        const s = slot[i]
        if (kind[i] === 'rejected' && a.stage !== 'validated') {
          // Set down in a neat row in front of the lattice, outside the dataset.
          const k = s - (N - kind.filter((x) => x === 'rejected').length)
          pos.push(new THREE.Vector3(-1.1 + (k % 12) * 0.2, FLOOR + 0.06, 1.35 + Math.floor(k / 12) * 0.2))
          scale.push(0.5)
        } else if (kind[i] === 'rejected') {
          pos.push(lattice(s).add(new THREE.Vector3(0, 0, 1.0 + seeded(i, 4) * 0.3)))
          scale.push(0.9)
        } else {
          pos.push(lattice(s))
          scale.push(1)
        }
      }
    }
  }
  return { pos, scale, spin: a.stage === 'empty' || a.stage === 'uploaded' || a.stage === 'failed' ? 1 : 0 }
}

export default function DataScene() {
  const data = useDistrict('data')
  const { motion } = useSceneEnv()
  const presence = usePresence()
  const kind = useMemo(() => (data ? kinds(data) : []), [data])
  const target = useMemo(() => (data ? targets(data, kind) : null), [data, kind])

  const geometry = useMemo(() => new THREE.BoxGeometry(CUBE, CUBE, CUBE), [])
  const material = useMemo(() => lacquer('#ffffff', { roughness: 0.25 }), [])
  const frameMat = useMemo(() => copper(), [])
  useDisposable(geometry)
  useDisposable(material)
  useDisposable(frameMat)
  const edges = useMemo(() => {
    const size = SIDE * PITCH
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size))
    return g
  }, [])
  useDisposable(edges)
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#B34A59', transparent: true, opacity: 0.8 }), [])
  useDisposable(lineMat)

  const mesh = useRef<THREE.InstancedMesh>(null)
  const frame = useRef<THREE.Group>(null)
  const state = useRef({ pos: Array.from({ length: N }, () => new THREE.Vector3(0, -3, 0)), scale: new Float32Array(N), rot: new Float32Array(N) })
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const colour = useMemo(() => new THREE.Color(), [])

  useFrame((s, dt) => {
    const m = mesh.current
    if (!m || !target || !data) return
    const p = presence.value
    const st = state.current
    const t = s.clock.elapsedTime
    const pulse = data.stage === 'importing' ? (t * 1.2) % 1 : -1
    for (let i = 0; i < N; i++) {
      const lambda = 2.2 + seeded(i, 5) * 2.5
      st.pos[i].x = THREE.MathUtils.damp(st.pos[i].x, target.pos[i].x, lambda, dt)
      st.pos[i].y = THREE.MathUtils.damp(st.pos[i].y, target.pos[i].y + (target.spin ? Math.sin(t * 0.5 + i) * 0.08 * motion : 0), lambda, dt)
      st.pos[i].z = THREE.MathUtils.damp(st.pos[i].z, target.pos[i].z, lambda, dt)
      st.scale[i] = THREE.MathUtils.damp(st.scale[i], target.scale[i] * p, lambda, dt)
      st.rot[i] = target.spin ? st.rot[i] + dt * 0.4 * motion * (seeded(i, 6) - 0.5) : THREE.MathUtils.damp(st.rot[i], Math.round(st.rot[i] / (Math.PI / 2)) * (Math.PI / 2), 4, dt)
      tmp.position.copy(st.pos[i])
      tmp.rotation.set(st.rot[i] * 0.7, st.rot[i], 0)
      tmp.scale.setScalar(Math.max(0.0001, st.scale[i]))
      tmp.updateMatrix()
      m.setMatrixAt(i, tmp.matrix)
      const k = kind[i]
      colour.set(data.stage === 'empty' ? '#4f2232' : data.stage === 'failed' && k !== 'valid' ? '#D18A98' : COLOR[k])
      if (data.stage === 'mapping') colour.set('#F4EBD9')
      if ((data.stage === 'imported' || data.stage === 'loaded') && k === 'valid' && seeded(i, 7) < 0.12) colour.set('#E6A1AE')
      if (pulse >= 0 && Math.abs((st.pos[i].y - FLOOR) / (SIDE * PITCH) - pulse) < 0.08) colour.set('#E6A1AE')
      m.setColorAt(i, colour)
    }
    m.count = N
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (frame.current) {
      const show = data.stage !== 'mapping' && data.stage !== 'empty' ? 1 : 0.25
      frame.current.scale.setScalar(Math.max(0.0001, THREE.MathUtils.damp(frame.current.scale.x, show * p, 4, dt)))
    }
  })

  if (!data) return null
  const size = SIDE * PITCH
  const label: Record<string, string> = {
    empty: 'No dataset loaded',
    loaded: 'Dataset assembled',
    uploaded: 'File read',
    mapping: 'Columns mapped',
    validated: 'Validated',
    importing: 'Importing',
    imported: 'Imported',
    failed: 'Import stopped',
  }

  return (
    <group position={[0.45, 0, 0]} rotation={[0, -0.5, 0]}>
      <instancedMesh ref={mesh} args={[geometry, material, N]} frustumCulled={false} />
      <group ref={frame} position={[0, FLOOR + size / 2, 0]}>
        <lineSegments geometry={edges} material={lineMat} />
        {[-1, 1].map((x) =>
          [-1, 1].map((z) => (
            <mesh key={`${x}${z}`} position={[(x * size) / 2, 0, (z * size) / 2]} material={frameMat}>
              <cylinderGeometry args={[0.012, 0.012, size, 8]} />
            </mesh>
          )),
        )}
      </group>
      {data.stage === 'mapping' &&
        data.fields.map((f, i) => (
          <Label key={f.key} position={[(i - (data.fields.length - 1) / 2) * 0.4, FLOOR - 0.12 - (i % 2) * 0.16, 0.25]} tone={f.mapped ? (f.required ? 'lime' : 'default') : 'orange'}>
            {f.key.replace(/_/g, ' ')}
          </Label>
        ))}
      <Label position={[0, FLOOR + size + 0.45, 0]} tone="strong">
        {label[data.stage]}
        {data.counts.total > 0 && data.stage !== 'empty' && data.stage !== 'mapping' && (
          <small>
            {fmtWhole(data.counts.total)} rows · {fmtWhole(data.counts.rejected)} rejected
          </small>
        )}
      </Label>
    </group>
  )
}

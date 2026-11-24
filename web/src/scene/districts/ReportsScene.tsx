import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { copper, Label, lacquer, pointerCursor, stagger, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setFocus, setHover, useDistrict, useFocus, useHover, usePick } from '../store'

/**
 * Reporting room. Three objects on a plinth stand for the three exports: a folio of pages
 * (PDF report), a sheet of cells (Excel workbook) and a rack of strips, one per CSV table
 * the API offers. Generating an export animates its object; a finished one keeps a lime
 * edge. The orbs circling above are the business findings, one per insight, coloured by
 * kind (orange risk, lime opportunity, ivory information).
 */
const BASE = -1.15
const KIND: Record<string, string> = { risk: '#D18A98', opportunity: '#E6A1AE', info: '#F0CDD4' }
const X = { pdf: -1.25, xlsx: 0, csv: 1.25 } as const
type Kind = keyof typeof X

export default function ReportsScene() {
  const data = useDistrict('reports')
  const focus = useFocus('reports')
  const hover = useHover('reports')
  const pick = usePick('reports')
  const { motion } = useSceneEnv()
  const presence = usePresence()
  const findings = data?.findings ?? []
  const csvCount = data?.csvTables ?? 0

  const pageGeo = useMemo(() => new THREE.BoxGeometry(0.62, 0.012, 0.86), [])
  const cellGeo = useMemo(() => new THREE.BoxGeometry(0.13, 0.05, 0.1), [])
  const stripGeo = useMemo(() => new THREE.BoxGeometry(0.7, 0.05, 0.09), [])
  const orbGeo = useMemo(() => new THREE.SphereGeometry(1, 20, 14), [])
  const paper = useMemo(() => lacquer('#F5E4E8', { roughness: 0.5, clearcoat: 0.3 }), [])
  const cellMat = useMemo(() => lacquer('#F5E4E8', { roughness: 0.35 }), [])
  const stripMat = useMemo(() => copper(), [])
  const plinthMat = useMemo(() => lacquer('#3a1020', { roughness: 0.25 }), [])
  const limeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#E6A1AE', toneMapped: false }), [])
  const orbMats = useMemo(() => Object.fromEntries(Object.entries(KIND).map(([k, c]) => [k, lacquer(c)])), [])
  useDisposable([pageGeo, cellGeo, stripGeo, orbGeo, paper, cellMat, stripMat, plinthMat, limeMat])
  useDisposable(Object.values(orbMats))

  const pages = useRef<(THREE.Mesh | null)[]>([])
  const cells = useRef<(THREE.Mesh | null)[]>([])
  const strips = useRef<(THREE.Mesh | null)[]>([])
  const orbs = useRef<(THREE.Mesh | null)[]>([])
  const objects = useRef<Record<Kind, THREE.Group | null>>({ pdf: null, xlsx: null, csv: null })

  useFrame((state, dt) => {
    const p = presence.value
    const t = state.clock.elapsedTime
    const busy = data?.busy
    ;(Object.keys(X) as Kind[]).forEach((k, i) => {
      const g = objects.current[k]
      if (!g) return
      const s = stagger(p, i, 3, 0.4)
      const lift = focus === k || busy === k ? 0.12 : 0
      g.position.y = THREE.MathUtils.damp(g.position.y, BASE + 0.06 + lift + (1 - s) * -0.6, 5, dt)
      g.scale.setScalar(Math.max(0.0001, s))
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, focus === k ? 0.25 : 0, 4, dt)
    })
    pages.current.forEach((m, i) => {
      if (!m) return
      const fan = busy === 'pdf' ? Math.sin(t * 5 + i * 0.6) * 0.35 * motion : focus === 'pdf' ? i * 0.03 : 0
      m.rotation.z = THREE.MathUtils.damp(m.rotation.z, fan, 6, dt)
      m.position.y = i * 0.024
    })
    cells.current.forEach((m, i) => {
      if (!m) return
      const wave = busy === 'xlsx' ? 1 + Math.abs(Math.sin(t * 4 - i * 0.3)) * 2.5 * motion : 1
      m.scale.y = THREE.MathUtils.damp(m.scale.y, wave, 8, dt)
      m.position.y = (0.05 * m.scale.y) / 2
    })
    strips.current.forEach((m, i) => {
      if (!m) return
      const out = pick === i ? 0.22 : 0
      m.position.z = THREE.MathUtils.damp(m.position.z, out + (busy === 'csv' && pick === i ? Math.sin(t * 6) * 0.05 * motion : 0), 6, dt)
    })
    orbs.current.forEach((m, i) => {
      if (!m) return
      const n = Math.max(1, findings.length)
      const a = (i / n) * Math.PI * 2 + t * 0.12 * motion
      const r = 2.05
      const s = stagger(p, i, n, 0.5)
      m.position.set(Math.cos(a) * r, BASE + 1.6 + Math.sin(a * 2 + i) * 0.12, Math.sin(a) * r * 0.45)
      m.scale.setScalar(Math.max(0.0001, (hover === i ? 0.11 : 0.075) * s))
    })
  })

  if (!data) return null
  const done = new Set(data.done)

  const over = (k: Kind) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setFocus('reports', k)
    pointerCursor(true)
  }
  const out = () => pointerCursor(false)
  const orbOver = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover('reports', i)
    pointerCursor(true)
  }
  const orbOut = () => (setHover('reports', null), pointerCursor(false))
  const hovered = typeof hover === 'number' ? findings[hover] : null

  return (
    <group position={[0.1, 0.45, 0]} rotation={[0.12, -0.18, 0]} scale={0.78}>
      <mesh position={[0, BASE - 0.05, 0]} material={plinthMat}>
        <cylinderGeometry args={[2.25, 2.3, 0.08, 96]} />
      </mesh>

      <group ref={(g) => void (objects.current.pdf = g)} position={[X.pdf, BASE, 0]} onPointerOver={over('pdf')} onPointerOut={out}>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} ref={(m) => void (pages.current[i] = m)} geometry={pageGeo} material={i === 8 && done.has('pdf') ? limeMat : paper} />
        ))}
      </group>

      <group ref={(g) => void (objects.current.xlsx = g)} position={[X.xlsx, BASE, 0]} onPointerOver={over('xlsx')} onPointerOut={out}>
        {Array.from({ length: 30 }, (_, i) => (
          <mesh
            key={i}
            ref={(m) => void (cells.current[i] = m)}
            geometry={cellGeo}
            material={done.has('xlsx') && i % 6 === 0 ? limeMat : cellMat}
            position={[((i % 6) - 2.5) * 0.145, 0, (Math.floor(i / 6) - 2) * 0.115]}
          />
        ))}
      </group>

      <group ref={(g) => void (objects.current.csv = g)} position={[X.csv, BASE, 0]} onPointerOver={over('csv')} onPointerOut={out}>
        {Array.from({ length: csvCount }, (_, i) => (
          <mesh
            key={i}
            ref={(m) => void (strips.current[i] = m)}
            geometry={stripGeo}
            material={pick === i ? (done.has('csv') ? limeMat : paper) : stripMat}
            position={[0, 0.03 + i * 0.075, 0]}
          />
        ))}
      </group>

      {findings.map((f, i) => (
        <mesh
          key={i}
          ref={(m) => void (orbs.current[i] = m)}
          geometry={orbGeo}
          material={orbMats[f.kind] ?? orbMats.info}
          onPointerOver={orbOver(i)}
          onPointerOut={orbOut}
        />
      ))}

      <Label position={[X.pdf, BASE - 0.32, 0.55]} tone={focus === 'pdf' ? 'strong' : 'muted'}>PDF report</Label>
      <Label position={[X.xlsx, BASE - 0.32, 0.55]} tone={focus === 'xlsx' ? 'strong' : 'muted'}>Excel workbook</Label>
      <Label position={[X.csv, BASE - 0.32, 0.55]} tone={focus === 'csv' ? 'strong' : 'muted'}>CSV tables</Label>
      {hovered && (
        <Label position={[0, BASE + 2.25, 0]} tone={hovered.kind === 'risk' ? 'orange' : hovered.kind === 'opportunity' ? 'lime' : 'strong'}>
          {hovered.title}
        </Label>
      )}
    </group>
  )
}

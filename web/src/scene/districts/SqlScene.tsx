import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { SQL_FAMILY_COLORS, type SqlFamily } from '../../lib/domain'
import { fmtWhole } from '../../lib/format'
import { Label, pointerCursor, stagger, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setFocus, setHover, useDistrict, useFocus, useHover } from '../store'

/**
 * A quiet archive: one slab per fixed query file, arranged in two curved rows and grouped
 * by family. The selected query slides forward; when it runs, its result rows are laid out
 * as lines of light in front of it (one line per row, up to 80), labelled with the true count.
 */
const ROW_LINES = 80

export default function SqlScene() {
  const data = useDistrict('sql')
  const focus = useFocus('sql')
  const hover = useHover('sql')
  const { motion } = useSceneEnv()
  const presence = usePresence()
  const names = data?.names ?? []
  const n = names.length
  const perRow = Math.ceil(n / 2)

  const slots = useMemo(
    () =>
      names.map((_, i) => {
        const row = Math.floor(i / perRow)
        const col = i % perRow
        const a = ((col - (perRow - 1) / 2) / Math.max(1, perRow - 1)) * 1.35
        const r = 3.4
        return { pos: new THREE.Vector3(Math.sin(a) * r, row === 0 ? 0.45 : -0.42, -Math.cos(a) * r + r - 0.6), rotY: -a }
      }),
    [names, perRow],
  )

  const slabGeo = useMemo(() => new THREE.BoxGeometry(0.4, 0.6, 0.03), [])
  const edgeGeo = useMemo(() => new THREE.BoxGeometry(0.4, 0.018, 0.034), [])
  const lineGeo = useMemo(() => new THREE.BoxGeometry(0.9, 0.006, 0.006), [])
  const slabMats = useMemo(
    () =>
      names.map(
        () =>
          new THREE.MeshPhysicalMaterial({ color: '#2f2925', roughness: 0.18, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 }),
      ),
    [names],
  )
  const edgeMats = useMemo(
    () => (data?.families ?? []).map((f) => new THREE.MeshBasicMaterial({ color: SQL_FAMILY_COLORS[f as SqlFamily] ?? '#8E8578', toneMapped: false })),
    [data?.families],
  )
  const lineMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#D6FF3F', transparent: true, opacity: 0.85, toneMapped: false }), [])
  useDisposable(slabGeo)
  useDisposable(edgeGeo)
  useDisposable(lineGeo)
  useDisposable(slabMats)
  useDisposable(edgeMats)
  useDisposable(lineMat)

  const groups = useRef<(THREE.Group | null)[]>([])
  const lines = useRef<THREE.InstancedMesh>(null)
  const shown = useRef(0)
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const sel = typeof focus === 'string' ? names.indexOf(focus) : -1

  useFrame((state, dt) => {
    const p = presence.value
    const t = state.clock.elapsedTime
    slots.forEach((s, i) => {
      const g = groups.current[i]
      if (!g) return
      const on = i === sel
      const k = stagger(p, i, n, 0.5)
      g.position.x = THREE.MathUtils.damp(g.position.x, on ? 0.15 : s.pos.x, 4, dt)
      g.position.y = THREE.MathUtils.damp(g.position.y, on ? 0.55 : s.pos.y - (1 - k) * 0.6, 4, dt)
      g.position.z = THREE.MathUtils.damp(g.position.z, on ? 1.45 : s.pos.z, 4, dt)
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, on ? 0 : s.rotY, 4, dt)
      const sc = (on ? 1.35 : hover === names[i] ? 1.08 : 1) * k
      g.scale.setScalar(Math.max(0.0001, THREE.MathUtils.damp(g.scale.x, sc, 6, dt)))
      const mat = slabMats[i]
      const glow = on && data?.running ? 0.25 + 0.2 * Math.sin(t * 6) : on ? 0.12 : 0
      mat.emissive.set('#D6FF3F')
      mat.emissiveIntensity = glow * motion + (on ? 0.08 : 0)
    })
    const m = lines.current
    if (m) {
      const want = data?.resultRows != null && sel >= 0 ? Math.min(ROW_LINES, data.resultRows) : 0
      shown.current = THREE.MathUtils.damp(shown.current, want, 3, dt)
      const count = Math.round(shown.current)
      for (let i = 0; i < count; i++) {
        tmp.position.set(0.15 + 0.85, 0.85 - i * 0.022, 1.45)
        tmp.scale.set(0.4 + 0.6 * Math.abs(Math.sin(i * 1.7)), 1, 1)
        tmp.updateMatrix()
        m.setMatrixAt(i, tmp.matrix)
      }
      m.count = count
      m.instanceMatrix.needsUpdate = true
    }
  })

  if (!data || n === 0) return null

  const onMove = (name: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover('sql', name)
    pointerCursor(true)
  }
  const onOut = () => {
    setHover('sql', null)
    pointerCursor(false)
  }
  const onClick = (name: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    setFocus('sql', name)
  }
  const hoverIdx = typeof hover === 'string' ? names.indexOf(hover) : -1

  return (
    <group position={[-0.2, 0.15, -0.9]} scale={0.78}>
      {slots.map((s, i) => (
        <group key={names[i]} ref={(g) => void (groups.current[i] = g)} position={s.pos} rotation={[0, s.rotY, 0]}>
          <mesh geometry={slabGeo} material={slabMats[i]} onPointerMove={onMove(names[i])} onPointerOut={onOut} onClick={onClick(names[i])} />
          <mesh geometry={edgeGeo} material={edgeMats[i]} position={[0, 0.3, 0]} />
        </group>
      ))}
      <instancedMesh ref={lines} args={[lineGeo, lineMat, ROW_LINES]} frustumCulled={false} />
      {hoverIdx >= 0 && hoverIdx !== sel && (
        <Label position={[slots[hoverIdx].pos.x, slots[hoverIdx].pos.y + 0.48, slots[hoverIdx].pos.z]} tone="strong">
          {names[hoverIdx]}
        </Label>
      )}
      {sel >= 0 && (
        <Label position={[0.15, 1.2, 1.45]} tone="lime">
          {names[sel]}
          {data.resultRows != null && <small>{data.running ? 'running…' : `${fmtWhole(data.resultRows)} rows`}</small>}
        </Label>
      )}
    </group>
  )
}

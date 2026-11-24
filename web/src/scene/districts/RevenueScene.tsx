import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import gsap from 'gsap'
import * as THREE from 'three'
import { fmtCompact } from '../../lib/format'
import { Label, pointerCursor, satin, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setHover, useDistrict, useHover } from '../store'

/**
 * Metallic ribbon. Height at each point is the API value for that point (month, or Pareto
 * step); the ribbon only interpolates smoothly between real points (cosine, no overshoot).
 * Switching metric or view morphs the same ribbon to the new values.
 */
const SUB = 12
const BASE_Y = -1.05
const HEIGHT = 2.3

const centre = (u: number) => new THREE.Vector3(-2.3 + 4.6 * u, BASE_Y, 0.75 * Math.sin(u * Math.PI * 1.5 + 0.35))

function sampleHeights(values: number[], max: number, m: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(m)
  const n = values.length
  for (let s = 0; s < m; s++) {
    const x = n > 1 ? (s / (m - 1)) * (n - 1) : 0
    const i = Math.min(n - 2, Math.floor(x))
    const t = n > 1 ? x - i : 0
    const a = values[Math.max(0, i)] ?? 0
    const b = values[Math.min(n - 1, i + 1)] ?? a
    const k = (1 - Math.cos(t * Math.PI)) / 2
    out[s] = 0.06 + (HEIGHT * Math.max(0, a + (b - a) * k)) / max
  }
  return out
}

export default function RevenueScene() {
  const data = useDistrict('revenue')
  const hover = useHover('revenue')
  const { motion, reduced } = useSceneEnv()
  const presence = usePresence()
  const invalidate = useThree((s) => s.invalidate)
  const series = data?.series ?? []
  const n = series.length
  const m = Math.max(2, (Math.max(2, n) - 1) * SUB + 1)

  const max = useMemo(() => Math.max(1e-9, ...series.map((p) => p.value)), [series])
  const morph = useRef<{ t: number; from: Float32Array<ArrayBuffer>; to: Float32Array<ArrayBuffer> }>({ t: 1, from: new Float32Array(m), to: new Float32Array(m) })

  // Ribbon + lime edge strip share the sample layout.
  const [ribbon, edge] = useMemo(() => {
    const make = () => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 2 * 3), 3))
      const uv = new Float32Array(m * 2 * 2)
      const idx: number[] = []
      for (let s = 0; s < m; s++) {
        uv.set([s / (m - 1), 0, s / (m - 1), 1], s * 4)
        if (s < m - 1) {
          const a = s * 2
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      g.setIndex(idx)
      return g
    }
    return [make(), make()]
  }, [m])
  useDisposable(ribbon)
  useDisposable(edge)
  const material = useMemo(() => satin("#641C36", { sheen: 0.45, metalness: 0.7, roughness: 0.3 }), [])
  const edgeMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#E6A1AE', side: THREE.DoubleSide, toneMapped: false }),
    [],
  )
  const tickMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4EBD9', transparent: true, opacity: 0.22 }), [])
  useDisposable(material)
  useDisposable(edgeMat)
  useDisposable(tickMat)

  // New values: morph from whatever is on screen now.
  useEffect(() => {
    const mo = morph.current
    const next = sampleHeights(series.map((p) => p.value), max, m)
    const current = new Float32Array(m)
    if (mo.from.length === m && mo.to.length === m) {
      for (let s = 0; s < m; s++) current[s] = mo.from[s] + (mo.to[s] - mo.from[s]) * mo.t
    }
    mo.from = current
    mo.to = next
    gsap.killTweensOf(mo)
    if (reduced) {
      mo.t = 1
      invalidate()
    } else {
      mo.t = 0
      gsap.to(mo, { t: 1, duration: 1.4, ease: 'power3.inOut', onUpdate: invalidate })
    }
  }, [series, max, m, reduced, invalidate])

  const marker = useRef<THREE.Group>(null)
  const markerBar = useRef<THREE.Mesh>(null)
  const heightAt = (s: number) => {
    const mo = morph.current
    return mo.from[s] + (mo.to[s] - mo.from[s]) * mo.t
  }

  useFrame((state) => {
    const p = presence.value
    const pos = ribbon.attributes.position as THREE.BufferAttribute
    const epos = edge.attributes.position as THREE.BufferAttribute
    const t = state.clock.elapsedTime
    for (let s = 0; s < m; s++) {
      const u = s / (m - 1)
      const grow = THREE.MathUtils.clamp((p * 1.35 - u * 0.35) / 1, 0, 1)
      const h = heightAt(s) * grow
      const c = centre(u)
      // Satin flow: a slow lean of the top edge, never changing the height that is read.
      const lean = Math.sin(u * Math.PI * 3 + t * 0.35 * motion) * 0.12 * (h / HEIGHT)
      pos.setXYZ(s * 2, c.x, c.y, c.z)
      pos.setXYZ(s * 2 + 1, c.x, c.y + h, c.z + lean)
      epos.setXYZ(s * 2, c.x, c.y + h - 0.028, c.z + lean)
      epos.setXYZ(s * 2 + 1, c.x, c.y + h + 0.006, c.z + lean)
    }
    pos.needsUpdate = true
    epos.needsUpdate = true
    ribbon.computeVertexNormals()
    ribbon.computeBoundingSphere()
    const g = marker.current
    if (g) {
      g.visible = typeof hover === 'number' && hover < n
      if (g.visible && typeof hover === 'number') {
        const s = n > 1 ? Math.round((hover / (n - 1)) * (m - 1)) : 0
        const c = centre(s / (m - 1))
        const h = heightAt(s)
        g.position.set(c.x, c.y, c.z + 0.02)
        markerBar.current?.scale.set(1, h, 1)
      }
    }
  })

  if (!data || n === 0) return null

  const indexOf = (e: ThreeEvent<PointerEvent>) => (e.uv ? Math.round(e.uv.x * (n - 1)) : null)
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover('revenue', indexOf(e))
    pointerCursor(true)
  }
  const onOut = () => {
    setHover('revenue', null)
    pointerCursor(false)
  }

  const peak = series.reduce((best, p, i) => (p.value > series[best].value ? i : best), 0)
  const at = (i: number) => {
    const u = n > 1 ? i / (n - 1) : 0
    const c = centre(u)
    return [c.x, c.y + 0.06 + (HEIGHT * Math.max(0, series[i].value)) / max + 0.22, c.z] as [number, number, number]
  }

  return (
    <group position={[0.1, 0.35, 0]} scale={0.66}>
      <mesh geometry={ribbon} material={material} onPointerMove={onMove} onPointerOut={onOut} />
      <mesh geometry={edge} material={edgeMat} />
      {/* point ticks on the floor: one per real data point */}
      {series.map((_, i) => {
        const c = centre(n > 1 ? i / (n - 1) : 0)
        return (
          <mesh key={i} position={[c.x, BASE_Y - 0.004, c.z]} material={tickMat} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.022, 12]} />
          </mesh>
        )
      })}
      <group ref={marker} visible={false}>
        <mesh ref={markerBar} position={[0, 0, 0]}>
          <boxGeometry args={[0.012, 1, 0.012]} />
          <meshBasicMaterial color="#D18A98" toneMapped={false} />
        </mesh>
      </group>
      <Label position={at(0)} tone="muted">
        {series[0].label}
        <small>{fmtCompact(series[0].value)}</small>
      </Label>
      {peak !== 0 && peak !== n - 1 && (
        <Label position={at(peak)} tone="lime">
          {data.key === 'pareto' ? series[peak].label : `Peak · ${series[peak].label}`}
          <small>{fmtCompact(series[peak].value)}</small>
        </Label>
      )}
      <Label position={at(n - 1)}>
        {series[n - 1].label}
        <small>{fmtCompact(series[n - 1].value)}</small>
      </Label>
      {typeof hover === 'number' && series[hover] && (
        <Label position={[at(hover)[0], at(hover)[1] + 0.28, at(hover)[2]]} tone="strong">
          {series[hover].label}
          <small>
            {fmtCompact(series[hover].value)}
            {data.unit}
          </small>
        </Label>
      )}
    </group>
  )
}

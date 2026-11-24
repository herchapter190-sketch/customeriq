import { useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { fmtPct } from '../../lib/format'
import { copper, glass, Label, lacquer, pointerCursor, stagger, useDisposable, usePresence, useSceneEnv } from '../kit'
import { setFocus, setHover, useDistrict, useFocus, useHover, type CohortRing } from '../store'

/**
 * Orbital rings. One ring per acquisition cohort (oldest outermost). Around each ring,
 * months since first purchase run clockwise from twelve o'clock; a bead at month k is
 * sized by that cohort's retention % (cohort_long), and the particles drifting inside
 * each month's arc are proportional to the customers still active that month.
 */
const angleOf = (k: number, maxK: number) => Math.PI / 2 - (k / Math.max(1, maxK + 1)) * Math.PI * 2
const radiusOf = (i: number, n: number) => (n <= 1 ? 1.6 : 2.55 - (i / (n - 1)) * 1.85)

const particleVertex = /* glsl */ `
  uniform float uTime; uniform float uMotion; uniform float uPixel; uniform float uFocus; uniform float uPresence;
  attribute float aRadius; attribute float aStart; attribute float aSpan; attribute float aSeed; attribute float aRing;
  varying float vAlpha; varying float vSel;
  void main() {
    float a = aStart - fract(aSeed + uTime * 0.025 * uMotion) * aSpan;
    float r = aRadius * (0.6 + 0.4 * uPresence) + (aSeed - 0.5) * 0.05;
    vec3 p = vec3(cos(a) * r, (fract(aSeed * 13.7) - 0.5) * 0.06, -sin(a) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vSel = uFocus < 0.0 ? 1.0 : (abs(aRing - uFocus) < 0.5 ? 1.0 : 0.0);
    gl_PointSize = (1.4 + 1.6 * vSel) * uPixel * (5.0 / -mv.z);
    vAlpha = (0.25 + 0.6 * vSel) * uPresence;
    gl_Position = projectionMatrix * mv;
  }`
const particleFragment = /* glsl */ `
  varying float vAlpha; varying float vSel;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    vec3 c = mix(vec3(0.95, 0.92, 0.85), vec3(0.84, 1.0, 0.25), vSel);
    gl_FragColor = vec4(c, smoothstep(0.5, 0.0, d) * vAlpha);
  }`

function buildParticles(rings: CohortRing[], maxK: number) {
  const totalActive = rings.reduce((s, r) => s + r.points.filter((p) => p.k > 0).reduce((a, p) => a + p.active, 0), 0)
  const perParticle = Math.max(1, totalActive / 2600) // one particle ≈ this many active customers
  const radius: number[] = []
  const start: number[] = []
  const span: number[] = []
  const seed: number[] = []
  const ring: number[] = []
  let s = 1
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  rings.forEach((r, i) => {
    r.points.forEach((p) => {
      if (p.k < 1) return
      const count = Math.round(p.active / perParticle)
      const a0 = angleOf(p.k - 0.5, maxK)
      const a1 = angleOf(p.k + 0.5, maxK)
      for (let c = 0; c < count; c++) {
        radius.push(radiusOf(i, rings.length))
        start.push(a0)
        span.push(a0 - a1)
        seed.push(rnd())
        ring.push(i)
      }
    })
  })
  const g = new THREE.BufferGeometry()
  const n = radius.length
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aRadius', new THREE.BufferAttribute(new Float32Array(radius), 1))
  g.setAttribute('aStart', new THREE.BufferAttribute(new Float32Array(start), 1))
  g.setAttribute('aSpan', new THREE.BufferAttribute(new Float32Array(span), 1))
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seed), 1))
  g.setAttribute('aRing', new THREE.BufferAttribute(new Float32Array(ring), 1))
  return { geometry: g, perParticle }
}

export default function CohortsScene() {
  const data = useDistrict('cohorts')
  const focus = useFocus('cohorts')
  const hover = useHover('cohorts')
  const { quality, motion } = useSceneEnv()
  const presence = usePresence()
  const dpr = useThree((s) => s.viewport.dpr)
  const rings = data?.rings ?? []
  const maxK = data?.maxK ?? 0
  const n = rings.length
  const sel = typeof focus === 'number' ? focus : typeof hover === 'number' ? hover : -1

  const { geometry: particles } = useMemo(() => buildParticles(rings, maxK), [rings, maxK])
  useDisposable(particles)
  const pMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uPixel: { value: 1 }, uFocus: { value: -1 }, uPresence: { value: 0 } },
      }),
    [],
  )
  const ringMat = useMemo(() => copper({ roughness: 0.4 }), [])
  const ringDim = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4EBD9', transparent: true, opacity: 0.16 }), [])
  const glassMat = useMemo(() => glass(quality), [quality])
  const beadMat = useMemo(() => lacquer('#D18A98'), [])
  const beadGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), [])
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), [])
  useDisposable(pMat)
  useDisposable(ringMat)
  useDisposable(ringDim)
  useDisposable(glassMat)
  useDisposable(beadMat)
  useDisposable(beadGeo)
  useDisposable(hitMat)

  // One bead per (cohort, month ≥ 1), sized by retention %.
  const beads = useMemo(() => {
    const list: { i: number; k: number; pct: number }[] = []
    rings.forEach((r, i) => r.points.forEach((p) => p.k >= 1 && list.push({ i, k: p.k, pct: p.pct })))
    return list
  }, [rings])
  const beadMesh = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  const ringRefs = useRef<(THREE.Mesh | null)[]>([])
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const colour = useMemo(() => new THREE.Color(), [])

  useFrame((state, dt) => {
    const p = presence.value
    pMat.uniforms.uTime.value = state.clock.elapsedTime
    pMat.uniforms.uMotion.value = motion
    pMat.uniforms.uPixel.value = dpr
    pMat.uniforms.uFocus.value = sel
    pMat.uniforms.uPresence.value = p
    if (group.current) group.current.rotation.y += dt * 0.02 * motion
    ringRefs.current.forEach((m, i) => {
      if (!m) return
      const s = stagger(p, n - 1 - i, n, 0.6)
      m.scale.setScalar(Math.max(0.001, s))
      m.position.y = sel === i ? THREE.MathUtils.damp(m.position.y, 0.22, 6, dt) : THREE.MathUtils.damp(m.position.y, 0, 6, dt)
    })
    const mesh = beadMesh.current
    if (mesh) {
      beads.forEach((b, j) => {
        const r = radiusOf(b.i, n) * stagger(p, n - 1 - b.i, n, 0.6)
        const a = angleOf(b.k, maxK)
        const lift = ringRefs.current[b.i]?.position.y ?? 0
        tmp.position.set(Math.cos(a) * r, lift, -Math.sin(a) * r)
        tmp.scale.setScalar(0.01 + 0.05 * Math.sqrt(Math.max(0, b.pct) / 100))
        tmp.updateMatrix()
        mesh.setMatrixAt(j, tmp.matrix)
        mesh.setColorAt(j, colour.set(sel < 0 || sel === b.i ? (sel === b.i ? '#E6A1AE' : '#D18A98') : '#4f2232'))
      })
      mesh.count = beads.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  if (!data || n === 0) return null

  const onMove = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover('cohorts', i)
    pointerCursor(true)
  }
  const onOut = () => {
    setHover('cohorts', null)
    pointerCursor(false)
  }
  const onClick = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    setFocus('cohorts', focus === i ? null : i)
  }
  const outer = radiusOf(0, n) + 0.32
  const labelled = sel >= 0 ? rings[sel] : null

  return (
    <group position={[-0.35, 0.1, 0]} rotation={[0.62, 0, 0]} scale={0.6}>
      <group ref={group}>
        {rings.map((r, i) => (
          <mesh
            key={r.cohort}
            ref={(m) => void (ringRefs.current[i] = m)}
            rotation={[Math.PI / 2, 0, 0]}
            material={sel === i ? glassMat : sel < 0 && i % 6 === 0 ? ringMat : ringDim}
          >
            <torusGeometry args={[radiusOf(i, n), sel === i ? 0.028 : i % 6 === 0 ? 0.009 : 0.0045, 10, 180]} />
            <mesh material={hitMat} onPointerMove={onMove(i)} onPointerOut={onOut} onClick={onClick(i)}>
              <torusGeometry args={[radiusOf(i, n), 0.035, 4, 90]} />
            </mesh>
          </mesh>
        ))}
        <instancedMesh ref={beadMesh} args={[beadGeo, beadMat, Math.max(1, beads.length)]} frustumCulled={false} />
        <points geometry={particles} material={pMat} frustumCulled={false} />
        {Array.from({ length: Math.floor(maxK / 3) + 1 }, (_, j) => j * 3).map((k) => {
          const a = angleOf(k, maxK)
          return (
            <Label key={k} position={[Math.cos(a) * outer, 0, -Math.sin(a) * outer]} tone="muted">
              {k === 0 ? 'First month' : `+${k} mo`}
            </Label>
          )
        })}
        {labelled && (
          <Label position={[0, 0.5, 0]} tone="strong">
            Cohort {labelled.cohort}
            <small>
              {labelled.size} customers · month 1 {fmtPct(labelled.points.find((p) => p.k === 1)?.pct ?? null)}
            </small>
          </Label>
        )}
      </group>
    </group>
  )
}

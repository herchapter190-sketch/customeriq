import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RGB } from './store'

/* ------------------------------------------------------------------ geometry */

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Family {
  count: number
  radius: number
  tube: number
  color: readonly number[]
  glow: number
  /** integer weave frequency, so each loop closes seamlessly */
  freq: number
  /** radial over/under amplitude (fraction of radius) */
  amp: number
  /** out-of-plane undulation */
  wobble: number
}

const OUTER: Family[] = [
  { count: 30, radius: 1.0, tube: 0.0068, color: RGB.ivory, glow: 0.28, freq: 5, amp: 0.03, wobble: 0.05 },
  { count: 7, radius: 1.014, tube: 0.0056, color: RGB.lime, glow: 1.0, freq: 7, amp: 0.028, wobble: 0.08 },
  { count: 4, radius: 1.17, tube: 0.0042, color: RGB.orange, glow: 0.85, freq: 3, amp: 0.02, wobble: 0.22 },
]
const INNER: Family[] = [
  { count: 16, radius: 0.74, tube: 0.0078, color: RGB.burgundyLift, glow: 0.3, freq: 4, amp: 0.05, wobble: 0.08 },
]

function buildStrands(families: Family[], segments: number): THREE.BufferGeometry {
  const rand = mulberry32(20261123)
  const parts: THREE.BufferGeometry[] = []
  const Y = new THREE.Vector3(0, 1, 0)
  const X = new THREE.Vector3(1, 0, 0)

  families.forEach((f, fi) => {
    for (let i = 0; i < f.count; i++) {
      // Fibonacci-distributed axes give an even, non-repeating lattice of great circles.
      const k = (i + 0.5) / f.count
      const phi = Math.acos(1 - 2 * k)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i + fi * 1.31
      const axis = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
      const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? Y : X).normalize()
      const v = new THREE.Vector3().crossVectors(axis, u)
      const phase = rand() * Math.PI * 2

      const pts: THREE.Vector3[] = []
      for (let s = 0; s < segments; s++) {
        const t = (s / segments) * Math.PI * 2
        const p = u
          .clone()
          .multiplyScalar(Math.cos(t))
          .addScaledVector(v, Math.sin(t))
          .addScaledVector(axis, Math.sin(t * f.freq + phase) * f.wobble)
          .normalize()
        p.multiplyScalar(f.radius * (1 + f.amp * Math.sin(t * f.freq * 2 + phase * 1.7)))
        pts.push(p)
      }
      const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal')
      const geo = new THREE.TubeGeometry(curve, Math.round(segments * 1.5), f.tube * (0.75 + rand() * 0.5), 5, true)
      const n = geo.attributes.position.count
      const seed = rand()
      const aSeed = new Float32Array(n).fill(seed)
      const aGlow = new Float32Array(n).fill(f.glow)
      const aColor = new Float32Array(n * 3)
      for (let j = 0; j < n; j++) aColor.set(f.color, j * 3)
      geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1))
      geo.setAttribute('aGlow', new THREE.BufferAttribute(aGlow, 1))
      geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3))
      parts.push(geo)
    }
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  if (!merged) throw new Error('Could not build the woven sphere')
  merged.computeBoundingSphere()
  return merged
}

/* ------------------------------------------------------------------ shaders */

const strandVertex = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  attribute float aSeed;
  attribute float aGlow;
  attribute vec3 aColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vColor;
  varying float vU;
  varying float vSeed;
  varying float vGlow;
  varying float vDepth;
  void main() {
    vec3 p = position;
    // Breathing weave: each strand ripples along its length, out from the sphere centre.
    float ripple = sin(uv.x * 6.2831853 * 3.0 + uTime * 0.55 * uMotion + aSeed * 6.2831853);
    p += normalize(position) * ripple * 0.016;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vColor = aColor;
    vU = uv.x;
    vSeed = aSeed;
    vGlow = aGlow;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const strandFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uDim;
  uniform float uNear;
  uniform vec3 uBg;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vColor;
  varying float vU;
  varying float vSeed;
  varying float vGlow;
  varying float vDepth;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec3 key = normalize(vec3(-0.55, 0.75, 0.45));   // ivory key light, upper left (view space)
    vec3 rim = normalize(vec3(0.6, -0.65, -0.2));    // burnt-orange kicker from below right
    float diff = max(dot(n, key), 0.0);
    float kick = max(dot(n, rim), 0.0);
    float spec = pow(max(dot(n, normalize(key + v)), 0.0), 56.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);

    vec3 col = vColor * (0.16 + 0.9 * diff);
    col += vec3(0.902, 0.42, 0.263) * kick * 0.32;
    col += vec3(1.0, 0.97, 0.9) * spec * 0.6;
    col += vColor * fres * 0.22;

    // Light pulses travelling along the strand (data "in flight").
    float travel = fract(vU * 2.0 - uTime * 0.07 * uMotion + vSeed * 3.7);
    float pulse = smoothstep(0.94, 1.0, travel) * (1.0 - smoothstep(0.995, 1.0, travel));
    col += vColor * pulse * vGlow * 1.6;

    // Atmospheric depth: far strands sink into the espresso background.
    float fog = smoothstep(uNear - 0.6, uNear + 1.6, vDepth);
    col = mix(col, uBg, fog * 0.78);
    col = mix(uBg, col, uDim);
    gl_FragColor = vec4(col, 1.0);
  }
`

const coreVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`
const coreFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDim;
  uniform vec3 uInner;
  uniform vec3 uEdge;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 1.8);
    vec3 col = mix(uInner, uEdge, f);
    float a = (0.08 + 0.55 * f) * uDim;
    gl_FragColor = vec4(col, a);
  }
`

/* ------------------------------------------------------------------ component */

interface Props {
  motion: number
  dim: { value: number }
  quality: 'high' | 'low'
}

export function WovenSphere({ motion, dim, quality }: Props) {
  const group = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const [outerGeo, innerGeo] = useMemo(() => {
    const seg = quality === 'high' ? 260 : 150
    return [buildStrands(OUTER, seg), buildStrands(INNER, Math.round(seg * 0.7))]
  }, [quality])
  useEffect(() => () => (outerGeo.dispose(), innerGeo.dispose()), [outerGeo, innerGeo])

  const strandMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: strandVertex,
        fragmentShader: strandFragment,
        uniforms: {
          uTime: { value: 0 },
          uMotion: { value: 1 },
          uDim: { value: 1 },
          uNear: { value: 4.6 },
          uBg: { value: new THREE.Vector3(...RGB.espresso) },
        },
      }),
    [],
  )
  const coreMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uDim: { value: 1 },
          uInner: { value: new THREE.Vector3(...RGB.burgundy) },
          uEdge: { value: new THREE.Vector3(...RGB.orange) },
        },
      }),
    [],
  )
  useEffect(() => () => (strandMat.dispose(), coreMat.dispose()), [strandMat, coreMat])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    strandMat.uniforms.uTime.value = t
    strandMat.uniforms.uMotion.value = motion
    strandMat.uniforms.uDim.value = dim.value
    strandMat.uniforms.uNear.value = state.camera.position.length()
    coreMat.uniforms.uDim.value = dim.value
    if (group.current) {
      group.current.rotation.y += delta * 0.05 * motion
      group.current.rotation.x = Math.sin(t * 0.11) * 0.08 * motion + 0.18
    }
    if (inner.current) {
      inner.current.rotation.y -= delta * 0.09 * motion
      inner.current.scale.setScalar(1 + Math.sin(t * 0.6) * 0.012 * motion)
    }
  })

  return (
    <group ref={group}>
      <mesh geometry={outerGeo} material={strandMat} frustumCulled={false} />
      <group ref={inner}>
        <mesh geometry={innerGeo} material={strandMat} frustumCulled={false} />
        <mesh material={coreMat} renderOrder={2}>
          <icosahedronGeometry args={[0.5, quality === 'high' ? 6 : 3]} />
        </mesh>
      </group>
    </group>
  )
}

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RGB } from './store'

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uPixel;
  uniform float uDim;
  attribute float aSeed;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float a = uTime * 0.018 * uMotion * (0.35 + aSeed);
    float c = cos(a), s = sin(a);
    p.xz = mat2(c, -s, s, c) * p.xz;
    p.y += sin(uTime * 0.25 * uMotion + aSeed * 31.0) * 0.05;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (1.2 + aSeed * 2.2) * uPixel * (4.5 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    float twinkle = 0.65 + 0.35 * sin(uTime * 0.7 * uMotion + aSeed * 47.0);
    vAlpha = aAlpha * twinkle * uDim;
  }
`
const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.05, d) * vAlpha);
  }
`

/** A restrained dust field around the sphere: mostly ivory, a few lime and orange motes. */
export function Particles({ count, motion, dim }: { count: number; motion: number; dim: { value: number } }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    const alpha = new Float32Array(count)
    let r = 9301
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1
      const th = rnd() * Math.PI * 2
      const rad = 1.55 + Math.pow(rnd(), 0.7) * 3.2
      const s = Math.sqrt(1 - u * u)
      pos.set([Math.cos(th) * s * rad, u * rad * 0.8, Math.sin(th) * s * rad], i * 3)
      const pick = rnd()
      col.set(pick < 0.07 ? RGB.lime : pick < 0.13 ? RGB.orange : RGB.ivory, i * 3)
      seed[i] = rnd()
      alpha[i] = pick < 0.13 ? 0.75 : 0.22 + rnd() * 0.3
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
    return g
  }, [count])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uPixel: { value: 1 }, uDim: { value: 1 } },
      }),
    [],
  )
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    material.uniforms.uMotion.value = motion
    material.uniforms.uPixel.value = dpr
    material.uniforms.uDim.value = 0.55 + 0.45 * dim.value
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}

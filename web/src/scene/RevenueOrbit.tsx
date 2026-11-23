import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { HEX, sceneStore, useScene } from './store'

const MAX = 120
const RADIUS = 1.4

/**
 * Real data in the scene: one bar per month of net revenue, standing on a tilted ring
 * around the woven sphere. Hovering a bar reports the month to the HTML overlay.
 */
export function RevenueOrbit({ motion, dim, interactive }: { motion: number; dim: { value: number }; interactive: boolean }) {
  const months = useScene((s) => s.months)
  const hovered = useScene((s) => s.hovered)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const ring = useRef<THREE.Group>(null)
  const material = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }), [])
  const geometry = useMemo(() => new THREE.BoxGeometry(0.016, 1, 0.016).translate(0, 0.5, 0), [])
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: HEX.ivory, transparent: true, opacity: 0.3, toneMapped: false }),
    [],
  )
  useEffect(() => () => (material.dispose(), geometry.dispose(), ringMat.dispose()), [material, geometry, ringMat])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const data = months.slice(-MAX)
    const max = Math.max(1e-9, ...data.map((d) => Math.max(0, d.net)))
    const obj = new THREE.Object3D()
    const colour = new THREE.Color()
    data.forEach((d, i) => {
      const a = (i / data.length) * Math.PI * 2
      obj.position.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS)
      obj.scale.set(1, 0.04 + 0.42 * (Math.max(0, d.net) / max), 1)
      obj.updateMatrix()
      m.setMatrixAt(i, obj.matrix)
      const hex = i === hovered ? HEX.orange : i === data.length - 1 ? HEX.lime : HEX.ivory
      m.setColorAt(i, colour.set(hex))
    })
    m.count = data.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    invalidate() // needed when the canvas renders on demand (reduced motion)
  }, [months, hovered, invalidate])

  useFrame((_, delta) => {
    if (ring.current) ring.current.rotation.y += delta * 0.035 * motion
    material.opacity = 0.9 * dim.value
    ringMat.opacity = 0.3 * dim.value
  })

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || e.instanceId == null) return
    e.stopPropagation()
    if (sceneStore.get().hovered !== e.instanceId) sceneStore.set({ hovered: e.instanceId })
    document.body.style.cursor = 'crosshair'
  }
  const onOut = () => {
    sceneStore.set({ hovered: null })
    document.body.style.cursor = ''
  }

  return (
    <group rotation={[0.42, 0, -0.12]}>
      <group ref={ring}>
        <mesh material={ringMat} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[RADIUS, 0.0018, 6, 256]} />
        </mesh>
        <instancedMesh
          ref={mesh}
          args={[geometry, material, MAX]}
          frustumCulled={false}
          onPointerMove={onMove}
          onPointerOut={onOut}
          visible={months.length > 0}
        />
      </group>
    </group>
  )
}

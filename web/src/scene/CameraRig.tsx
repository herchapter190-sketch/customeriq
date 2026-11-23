import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import gsap from 'gsap'
import * as THREE from 'three'

interface Pose {
  pos: [number, number, number]
  target: [number, number, number]
  dim: number
}

/** Camera framing per route. Only the overview has its own environment in Stage 3A;
 *  other routes pull back to a quiet, distant view of the same world. */
function poseFor(slug: string, wide: boolean): Pose {
  if (slug === 'overview') {
    return wide
      ? { pos: [-1.45, 0.12, 5.3], target: [-1.45, 0.02, 0], dim: 1 }
      : { pos: [0, -1.05, 6.9], target: [0, -1.05, 0], dim: 0.9 }
  }
  return wide
    ? { pos: [-3.4, 1.9, 10.5], target: [-2.6, 0.1, 0], dim: 0.42 }
    : { pos: [0, 2.4, 11.5], target: [0, -1.6, 0], dim: 0.38 }
}

const INTRO: Pose = { pos: [0.6, 1.8, 13], target: [0, 0, 0], dim: 0 }

export function CameraRig({ slug, reduced, dim }: { slug: string; reduced: boolean; dim: { value: number } }) {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const invalidate = useThree((s) => s.invalidate)
  const base = useRef({ px: INTRO.pos[0], py: INTRO.pos[1], pz: INTRO.pos[2], tx: 0, ty: 0, tz: 0 })
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 })
  const first = useRef(true)
  const lookAt = useRef(new THREE.Vector3())

  const wide = width >= 960 && width / Math.max(1, height) > 1.05

  useEffect(() => {
    const pose = poseFor(slug, wide)
    const to = { px: pose.pos[0], py: pose.pos[1], pz: pose.pos[2], tx: pose.target[0], ty: pose.target[1], tz: pose.target[2] }
    gsap.killTweensOf(base.current)
    gsap.killTweensOf(dim)
    if (reduced) {
      Object.assign(base.current, to)
      dim.value = pose.dim
      invalidate()
    } else {
      const intro = first.current
      gsap.to(base.current, { ...to, duration: intro ? 3.2 : 1.8, ease: intro ? 'expo.out' : 'power3.inOut', onUpdate: invalidate })
      gsap.to(dim, { value: pose.dim, duration: intro ? 2.4 : 1.2, ease: 'sine.inOut', onUpdate: invalidate })
    }
    first.current = false
  }, [slug, wide, reduced, dim, invalidate])

  useEffect(() => {
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduced])

  useFrame((state, delta) => {
    const p = pointer.current
    const k = 1 - Math.exp(-delta * 2.2) // frame-rate independent smoothing
    p.sx += (p.x - p.sx) * k
    p.sy += (p.y - p.sy) * k
    const b = base.current
    const drift = reduced ? 0 : Math.sin(state.clock.elapsedTime * 0.17) * 0.06
    camera.position.set(b.px + p.sx * 0.32, b.py - p.sy * 0.2 + drift, b.pz)
    lookAt.current.set(b.tx + p.sx * 0.08, b.ty - p.sy * 0.05, b.tz)
    camera.lookAt(lookAt.current)
  })

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = width < 640 ? 42 : 35
    cam.updateProjectionMatrix()
  }, [camera, width])

  return null
}

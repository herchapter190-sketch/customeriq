import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import gsap from 'gsap'
import * as THREE from 'three'
import { portraitZoom, worldPose, type Vec3 } from './districts'

interface Pose {
  pos: Vec3
  target: Vec3
  dim: number
}

/**
 * Every route flies to its district. On wide screens the subject is framed on its own axis and the
 * projection is shifted (see the view offset below) so it sits centred in the space beside the text column.
 */
function poseFor(slug: string, wide: boolean, zoom: number): Pose {
  if (slug === 'overview') {
    return wide
      ? { pos: [0, 0.12, 6.4 * zoom], target: [0, 0.02, 0], dim: 1 }
      : { pos: [0, -1.05, 6.9], target: [0, -1.05, 0], dim: 0.9 }
  }
  const district = worldPose(slug, wide, zoom)
  if (district) return { ...district, dim: 0.3 }
  return wide
    ? { pos: [-3.4, 1.9, 10.5], target: [-2.6, 0.1, 0], dim: 0.42 }
    : { pos: [0, 2.4, 11.5], target: [0, -1.6, 0], dim: 0.38 }
}

/** Free-area height ÷ width at the 1440×900 reference the district framings were tuned for. */
const FREE_RATIO = 900 / 650

const INTRO: Pose = { pos: [0.6, 1.8, 13], target: [0, 0, 0], dim: 0 }

/**
 * One camera for the whole world. Route changes fly it along an arc between districts
 * (lifted in proportion to the distance, so long journeys rise over the ring instead of
 * cutting through other environments); pointer parallax is layered on top.
 */
export function CameraRig({ slug, reduced, dim }: { slug: string; reduced: boolean; dim: { value: number } }) {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const invalidate = useThree((s) => s.invalidate)
  const from = useRef<Pose>(INTRO)
  const to = useRef<Pose>(INTRO)
  const flight = useRef({ t: 1, lift: 0 })
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 })
  const first = useRef(true)
  const cur = useRef({ pos: new THREE.Vector3(...INTRO.pos), target: new THREE.Vector3(...INTRO.target) })
  const lookAt = useRef(new THREE.Vector3())

  const wide = width >= 960 && width / Math.max(1, height) > 1.05
  // Right edge of the HTML text column on wide screens; the scene is centred in the space after it.
  const [column, setColumn] = useState(0)
  useEffect(() => {
    const page = wide ? document.querySelector('main.page') : null
    setColumn(page ? Math.min(width * 0.6, Math.round(page.getBoundingClientRect().right)) : 0)
  }, [wide, width, height])
  const free = width - column
  // Wide: pull back when the free area is narrower (relative to its height) than at 1440×900.
  // Narrow: pull back on portrait screens. Quantised so a resize only re-frames on a real change.
  const zoom = wide
    ? Math.round(Math.min(1.8, Math.max(0.9, height / Math.max(1, free) / FREE_RATIO)) * 10) / 10
    : Math.round(portraitZoom(width / Math.max(1, height)) * 10) / 10

  useEffect(() => {
    const pose = poseFor(slug, wide, zoom)
    gsap.killTweensOf(flight.current)
    gsap.killTweensOf(dim)
    // Start from wherever the camera is now, even mid-flight.
    from.current = { pos: cur.current.pos.toArray() as Vec3, target: cur.current.target.toArray() as Vec3, dim: dim.value }
    to.current = pose
    const distance = new THREE.Vector3(...pose.pos).distanceTo(cur.current.pos)
    if (reduced) {
      flight.current.t = 1
      flight.current.lift = 0
      dim.value = pose.dim
      invalidate()
    } else {
      const intro = first.current
      flight.current.t = 0
      flight.current.lift = intro ? 0 : Math.min(6, distance * 0.22)
      const duration = intro ? 3.2 : Math.min(2.8, 1.5 + distance * 0.04)
      gsap.to(flight.current, { t: 1, duration, ease: intro ? 'expo.out' : 'power3.inOut', onUpdate: invalidate })
      gsap.to(dim, { value: pose.dim, duration: intro ? 2.4 : 1.2, ease: 'sine.inOut', onUpdate: invalidate })
    }
    first.current = false
  }, [slug, wide, zoom, reduced, dim, invalidate])

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
    const { t, lift } = flight.current
    const a = from.current
    const b = to.current
    const arc = Math.sin(Math.PI * t) * lift
    cur.current.pos.set(...a.pos).lerp(new THREE.Vector3(...b.pos), t)
    cur.current.pos.y += arc
    cur.current.target.set(...a.target).lerp(new THREE.Vector3(...b.target), t)
    cur.current.target.y += arc * 0.35

    const p = pointer.current
    const k = 1 - Math.exp(-delta * 2.2) // frame-rate independent smoothing
    p.sx += (p.x - p.sx) * k
    p.sy += (p.y - p.sy) * k
    const drift = reduced ? 0 : Math.sin(state.clock.elapsedTime * 0.17) * 0.06
    // Parallax runs in the camera's own right/up axes so it feels the same in every district.
    const right = new THREE.Vector3().subVectors(cur.current.target, cur.current.pos).cross(camera.up).normalize()
    camera.position.copy(cur.current.pos).addScaledVector(right, p.sx * 0.32)
    camera.position.y += -p.sy * 0.2 + drift
    lookAt.current.copy(cur.current.target).addScaledVector(right, p.sx * 0.08)
    lookAt.current.y -= p.sy * 0.05
    camera.lookAt(lookAt.current)
  })

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = width < 640 ? 42 : 35
    // Shift the projection right by half the column so the frame's centre is the free area's centre.
    if (column > 0) cam.setViewOffset(width, height, -column / 2, 0, width, height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
    invalidate()
  }, [camera, width, height, column, invalidate])

  return null
}

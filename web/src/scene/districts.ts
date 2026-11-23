import * as THREE from 'three'

/**
 * The world: the Executive Overview's woven sphere sits at the origin, and the eight other
 * environments are "districts" on a ring around a shared centre, in navigation order, so
 * neighbouring pages are neighbours in space. Each district faces outward from the ring
 * centre; the camera stands outside the ring looking in, so distant districts and the
 * sphere stay faintly visible behind the active one.
 */
export type Vec3 = [number, number, number]
export interface LocalPose {
  pos: Vec3
  target: Vec3
}
export interface DistrictDef {
  slug: string
  position: Vec3
  rotationY: number
  wide: LocalPose
  narrow: LocalPose
}

export const RING_CENTRE: Vec3 = [0, 0, -16]
const RADIUS = 16
const ORDER = ['segments', 'revenue', 'cohorts', 'behaviour', 'inactive', 'data', 'sql', 'reports']

/** Per-district framing in the district's own frame: the subject sits at the local origin,
 *  the camera target is pushed left on wide screens so the subject clears the text column. */
const FRAMING: Record<string, { wide: LocalPose; narrow: LocalPose }> = {
  segments: { wide: { pos: [-2.5, 1.1, 9.2], target: [-2.5, 0.1, 0] }, narrow: { pos: [0, 1.6, 12.5], target: [0, -2.2, 0] } },
  revenue: { wide: { pos: [-2.6, 1.6, 8.8], target: [-2.4, 0.5, 0] }, narrow: { pos: [0, 2.2, 12], target: [0, -1.6, 0] } },
  cohorts: { wide: { pos: [-2.6, 2.6, 8.4], target: [-2.6, -0.1, 0] }, narrow: { pos: [0, 3.4, 11.5], target: [0, -2.1, 0] } },
  behaviour: { wide: { pos: [-2.4, 3.4, 7.6], target: [-2.3, 0.3, 0] }, narrow: { pos: [0, 4.2, 10.5], target: [0, -1.5, 0] } },
  inactive: { wide: { pos: [-2.6, 4.6, 7.8], target: [-2.6, -0.1, 0] }, narrow: { pos: [0, 6.2, 9.8], target: [0, -2.4, 0] } },
  data: { wide: { pos: [-2.4, 1.3, 8.4], target: [-2.3, 0.4, 0] }, narrow: { pos: [0, 1.8, 11.5], target: [0, -1.8, 0] } },
  sql: { wide: { pos: [-2.3, 1.0, 7.8], target: [-2.2, 0.35, 0] }, narrow: { pos: [0, 1.4, 10.5], target: [0, -1.6, 0] } },
  reports: { wide: { pos: [-2.4, 1.6, 7.6], target: [-2.3, 0.55, 0] }, narrow: { pos: [0, 2.0, 10.4], target: [0, -1.4, 0] } },
}

export const DISTRICTS: Record<string, DistrictDef> = Object.fromEntries(
  ORDER.map((slug, i) => {
    const theta = ((i + 1) * Math.PI * 2) / 9
    const position: Vec3 = [
      RING_CENTRE[0] + Math.sin(theta) * RADIUS,
      0,
      RING_CENTRE[2] + Math.cos(theta) * RADIUS,
    ]
    return [slug, { slug, position, rotationY: theta, ...FRAMING[slug] }]
  }),
)

const tmp = new THREE.Vector3()
const toWorld = (d: DistrictDef, v: Vec3): Vec3 => {
  tmp.set(...v).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.rotationY)
  return [tmp.x + d.position[0], tmp.y + d.position[1], tmp.z + d.position[2]]
}

/**
 * `zoom` > 1 pulls the camera back along its line of sight. Narrow portrait screens (phones)
 * see far less horizontally at the same vertical field of view, so wide subjects such as the
 * 24-hour grid would be cropped without it.
 */
export function worldPose(slug: string, wide: boolean, zoom = 1): LocalPose | null {
  const d = DISTRICTS[slug]
  if (!d) return null
  const local = wide ? d.wide : d.narrow
  const pos = local.pos.map((v, i) => local.target[i] + (v - local.target[i]) * zoom) as Vec3
  return { pos: toWorld(d, pos), target: toWorld(d, local.target) }
}

/** Camera pull-back for portrait screens: 1 at aspect >= 0.75, up to 1.7 on a tall phone. */
export const portraitZoom = (aspect: number) => Math.min(1.7, Math.max(1, 0.75 / Math.max(0.3, aspect)))

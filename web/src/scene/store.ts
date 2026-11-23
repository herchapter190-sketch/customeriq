import { useSyncExternalStore } from 'react'

/** Tiny shared store between DOM pages and the persistent WebGL scene. */
export interface MonthPoint {
  month: string
  net: number
}

interface SceneState {
  months: MonthPoint[]
  hovered: number | null
  ready: boolean
  mode: 'webgl' | '2d'
}

let state: SceneState = { months: [], hovered: null, ready: false, mode: 'webgl' }
const listeners = new Set<() => void>()

export const sceneStore = {
  get: () => state,
  set(patch: Partial<SceneState>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function useScene<T>(select: (s: SceneState) => T): T {
  return useSyncExternalStore(sceneStore.subscribe, () => select(state))
}

/** Palette as raw sRGB floats (custom shaders write display values directly). */
const raw = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
export const HEX = {
  lime: '#D6FF3F',
  burgundy: '#641C36',
  ivory: '#F4EBD9',
  espresso: '#27231F',
  orange: '#E66B43',
} as const
export const RGB = {
  lime: raw(HEX.lime),
  burgundy: raw(HEX.burgundy),
  burgundyLift: raw('#9A3457'), // burgundy lifted for visibility on espresso
  ivory: raw(HEX.ivory),
  espresso: raw(HEX.espresso),
  orange: raw(HEX.orange),
}

import { useSyncExternalStore } from 'react'

/**
 * Standard Analytics (2D charts, the default) or 3D Exploration (the Three.js environments).
 * Per-browser convenience only: remembered in localStorage when available, never required.
 * `?3d` in the URL opens 3D Exploration directly.
 */
export type ViewMode = 'standard' | '3d'
const KEY = 'customeriq.viewMode'

function initial(): ViewMode {
  try {
    if (new URLSearchParams(window.location.search).has('3d')) return '3d'
    return window.localStorage.getItem(KEY) === '3d' ? '3d' : 'standard'
  } catch {
    return 'standard'
  }
}

let mode: ViewMode = initial()
const listeners = new Set<() => void>()
document.documentElement.dataset.mode = mode

export function setViewMode(next: ViewMode) {
  if (next === mode) return
  mode = next
  document.documentElement.dataset.mode = mode
  try {
    window.localStorage.setItem(KEY, mode)
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  listeners.forEach((l) => l())
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => mode,
  )
}
export const useIsStandard = () => useViewMode() === 'standard'

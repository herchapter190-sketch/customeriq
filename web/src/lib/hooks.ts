import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const RM_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(RM_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(RM_QUERY).matches,
  )
}

export type AsyncState<T> =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | { state: 'done'; data: T }

/** Run an abortable async loader; `reload` re-runs it. Stale results are discarded. */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): [AsyncState<T>, () => void] {
  const [state, setState] = useState<AsyncState<T>>({ state: 'loading' })
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const controller = new AbortController()
    setState({ state: 'loading' })
    loadRef
      .current(controller.signal)
      .then((data) => !controller.signal.aborted && setState({ state: 'done', data }))
      .catch((error: unknown) => !controller.signal.aborted && setState({ state: 'error', error }))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return [state, reload]
}

/** True if this browser can create a WebGL context (checked once). `?2d` forces the fallback. */
let webglCache: boolean | null = null
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache
  try {
    if (new URLSearchParams(window.location.search).has('2d')) return (webglCache = false)
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webglCache = !!gl
    ;(gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webglCache = false
  }
  return webglCache
}

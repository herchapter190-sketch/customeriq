/**
 * Typed client for the local CustomerIQ API, always same-origin under `/api`
 * (the Vite dev proxy in development, the API itself in production).
 *
 * Credentials: none live here. The browser holds an HttpOnly session cookie that
 * JavaScript cannot read; the CSRF token is kept only in this module's memory
 * (never in storage) and is useless without the cookie.
 */
import type { AnalyticsMap, AnalyticsName, DatasetInfo, Filters, SessionInfo } from './types'

export type ApiErrorKind = 'auth' | 'offline' | 'no-data' | 'invalid' | 'server'

export class ApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind
  constructor(status: number, kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.kind = kind
  }
}

let csrfToken: string | null = null

const TIMEOUT_MS = 60_000

function kindFor(res: Response): ApiErrorKind {
  if (res.status === 401 || res.status === 403) return 'auth'
  if (res.status === 409) return 'no-data'
  if (res.status === 422 || res.status === 404 || res.status === 413) return 'invalid'
  if (res.headers.get('x-ciq-proxy') === 'unreachable' || res.status === 502 || res.status === 504) return 'offline'
  return 'server'
}

async function detailOf(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    const detail = (body as { detail?: unknown })?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return 'The request was not accepted by the API.'
  } catch {
    /* non-JSON body */
  }
  return `Request failed (${res.status})`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (method !== 'GET') {
    headers.set('Content-Type', 'application/json')
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal ?? controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !init.signal?.aborted) {
      throw new ApiError(0, 'offline', 'The CustomerIQ API took too long to respond.')
    }
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'offline', 'The CustomerIQ API could not be reached.')
  } finally {
    window.clearTimeout(timer)
  }
  if (!res.ok) {
    const kind = kindFor(res)
    if (kind === 'auth') csrfToken = null
    throw new ApiError(res.status, kind, await detailOf(res))
  }
  return (await res.json()) as T
}

export const api = {
  health: () => request<{ status: string; api_version: string }>('/health'),

  /** Never throws for "signed out"; resolves `{ authenticated: false }` instead. */
  async session(): Promise<SessionInfo> {
    try {
      const info = await request<{ authenticated: boolean; csrf_token?: string }>('/session')
      csrfToken = info.csrf_token ?? null
      return { authenticated: info.authenticated }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { authenticated: false }
      throw err
    }
  },

  /** Top-level navigation: the API redeems the single-use code, sets the cookie and redirects to "/". */
  signInWithCode(code: string): void {
    window.location.assign(`/api/session/start?code=${encodeURIComponent(code)}`)
  },

  async logout(): Promise<void> {
    await request<{ logged_out: boolean }>('/session/logout', { method: 'POST', body: '{}' })
    csrfToken = null
  },

  dataset: (signal?: AbortSignal) => request<DatasetInfo>('/dataset', { signal }),

  analytics<K extends AnalyticsName>(name: K, filters: Filters = {}, signal?: AbortSignal) {
    return request<AnalyticsMap[K]>(`/analytics/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ filters }),
      signal,
    })
  },

  batch<K extends AnalyticsName>(names: readonly K[], filters: Filters = {}, signal?: AbortSignal) {
    return request<Pick<AnalyticsMap, K>>('/analytics/batch', {
      method: 'POST',
      body: JSON.stringify({ filters, names }),
      signal,
    })
  },
}

/** Extract a login code from a pasted link (…/api/session/start?code=…) or a bare code. */
export function parseLoginCode(input: string): string | null {
  const value = input.trim()
  let code = value
  if (value.includes('code=')) {
    try {
      code = new URL(value, window.location.origin).searchParams.get('code') ?? ''
    } catch {
      return null
    }
  }
  return /^[A-Za-z0-9_-]{8,128}$/.test(code) ? code : null
}

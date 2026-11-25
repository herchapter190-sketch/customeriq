/**
 * Typed client for the local CustomerIQ API, always same-origin under `/api`
 * (the Vite dev proxy in development, the API itself in production).
 *
 * Credentials: none live here. The browser holds an HttpOnly session cookie that
 * JavaScript cannot read; the CSRF token is kept only in this module's memory
 * (never in storage) and is useless without the cookie.
 */
import type {
  AnalyticsMap,
  AnalyticsName,
  ApiMeta,
  DatasetInfo,
  Filters,
  Frame,
  ImportPreview,
  ImportResult,
  SessionInfo,
  SqlResult,
} from './types'

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

/* Requests in flight, for a quiet "Updating…" cue while pages keep their current results. */
let inflight = 0
const inflightListeners = new Set<() => void>()
const bump = (d: number) => {
  inflight += d
  inflightListeners.forEach((l) => l())
}
export const pending = {
  get: () => inflight,
  subscribe(l: () => void) {
    inflightListeners.add(l)
    return () => void inflightListeners.delete(l)
  },
}

const TIMEOUT_MS = 60_000
// The server finishes these even if the browser stops waiting (a large import takes minutes), so a
// client timeout would report a failure for a dataset change that still happens. They get none.
const NO_TIMEOUT = /^\/(import\/(preview|commit)|dataset\/(demo|clear))$/

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
    if (Array.isArray(detail)) {
      // Pydantic validation: field + rule only (e.g. "monetary_thresholds: Input should be ≥ 0").
      const first = detail[0] as { loc?: unknown[]; msg?: unknown } | undefined
      const field = Array.isArray(first?.loc) ? String(first.loc[first.loc.length - 1] ?? '') : ''
      if (typeof first?.msg === 'string') return `${field ? `${field}: ` : ''}${first.msg}`.slice(0, 200)
      return 'The request was not accepted by the API.'
    }
  } catch {
    /* non-JSON body */
  }
  return `Request failed (${res.status})`
}

async function send(path: string, init: RequestInit = {}, accept = 'application/json'): Promise<Response> {
  const controller = new AbortController()
  const timer = NO_TIMEOUT.test(path) ? undefined : window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  headers.set('Accept', accept)
  if (method !== 'GET') {
    // Multipart uploads let the browser write their own boundary header.
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  }
  let res: Response
  bump(1)
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
      // The API is running but busy (very large datasets can take minutes); it keeps the result once done.
      throw new ApiError(0, 'server', 'The CustomerIQ API took too long to respond. Large datasets can take a few minutes; retry shortly.')
    }
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'offline', 'The CustomerIQ API could not be reached.')
  } finally {
    window.clearTimeout(timer)
    bump(-1)
  }
  if (!res.ok) {
    const kind = kindFor(res)
    if (kind === 'auth') csrfToken = null
    throw new ApiError(res.status, kind, await detailOf(res))
  }
  return res
}

const RETRY_DELAY_MS = 700
const wait = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (window.clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))), { once: true })
  })

/**
 * JSON request. Read-only calls (`read: true`) are retried once after a dropped connection or a
 * proxy 502 — e.g. the API restarting — but never after a timeout, and writes are never retried.
 */
async function request<T>(path: string, init: RequestInit = {}, read = false): Promise<T> {
  try {
    return (await (await send(path, init)).json()) as T
  } catch (err) {
    const transient = err instanceof ApiError && err.kind === 'offline'
    if (!read || !transient || init.signal?.aborted) throw err
    await wait(RETRY_DELAY_MS, init.signal)
    return (await (await send(path, init)).json()) as T
  }
}

/** POST that returns a file; the browser saves it under the server's filename. */
async function download(path: string, body: unknown, fallbackName: string): Promise<string> {
  const res = await send(path, { method: 'POST', body: JSON.stringify(body) }, '*/*')
  const blob = await res.blob()
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')
  const name = match?.[1] ?? fallbackName
  saveBlob(blob, name)
  return name
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

interface Extra {
  customer_id?: string
  limit?: number
  currency?: string
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

  dataset: (signal?: AbortSignal) => request<DatasetInfo>('/dataset', { signal }, true),

  meta: (signal?: AbortSignal) => request<ApiMeta>('/meta', { signal }, true),

  analytics<K extends AnalyticsName>(name: K, filters: Filters = {}, signal?: AbortSignal, extra: Extra = {}) {
    return request<AnalyticsMap[K]>(`/analytics/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ filters, ...extra }),
      signal,
    }, true)
  },

  batch<K extends AnalyticsName>(names: readonly K[], filters: Filters = {}, signal?: AbortSignal) {
    return request<Pick<AnalyticsMap, K>>('/analytics/batch', {
      method: 'POST',
      body: JSON.stringify({ filters, names }),
      signal,
    }, true)
  },

  /** The fixed SQL library: names (and SQL text only if the API was started with it enabled). */
  sqlList: (signal?: AbortSignal) => request<{ queries: { name: string; sql?: string }[] }>('/sql', { signal }, true),

  /** Runs one documented query file by name. There is no way to send SQL text. */
  sqlRun(name: string, filters: Filters, customerId?: string, signal?: AbortSignal) {
    return request<SqlResult>(`/sql/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ filters, ...(customerId ? { customer_id: customerId } : {}) }),
      signal,
    }, true)
  },

  reportPdf: (filters: Filters, currency: string) => download('/reports/pdf', { filters, currency }, 'customeriq_report.pdf'),
  reportXlsx: (filters: Filters, currency: string) =>
    download('/reports/xlsx', { filters, currency }, 'customeriq_workbook.xlsx'),
  reportCsv: (name: string, filters: Filters) =>
    download(`/reports/csv/${encodeURIComponent(name)}`, { filters }, `customeriq_${name}.csv`),

  importPreview(file: File, signal?: AbortSignal) {
    const body = new FormData()
    body.append('file', file, file.name)
    return request<ImportPreview>('/import/preview', { method: 'POST', body, signal })
  },
  importCommit(uploadId: string, mapping: Record<string, string | null>, options: CleaningOptions) {
    return request<ImportResult>('/import/commit', {
      method: 'POST',
      body: JSON.stringify({ upload_id: uploadId, mapping, options, confirm: true }),
    })
  },
  /** Raw synthetic demo export (with its injected data-quality issues); generated server-side, writes nothing. */
  demoRawCsv: (seed: number, customers: number) =>
    download('/dataset/demo/raw', { seed, n_customers: customers }, 'customeriq_synthetic_raw.csv'),
  loadDemo: (seed: number, customers: number) =>
    request<ImportResult>('/dataset/demo', {
      method: 'POST',
      body: JSON.stringify({ seed, n_customers: customers, confirm: true }),
    }),
  clearDataset: () =>
    request<{ cleared: boolean; backup_created: boolean }>('/dataset/clear', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),
  rejected: (limit = 100, signal?: AbortSignal) => request<Frame>(`/dataset/rejected?limit=${limit}`, { signal }, true),
}

export interface CleaningOptions {
  return_invoice_prefix: string
  dayfirst: boolean
  drop_zero_price: boolean
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

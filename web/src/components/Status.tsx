import { useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, parseLoginCode } from '../api/client'
import { useSession } from '../api/session'
import { useScene } from '../scene/store'

export function Loading({ label = 'Reading the dataset' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading__line" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  )
}

export function Notice({ title, children, tone = 'neutral' }: { title: string; children: ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <section className={`notice notice--${tone}`} role={tone === 'warn' ? 'alert' : undefined}>
      <h2 className="notice__title">{title}</h2>
      {children}
    </section>
  )
}

/** Explains an API failure in plain words and offers the right next step. */
export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { signedOut, recheck } = useSession()
  const kind = error instanceof ApiError ? error.kind : 'server'
  if (kind === 'auth') {
    return (
      <Notice title="Your session has ended" tone="warn">
        <p>Sign in again to keep reading live data.</p>
        <button className="btn" type="button" onClick={signedOut}>Sign in</button>
      </Notice>
    )
  }
  if (kind === 'offline') {
    return (
      <Notice title="The CustomerIQ API is not reachable" tone="warn">
        <p>Start it from the project folder, then retry:</p>
        <pre className="cmd">.\.venv\Scripts\python.exe -m src.api</pre>
        <button className="btn" type="button" onClick={() => (recheck(), onRetry())}>Retry</button>
      </Notice>
    )
  }
  return (
    <Notice title="This view could not be loaded" tone="warn">
      <p>{error instanceof Error ? error.message : 'Unexpected error.'}</p>
      <button className="btn" type="button" onClick={onRetry}>Retry</button>
    </Notice>
  )
}

export function SignIn() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = parseLoginCode(value)
    if (!code) return setError('That does not look like a CustomerIQ login link.')
    setValue('')
    api.signInWithCode(code)
  }
  return (
    <Notice title="Sign in to the local API">
      <p>
        The API prints a single-use login link when it starts. For a fresh one, run this in the project folder:
      </p>
      <pre className="cmd">.\.venv\Scripts\python.exe -m src.api login-link</pre>
      <p>Paste the link here. It is used once and never stored by this page.</p>
      <form className="signin" onSubmit={submit}>
        <label htmlFor="login-link" className="sr-only">Login link</label>
        <input
          id="login-link"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="http://127.0.0.1:8520/api/session/start?code=…"
          value={value}
          onChange={(e) => (setValue(e.target.value), setError(''))}
        />
        <button className="btn btn--solid" type="submit">Sign in</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Notice>
  )
}

/** Gate for data views: renders children only when the session is usable. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { status, message, recheck } = useSession()
  if (status === 'checking') return <Loading label="Connecting to the API" />
  if (status === 'signed-out') return <SignIn />
  if (status === 'offline') {
    return <ErrorPanel error={new ApiError(0, 'offline', message)} onRetry={recheck} />
  }
  return <>{children}</>
}

export function BootVeil() {
  const ready = useScene((s) => s.ready)
  const [gone, setGone] = useState(false)
  if (gone) return null
  return (
    <div className={`veil${ready ? ' is-done' : ''}`} onTransitionEnd={() => ready && setGone(true)} aria-hidden={ready}>
      <p className="veil__mark">Customer<span>IQ</span></p>
      <span className="veil__line" />
      <p className="veil__label">Composing the scene</p>
    </div>
  )
}

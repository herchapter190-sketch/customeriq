import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './client'

export type SessionStatus = 'checking' | 'ready' | 'signed-out' | 'offline'

interface SessionValue {
  status: SessionStatus
  message: string
  /** Public read-only demo: no imports, loads or clears. */
  demo: boolean
  recheck: () => void
  signedOut: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('checking')
  const [message, setMessage] = useState('')
  const [demo, setDemo] = useState(false)

  const recheck = useCallback(() => {
    setStatus('checking')
    api
      .session()
      .then((s) => {
        setDemo(s.mode === 'demo')
        setStatus(s.authenticated ? 'ready' : 'signed-out')
      })
      .catch((err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : 'The CustomerIQ API could not be reached.')
        setStatus('offline')
      })
  }, [])

  useEffect(recheck, [recheck])

  const value = useMemo<SessionValue>(
    () => ({ status, message, demo, recheck, signedOut: () => setStatus('signed-out') }),
    [status, message, demo, recheck],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './client'

export type SessionStatus = 'checking' | 'ready' | 'signed-out' | 'offline'

interface SessionValue {
  status: SessionStatus
  message: string
  recheck: () => void
  signedOut: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('checking')
  const [message, setMessage] = useState('')

  const recheck = useCallback(() => {
    setStatus('checking')
    api
      .session()
      .then((s) => setStatus(s.authenticated ? 'ready' : 'signed-out'))
      .catch((err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : 'The CustomerIQ API could not be reached.')
        setStatus('offline')
      })
  }, [])

  useEffect(recheck, [recheck])

  const value = useMemo<SessionValue>(
    () => ({ status, message, recheck, signedOut: () => setStatus('signed-out') }),
    [status, message, recheck],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

import { useEffect, useMemo, useState } from 'react'
import { ensureOrganization } from '../lib/organizations'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

function applySession(nextSession, setSession, setOrganizationId) {
  setSession(nextSession)

  const metaOrgId = nextSession?.user?.user_metadata?.organization_id ?? null
  if (metaOrgId) {
    setOrganizationId(metaOrgId)
  }

  if (!nextSession) {
    setOrganizationId(null)
    return
  }

  if (nextSession.user && !nextSession.user.user_metadata?.organization_id) {
    // Defer async work so the auth callback stays synchronous.
    setTimeout(() => {
      ensureOrganization(nextSession.user).then((id) => {
        if (id) setOrganizationId(id)
      })
    }, 0)
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [organizationId, setOrganizationId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return

      if (error) {
        console.error('Failed to get session', error)
        setSession(null)
        setOrganizationId(null)
        setLoading(false)
        return
      }

      applySession(data.session, setSession, setOrganizationId)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return
      // getSession() owns the initial restore so we don't flash a null session.
      if (event === 'INITIAL_SESSION') return
      applySession(nextSession, setSession, setOrganizationId)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      organizationId:
        organizationId ?? session?.user?.user_metadata?.organization_id ?? null,
      loading,
      signOut: () => supabase.auth.signOut(),
    }),
    [session, organizationId, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

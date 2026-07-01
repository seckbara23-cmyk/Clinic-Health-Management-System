'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getQueryClient } from '@/lib/query-client'
import { clearOfflineStore } from '@/lib/offline/idb-storage'
import { nextCacheAction, type TenantStatus } from '@/lib/tenant'
import type { Clinic, UserProfile } from '@/types/database'

const OWNER_KEY = 'chms_cache_owner'
const clinicCacheKey = (uid: string) => `chms_clinic_cache_${uid}`

// Wipe ALL offline caches on logout / user switch (shared-device safety).
function wipeOfflineCaches() {
  try { getQueryClient().clear() } catch { /* ignore */ }
  void clearOfflineStore()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('chms_clinic_cache_') || k === OWNER_KEY)) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

interface ClinicContextValue {
  clinic: Clinic | null
  profile: UserProfile | null
  /** True only during the very first resolution with no data yet. */
  isLoading: boolean
  /** loading | ready | error — separates loading from missing-profile. */
  status: TenantStatus
  refetch: () => void
}

const ClinicContext = createContext<ClinicContextValue>({
  clinic: null,
  profile: null,
  isLoading: true,
  status: 'loading',
  refetch: () => {},
})

export function ClinicProvider({
  children,
  initialProfile = null,
  initialClinic = null,
}: {
  children: React.ReactNode
  initialProfile?: UserProfile | null
  initialClinic?: Clinic | null
}) {
  // Seed from server-fetched tenant so authenticated dashboard users are NEVER
  // rendered a generic/degraded shell on hard refresh — the correct tenant is
  // present on the first client paint; load() only revalidates in the background.
  const [clinic, setClinic] = useState<Clinic | null>(initialClinic)
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile)
  const [status, setStatus] = useState<TenantStatus>(initialProfile ? 'ready' : 'loading')
  const supabase = createClient()
  const hasProfileRef = useRef<boolean>(!!initialProfile)

  async function load() {
    // Note: the initial 'loading' status comes from useState; we don't reset it
    // synchronously here (that would flash a loader on every revalidation and is
    // disallowed inside the mount effect). All setState below happens post-await.

    // getUser() needs the network; offline, fall back to the stored session so
    // we can still hydrate the shell from cache.
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
    let uid = user?.id ?? null
    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession()
      uid = session?.user?.id ?? null
    }

    const owner = typeof window !== 'undefined' ? localStorage.getItem(OWNER_KEY) : null
    const action = nextCacheAction(owner, uid)
    if (action !== 'keep') wipeOfflineCaches()

    if (!uid) {
      // No client session. Keep seeded tenant if we have it (transient token
      // blip); otherwise this is a genuine failure — surface it, never generic.
      if (!hasProfileRef.current) setStatus('error')
      return
    }
    if (typeof window !== 'undefined') localStorage.setItem(OWNER_KEY, uid)

    const { data: prof, error } = await supabase
      .from('user_profiles')
      .select('*, clinic:clinics(*)')
      .eq('id', uid)
      .single()

    if (!error && prof) {
      const { clinic: clinicData, ...profileData } = prof as unknown as UserProfile & { clinic: Clinic | null }
      setProfile(profileData as UserProfile)
      setClinic(clinicData ?? null)
      setStatus('ready')
      hasProfileRef.current = true
      try {
        localStorage.setItem(clinicCacheKey(uid), JSON.stringify({ profile: profileData, clinic: clinicData ?? null }))
      } catch { /* ignore quota */ }
      return
    }

    console.error('[ClinicContext] user_profiles query failed:', {
      code: error?.code, message: error?.message, details: error?.details, hint: error?.hint,
    })

    // We already have valid tenant data (seeded or from a prior load): this was
    // a revalidation blip. Keep it — do NOT downgrade to a generic/null shell.
    if (hasProfileRef.current) {
      setStatus('ready')
      return
    }

    // No data yet: try the offline cache, then a profile-only query, else error.
    try {
      const cached = typeof window !== 'undefined' ? localStorage.getItem(clinicCacheKey(uid)) : null
      if (cached) {
        const { profile: cp, clinic: cc } = JSON.parse(cached) as { profile: UserProfile; clinic: Clinic | null }
        setProfile(cp); setClinic(cc ?? null); setStatus('ready'); hasProfileRef.current = true
        return
      }
    } catch { /* fall through */ }

    const { data: profileOnly, error: fbErr } = await supabase
      .from('user_profiles').select('*').eq('id', uid).single()
    if (!fbErr && profileOnly) {
      setProfile(profileOnly as UserProfile); setStatus('ready'); hasProfileRef.current = true
      return
    }

    setStatus('error')
  }

  /* eslint-disable react-hooks/set-state-in-effect --
     load()'s state updates happen post-await, and the onAuthStateChange handler
     is an external-subscription callback (the pattern the rule explicitly
     allows) — it fires on auth events, not synchronously during the effect. */
  useEffect(() => {
    void load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        wipeOfflineCaches()
        setProfile(null); setClinic(null); hasProfileRef.current = false; setStatus('loading')
        return
      }
      // Re-resolve only on meaningful identity changes. TOKEN_REFRESHED and
      // INITIAL_SESSION fire frequently (focus/interval) for the SAME user and
      // must not churn the tenant state or flash a loader.
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') void load()
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <ClinicContext.Provider value={{ clinic, profile, isLoading: status === 'loading', status, refetch: load }}>
      {children}
    </ClinicContext.Provider>
  )
}

export const useClinic = () => useContext(ClinicContext)

'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getQueryClient } from '@/lib/query-client'
import { clearOfflineStore } from '@/lib/offline/idb-storage'
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
  isLoading: boolean
  refetch: () => void
}

const ClinicContext = createContext<ClinicContextValue>({
  clinic: null,
  profile: null,
  isLoading: true,
  refetch: () => {},
})

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  async function load() {
    setIsLoading(true)

    // getUser() needs the network; offline, fall back to the stored session so
    // we can still hydrate the shell from cache.
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
    let uid = user?.id ?? null
    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession()
      uid = session?.user?.id ?? null
    }

    const owner = typeof window !== 'undefined' ? localStorage.getItem(OWNER_KEY) : null
    if (!uid) {
      // No session at all → treat as logged out; clear any prior user's cache.
      if (owner) wipeOfflineCaches()
      setIsLoading(false)
      return
    }
    // Different user on this device → wipe the previous user's cache first.
    if (owner && owner !== uid) wipeOfflineCaches()
    if (typeof window !== 'undefined') localStorage.setItem(OWNER_KEY, uid)

    const { data: prof, error: profileError } = await supabase
      .from('user_profiles')
      .select('*, clinic:clinics(*)')
      .eq('id', uid)
      .single()

    // Offline / network failure → hydrate clinic + profile from the local cache.
    if (profileError) {
      try {
        const cached = typeof window !== 'undefined' ? localStorage.getItem(clinicCacheKey(uid)) : null
        if (cached) {
          const { profile: cp, clinic: cc } = JSON.parse(cached) as { profile: UserProfile; clinic: Clinic | null }
          setProfile(cp); setClinic(cc ?? null)
          setIsLoading(false)
          return
        }
      } catch { /* fall through to existing error handling */ }
    }

    if (profileError) {
      // Log the full PostgREST error so it's visible in browser console / Vercel logs
      console.error('[ClinicContext] user_profiles query failed:', {
        code:    profileError.code,
        message: profileError.message,
        details: profileError.details,
        hint:    profileError.hint,
      })
      // Fallback: try fetching profile without the clinic join
      const { data: profileOnly, error: fallbackError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', uid)
        .single()

      if (fallbackError) {
        console.error('[ClinicContext] fallback profile query also failed:', {
          code:    fallbackError.code,
          message: fallbackError.message,
          details: fallbackError.details,
          hint:    fallbackError.hint,
        })
      } else if (profileOnly) {
        setProfile(profileOnly as UserProfile)
      }
      setIsLoading(false)
      return
    }

    if (prof) {
      const { clinic: clinicData, ...profileData } = prof as unknown as UserProfile & { clinic: Clinic | null }
      setProfile(profileData as UserProfile)
      setClinic(clinicData ?? null)
      // Cache the shell (clinic settings + profile) for offline hydration.
      try {
        localStorage.setItem(clinicCacheKey(uid), JSON.stringify({ profile: profileData, clinic: clinicData ?? null }))
      } catch { /* ignore quota */ }
    }
    setIsLoading(false)
  }

  useEffect(() => {
    load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load())
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ClinicContext.Provider value={{ clinic, profile, isLoading, refetch: load }}>
      {children}
    </ClinicContext.Provider>
  )
}

export const useClinic = () => useContext(ClinicContext)

'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Clinic, UserProfile } from '@/types/database'

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

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.error('[ClinicContext] auth.getUser failed:', {
        message: authError.message,
        status: authError.status,
      })
      setIsLoading(false)
      return
    }
    if (!user) { setIsLoading(false); return }

    const { data: prof, error: profileError } = await supabase
      .from('user_profiles')
      .select('*, clinic:clinics(*)')
      .eq('id', user.id)
      .single()

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
        .eq('id', user.id)
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

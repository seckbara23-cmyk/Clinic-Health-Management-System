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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setIsLoading(false); return }

    const { data: prof } = await supabase
      .from('user_profiles')
      .select('*, clinic:clinics(*)')
      .eq('id', user.id)
      .single()

    if (prof) {
      const { clinic: clinicData, ...profileData } = prof as unknown as UserProfile & { clinic: Clinic }
      setProfile(profileData as UserProfile)
      setClinic(clinicData ?? null)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

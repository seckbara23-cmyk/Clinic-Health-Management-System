import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { UserProfile } from '@/types/database'

export function useDoctors() {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['doctors', clinic?.id],
    enabled: !!clinic?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, role, email, phone, is_active, clinic_id, avatar_url, created_at, updated_at')
        .eq('clinic_id', clinic!.id)
        .eq('role', 'doctor')
        .eq('is_active', true)
        .order('full_name')
      if (error) throw error
      return data as UserProfile[]
    },
  })
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { Consultation } from '@/types/database'
import { toast } from 'sonner'

export function useConsultations(patientId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['consultations', clinic?.id, patientId ?? 'all'],
    enabled: !!clinic?.id,
    queryFn: async () => {
      let q = supabase
        .from('consultations')
        .select('*, patient:patients(id, full_name, patient_number), doctor:user_profiles!consultations_doctor_id_fkey(id, full_name)')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (patientId) q = q.eq('patient_id', patientId)

      const { data, error } = await q
      if (error) throw error
      return data as unknown as Consultation[]
    },
  })
}

export interface VitalSignsInput {
  blood_pressure?: string | null
  heart_rate?: number | null
  temperature?: number | null
  weight?: number | null
  height?: number | null
  oxygen_saturation?: number | null
}

interface ConsultationUpdate {
  id: string
  chief_complaint?: string | null
  symptoms?: string | null
  diagnosis?: string | null
  treatment_plan?: string | null
  notes?: string | null
  follow_up_date?: string | null
  ended_at?: string | null
  vital_signs?: VitalSignsInput
}

export function useUpdateConsultation() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, vital_signs, ...input }: ConsultationUpdate) => {
      const payload: Record<string, unknown> = { ...input }
      if (vital_signs !== undefined) payload.vital_signs = vital_signs
      const { data, error } = await supabase
        .from('consultations')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(payload as any)
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      toast.success('Consultation mise à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

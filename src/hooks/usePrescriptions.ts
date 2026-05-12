import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { Prescription, Medication, PrescriptionStatus } from '@/types/database'

type PrescriptionWithRelations = Prescription & {
  patient: { id: string; full_name: string; patient_number: string }
  doctor: { id: string; full_name: string }
}

export function usePrescriptions(consultationId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['prescriptions', clinic?.id, consultationId ?? 'all'],
    enabled: !!clinic,
    queryFn: async () => {
      let q = supabase
        .from('prescriptions')
        .select('*, patient:patients(id, full_name, patient_number), doctor:user_profiles(id, full_name)')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
      if (consultationId) q = q.eq('consultation_id', consultationId)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as PrescriptionWithRelations[]
    },
  })
}

interface CreatePrescriptionInput {
  consultation_id: string
  patient_id: string
  medications: Medication[]
  instructions?: string | null
  valid_until?: string | null
}

export function useCreatePrescription() {
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePrescriptionInput) => {
      const { data, error } = await supabase
        .from('prescriptions')
        .insert({
          clinic_id: clinic!.id,
          doctor_id: profile!.id,
          consultation_id: input.consultation_id,
          patient_id: input.patient_id,
          medications: input.medications as unknown as never,
          instructions: input.instructions ?? null,
          valid_until: input.valid_until ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      toast.success('Ordonnance créée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

interface UpdatePrescriptionInput {
  id: string
  status?: PrescriptionStatus
  medications?: Medication[]
  instructions?: string | null
  valid_until?: string | null
}

export function useUpdatePrescription() {
  const { clinic } = useClinic()
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, medications, ...rest }: UpdatePrescriptionInput) => {
      const payload: Record<string, unknown> = { ...rest }
      if (medications !== undefined) payload.medications = medications
      const { data, error } = await supabase
        .from('prescriptions')
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
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      toast.success('Ordonnance mise à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

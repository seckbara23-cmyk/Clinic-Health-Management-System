import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { LabRequest, LabRequestStatus, LabRequestType, AppointmentPriority } from '@/types/database'

type LabRequestWithRelations = LabRequest & {
  patient: { id: string; full_name: string; patient_number: string }
  doctor: { id: string; full_name: string }
}

export function useLabRequests(patientId?: string) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['lab_requests', clinic?.id, patientId ?? 'all'],
    enabled: !!clinic,
    queryFn: async () => {
      let q = supabase
        .from('lab_requests')
        .select('*, patient:patients(id, full_name, patient_number), doctor:user_profiles(id, full_name)')
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
      if (patientId) q = q.eq('patient_id', patientId)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as LabRequestWithRelations[]
    },
  })
}

interface CreateLabRequestInput {
  patient_id: string
  consultation_id?: string | null
  test_name: string
  test_type: LabRequestType
  priority: AppointmentPriority
  clinical_notes?: string | null
}

export function useCreateLabRequest() {
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateLabRequestInput) => {
      const { data, error } = await supabase
        .from('lab_requests')
        .insert({
          clinic_id: clinic!.id,
          doctor_id: profile!.id,
          patient_id: input.patient_id,
          consultation_id: input.consultation_id ?? null,
          test_name: input.test_name,
          test_type: input.test_type,
          priority: input.priority,
          clinical_notes: input.clinical_notes ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_requests'] })
      toast.success('Analyse demandée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

interface UpdateLabRequestInput {
  id: string
  status?: LabRequestStatus
  result_notes?: string | null
  resulted_at?: string | null
}

export function useUpdateLabRequest() {
  const { clinic } = useClinic()
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...rest }: UpdateLabRequestInput) => {
      const { data, error } = await supabase
        .from('lab_requests')
        .update(rest)
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab_requests'] })
      toast.success('Analyse mise à jour')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

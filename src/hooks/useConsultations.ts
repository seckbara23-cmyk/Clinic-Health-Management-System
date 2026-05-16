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

export function useConsultation(id: string | null) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['consultation', id],
    enabled: !!clinic?.id && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultations')
        .select(`
          *,
          patient:patients(id, full_name, patient_number, date_of_birth, gender, blood_type, allergies, phone),
          doctor:user_profiles!consultations_doctor_id_fkey(id, full_name),
          appointment:appointments(id, title, scheduled_at, notes, status)
        `)
        .eq('id', id!)
        .eq('clinic_id', clinic!.id)
        .single()
      if (error) throw error
      return data as unknown as Consultation & {
        appointment?: { id: string; title: string; scheduled_at: string; notes: string | null; status: string } | null
      }
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

interface ConsultationCreate {
  patient_id: string
  appointment_id: string | null
  doctor_id: string
  chief_complaint?: string | null
  symptoms?: string | null
  diagnosis?: string | null
  treatment_plan?: string | null
  notes?: string | null
  follow_up_date?: string | null
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

export function useCreateConsultation() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: ConsultationCreate) => {
      // Guard: if appointment_id given, return existing consultation if one exists
      if (input.appointment_id) {
        const { data: existing } = await supabase
          .from('consultations')
          .select('id')
          .eq('appointment_id', input.appointment_id)
          .eq('clinic_id', clinic!.id)
          .maybeSingle()
        if (existing) return existing as { id: string }
      }

      const { data, error } = await supabase
        .from('consultations')
        .insert({
          patient_id: input.patient_id,
          appointment_id: input.appointment_id,
          doctor_id: input.doctor_id,
          chief_complaint: input.chief_complaint ?? null,
          symptoms: input.symptoms ?? null,
          diagnosis: input.diagnosis ?? null,
          treatment_plan: input.treatment_plan ?? null,
          notes: input.notes ?? null,
          follow_up_date: input.follow_up_date ?? null,
          clinic_id: clinic!.id,
          started_at: new Date().toISOString(),
          vital_signs: {},
        })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations', clinic?.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
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

export function useEndConsultation() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('consultations')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', id)
        .eq('clinic_id', clinic!.id)
        .select('id, appointment_id')
        .single()
      if (error) throw error
      return data as { id: string; appointment_id: string | null }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      // If linked to an appointment, mark it completed
      if (data.appointment_id) {
        const supabase2 = createClient()
        supabase2
          .from('appointments')
          .update({ status: 'completed' })
          .eq('id', data.appointment_id)
          .then(() => qc.invalidateQueries({ queryKey: ['appointments'] }))
      }
      toast.success('Consultation terminée')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

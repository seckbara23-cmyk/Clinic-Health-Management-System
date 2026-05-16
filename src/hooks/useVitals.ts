import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import type { ConsultationVitals } from '@/types/database'
import { toast } from 'sonner'

export function useConsultationVitals(consultationId: string | null) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['vitals', 'consultation', consultationId],
    enabled: !!clinic?.id && !!consultationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultation_vitals' as never)
        .select('*')
        .eq('consultation_id', consultationId!)
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as ConsultationVitals[]
    },
  })
}

export function useLatestPatientVitals(patientId: string | null) {
  const { clinic } = useClinic()
  const supabase = createClient()

  return useQuery({
    queryKey: ['vitals', 'patient', 'latest', patientId],
    enabled: !!clinic?.id && !!patientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultation_vitals' as never)
        .select('*')
        .eq('patient_id', patientId!)
        .eq('clinic_id', clinic!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as unknown as ConsultationVitals | null
    },
  })
}

export interface VitalsInput {
  consultation_id: string
  patient_id: string
  systolic_bp?: number | null
  diastolic_bp?: number | null
  heart_rate?: number | null
  respiratory_rate?: number | null
  spo2?: number | null
  weight_kg?: number | null
  height_cm?: number | null
  temperature_c?: number | null
  blood_glucose?: number | null
  pain_scale?: number | null
  notes?: string | null
}

function calcBmi(weight?: number | null, height?: number | null): number | null {
  if (!weight || !height || height <= 0) return null
  return Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10
}

export function useRecordVitals() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: VitalsInput) => {
      const bmi = calcBmi(input.weight_kg, input.height_cm)
      const { data, error } = await supabase
        .from('consultation_vitals' as never)
        .insert({
          clinic_id:        clinic!.id,
          patient_id:       input.patient_id,
          consultation_id:  input.consultation_id,
          systolic_bp:      input.systolic_bp      ?? null,
          diastolic_bp:     input.diastolic_bp     ?? null,
          heart_rate:       input.heart_rate       ?? null,
          respiratory_rate: input.respiratory_rate ?? null,
          spo2:             input.spo2             ?? null,
          weight_kg:        input.weight_kg        ?? null,
          height_cm:        input.height_cm        ?? null,
          bmi,
          temperature_c:    input.temperature_c    ?? null,
          blood_glucose:    input.blood_glucose    ?? null,
          pain_scale:       input.pain_scale       ?? null,
          notes:            input.notes            ?? null,
          recorded_by:      profile!.id,
        } as never)
        .select()
        .single()
      if (error) throw error
      return data as unknown as ConsultationVitals
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vitals', 'consultation', data.consultation_id] })
      qc.invalidateQueries({ queryKey: ['vitals', 'patient', 'latest', data.patient_id] })
      toast.success('Signes vitaux enregistrés')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

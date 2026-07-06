import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { ConsultationVitals } from '@/types/database'
import type { ReceivedVaccination } from '@/lib/pediatrics/engine'

// ── Pediatrics hooks (Phase 17) ────────────────────────────────────
//
// Tolerant reads for the pediatric Copilot + one clinician-initiated write
// (recording a vaccine dose given — factual data entry, NOT the Copilot acting
// autonomously; RLS gates it to clinical roles in the caller's own clinic).
// A missing migration (044) degrades to [] — nothing breaks. Uses only the
// anon/authenticated client (no privileged key) and no cross-table embed.

export interface PatientVaccinationRow extends ReceivedVaccination {
  id: string
  dose_label: string | null
  administered_by: string | null
  batch_number: string | null
  notes: string | null
}

/** Vaccine doses a patient has received (migration 044). Tolerant → []. */
export function usePatientVaccinations(patientId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['patient_vaccinations', clinic?.id, patientId],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<PatientVaccinationRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('patient_vaccinations')
          .select('id, vaccine_code, dose_label, administered_at, administered_by, batch_number, notes')
          .eq('clinic_id', clinic!.id)
          .eq('patient_id', patientId!)
        if (error) return []
        return (data ?? []) as PatientVaccinationRow[]
      } catch {
        return []
      }
    },
  })
}

/** All recorded vitals for a patient (consultation_vitals) — growth history. Tolerant → []. */
export function usePatientVitalsHistory(patientId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['vitals', 'patient', 'history', patientId],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<ConsultationVitals[]> => {
      try {
        const { data, error } = await supabase
          .from('consultation_vitals' as never)
          .select('*')
          .eq('patient_id', patientId!)
          .eq('clinic_id', clinic!.id)
          .order('created_at', { ascending: false })
        if (error) return []
        return (data ?? []) as unknown as ConsultationVitals[]
      } catch {
        return []
      }
    },
  })
}

export interface RecordVaccinationInput {
  patientId: string
  vaccineCode: string
  doseLabel?: string | null
  administeredAt?: string | null   // ISO date; defaults to today
  batchNumber?: string | null
  notes?: string | null
}

/** Record (or update) that a patient received a vaccine dose. Clinician action,
 *  RLS-gated to clinical roles. Upserts on (patient_id, vaccine_code). */
export function useRecordVaccination() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: RecordVaccinationInput) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('patient_vaccinations').upsert({
        clinic_id: clinic.id,
        patient_id: input.patientId,
        vaccine_code: input.vaccineCode,
        dose_label: input.doseLabel ?? null,
        administered_at: input.administeredAt ?? new Date().toISOString().slice(0, 10),
        administered_by: profile?.id ?? null,
        batch_number: input.batchNumber ?? null,
        notes: input.notes ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'patient_id,vaccine_code' })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['patient_vaccinations', clinic?.id, v.patientId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

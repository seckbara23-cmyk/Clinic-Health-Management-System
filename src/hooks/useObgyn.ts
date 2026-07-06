import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import { estimateDueDate, type PregnancyRecord } from '@/lib/obgyn/engine'

// ── Obstetrics & Gynecology hooks (Phase 18) ───────────────────────
//
// Tolerant read of the latest pregnancy episode + one clinician-initiated write
// (recording LMP / status — factual data entry, RLS-gated to clinical roles;
// NOT the Copilot acting autonomously). A missing migration (045) degrades to
// null. Uses only the anon/authenticated client and no cross-table embed.

export interface PregnancyRow extends PregnancyRecord {
  id: string
  patient_id: string
  created_at: string
}

/** The most recent pregnancy record for a patient (migration 045). Tolerant → null. */
export function usePregnancy(patientId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['pregnancy', clinic?.id, patientId],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<PregnancyRow | null> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('pregnancies')
          .select('id, patient_id, lmp_date, estimated_due_date, pregnancy_status, gravida, para, notes, created_at')
          .eq('clinic_id', clinic!.id)
          .eq('patient_id', patientId!)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) return null
        return (data as PregnancyRow | null) ?? null
      } catch {
        return null
      }
    },
  })
}

export interface SavePregnancyInput {
  id?: string | null
  patientId: string
  consultationId?: string | null
  lmpDate?: string | null
  estimatedDueDate?: string | null
  pregnancyStatus?: string
  gravida?: number | null
  para?: number | null
  notes?: string | null
}

/** Record / update a pregnancy episode (clinician action, RLS-gated). EDD is
 *  auto-derived from LMP (Naegele) when not supplied — a calendar calc, not a
 *  clinical assessment. */
export function useSavePregnancy() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: SavePregnancyInput) => {
      if (!clinic?.id) throw new Error('No active clinic')
      const row: Record<string, unknown> = {
        clinic_id: clinic.id,
        patient_id: input.patientId,
        consultation_id: input.consultationId ?? null,
        lmp_date: input.lmpDate ?? null,
        estimated_due_date: input.estimatedDueDate ?? estimateDueDate(input.lmpDate),
        pregnancy_status: input.pregnancyStatus ?? 'ongoing',
        gravida: input.gravida ?? null,
        para: input.para ?? null,
        notes: input.notes ?? null,
        updated_at: new Date().toISOString(),
      }
      if (input.id) row.id = input.id
      else row.created_by = profile?.id ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('pregnancies').upsert(row)
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['pregnancy', clinic?.id, v.patientId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

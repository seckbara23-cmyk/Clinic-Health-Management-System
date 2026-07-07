import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { NeuroEvent } from '@/lib/neurology/engine'

// ── Neurology hooks (Phase 32) ─────────────────────────────────────
//
// Tolerant read of a patient's neurology events + clinician-initiated write
// (recording a neurology workflow event / investigation order and advancing its
// status — factual data entry, RLS-gated to clinical roles; NOT the Copilot
// acting autonomously). A missing migration (060) degrades to []. Uses only the
// anon/authenticated client and no cross-table embed. Never interprets a result,
// never classifies, never predicts.

export interface NeuroEventRow extends NeuroEvent {
  id: string
  notes: string | null
  created_at: string
}

/** A patient's neurology events (migration 060). Tolerant → []. */
export function useNeurologyEvents(patientId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['neurology_events', clinic?.id, patientId],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<NeuroEventRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('neurology_events')
          .select('id, event_type, status, scheduled_at, notes, created_at')
          .eq('clinic_id', clinic!.id)
          .eq('patient_id', patientId!)
          .order('scheduled_at', { ascending: false })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          id: String(r.id), eventType: String(r.event_type), status: String(r.status),
          scheduledAt: (r.scheduled_at as string | null) ?? null, notes: (r.notes as string | null) ?? null,
          created_at: String(r.created_at),
        }))
      } catch {
        return []
      }
    },
  })
}

export interface RecordNeuroEventInput {
  patientId: string
  consultationId?: string | null
  eventType: string
  status?: string
  scheduledAt?: string | null
  notes?: string | null
}

/** Record a new neurology event (clinician action, RLS-gated). */
export function useRecordNeurologyEvent() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: RecordNeuroEventInput) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('neurology_events').insert({
        clinic_id: clinic.id,
        patient_id: input.patientId,
        consultation_id: input.consultationId ?? null,
        event_type: input.eventType,
        status: input.status ?? 'planned',
        scheduled_at: input.scheduledAt ?? new Date().toISOString().slice(0, 10),
        created_by: profile?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['neurology_events', clinic?.id, v.patientId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Advance a neurology event's status (e.g. awaiting_review → reviewed). RLS-gated. */
export function useUpdateNeurologyEventStatus() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string; patientId: string }) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('neurology_events')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id).eq('clinic_id', clinic.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['neurology_events', clinic?.id, v.patientId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

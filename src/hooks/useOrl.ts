import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { OrlEvent } from '@/lib/orl/engine'

// ── ORL / ENT hooks (Phase 19) ─────────────────────────────────────
//
// Tolerant read of a patient's ORL events + clinician-initiated write (recording
// an event or advancing its status — factual data entry, RLS-gated to clinical
// roles; NOT the Copilot acting autonomously). A missing migration (046)
// degrades to []. Uses only the anon/authenticated client and no cross-table embed.

export interface OrlEventRow extends OrlEvent {
  id: string
  notes: string | null
  created_at: string
}

/** A patient's ORL events (migration 046). Tolerant → []. */
export function useOrlEvents(patientId: string | null | undefined) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['orl_events', clinic?.id, patientId],
    enabled: !!clinic?.id && !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<OrlEventRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('orl_events')
          .select('id, event_type, status, event_date, notes, created_at')
          .eq('clinic_id', clinic!.id)
          .eq('patient_id', patientId!)
          .order('event_date', { ascending: false })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          id: String(r.id), eventType: String(r.event_type), status: String(r.status),
          eventDate: (r.event_date as string | null) ?? null, notes: (r.notes as string | null) ?? null,
          created_at: String(r.created_at),
        }))
      } catch {
        return []
      }
    },
  })
}

export interface RecordOrlEventInput {
  patientId: string
  consultationId?: string | null
  eventType: string
  status?: string
  eventDate?: string | null
  notes?: string | null
}

/** Record a new ORL event (clinician action, RLS-gated). */
export function useRecordOrlEvent() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: RecordOrlEventInput) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('orl_events').insert({
        clinic_id: clinic.id,
        patient_id: input.patientId,
        consultation_id: input.consultationId ?? null,
        event_type: input.eventType,
        status: input.status ?? 'ordered',
        event_date: input.eventDate ?? new Date().toISOString().slice(0, 10),
        created_by: profile?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['orl_events', clinic?.id, v.patientId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Advance an ORL event's status (e.g. awaiting_review → reviewed). RLS-gated. */
export function useUpdateOrlEventStatus() {
  const qc = useQueryClient()
  const { clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string; patientId: string }) => {
      if (!clinic?.id) throw new Error('No active clinic')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('orl_events')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id).eq('clinic_id', clinic.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['orl_events', clinic?.id, v.patientId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

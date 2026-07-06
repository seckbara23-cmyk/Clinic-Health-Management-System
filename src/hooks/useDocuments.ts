import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'

// ── Clinical Documents hooks (Phase 20) ────────────────────────────
//
// Audit-only persistence for document generation/printing/export (metadata,
// never document content). Tolerant: a missing migration (047) or any error is
// swallowed — auditing must never block a clinician from printing. Uses only the
// anon/authenticated client and no cross-table embed. RLS keeps rows
// tenant-isolated and gates writes to clinical roles.

export type DocumentAction = 'generated' | 'printed' | 'exported'

export interface LogDocumentInput {
  documentId: string
  patientId?: string | null
  consultationId?: string | null
  action?: DocumentAction
}

/** Append an audit row for a document action. Best-effort — never throws to the UI. */
export function useLogDocumentGeneration() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: LogDocumentInput) => {
      if (!clinic?.id) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('document_generations').insert({
          clinic_id: clinic.id,
          patient_id: input.patientId ?? null,
          consultation_id: input.consultationId ?? null,
          document_id: input.documentId,
          action: input.action ?? 'printed',
          generated_by: profile?.id ?? null,
        })
      } catch { /* audit is best-effort */ }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document_generations', clinic?.id] }),
  })
}

export interface DocumentLogRow {
  id: string
  documentId: string
  action: string
  patientId: string | null
  createdAt: string
}

/** Recent document-generation audit rows (optional history view). Tolerant → []. */
export function useDocumentHistory(patientId?: string | null, limit = 20) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['document_generations', clinic?.id, patientId ?? 'all', limit],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<DocumentLogRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase as any).from('document_generations')
          .select('id, document_id, action, patient_id, created_at')
          .eq('clinic_id', clinic!.id)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (patientId) q = q.eq('patient_id', patientId)
        const { data, error } = await q
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          id: String(r.id), documentId: String(r.document_id), action: String(r.action),
          patientId: (r.patient_id as string | null) ?? null, createdAt: String(r.created_at),
        }))
      } catch {
        return []
      }
    },
  })
}

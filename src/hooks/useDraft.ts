'use client'

import { useMutation } from '@tanstack/react-query'
import type { DraftType, StructuredDraft } from '@/lib/ai/types'

export interface DraftApiResult {
  draft: StructuredDraft
  meta: { dataCategories: string[]; provider: string }
}

// Calls POST /api/ai/draft. Read-only on the server; returns a draft for the
// clinician to review/edit/save. Role (doctor/admin) is enforced server-side.
export function useDraft() {
  return useMutation<
    DraftApiResult,
    Error,
    { draftType: DraftType; patientId: string; diagnosis?: string; appointmentReason?: string }
  >({
    mutationFn: async (vars) => {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(vars),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Draft error (${res.status})`)
      }
      return (await res.json()) as DraftApiResult
    },
  })
}

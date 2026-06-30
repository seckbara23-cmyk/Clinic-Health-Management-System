'use client'

import { useMutation } from '@tanstack/react-query'
import type { AIContext, StructuredAIResponse } from '@/lib/ai/types'

export interface CopilotApiResult {
  response: StructuredAIResponse
  meta: { toolsUsed: string[]; dataCategories: string[]; provider: string }
}

export type CopilotContextExtras = Partial<
  Pick<
    AIContext,
    | 'page'
    | 'patientId'
    | 'consultationId'
    | 'appointmentId'
    | 'invoiceId'
    | 'prescriptionId'
    | 'labOrderId'
    | 'pharmacyOrderId'
    | 'filters'
    | 'widgets'
  >
>

// Calls POST /api/ai/chat. Role + clinic are resolved server-side from the
// session (never sent by the client); we only pass the message + page/entity
// context. The server enforces AI_ENABLED, RLS and rate limiting.
export function useCopilot() {
  return useMutation<CopilotApiResult, Error, { message?: string; context?: CopilotContextExtras }>({
    mutationFn: async ({ message, context }) => {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, ...(context ?? {}) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Copilot error (${res.status})`)
      }
      return (await res.json()) as CopilotApiResult
    },
  })
}

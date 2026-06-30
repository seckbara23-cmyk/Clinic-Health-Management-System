// Pure mapping from an /api/ai/chat request body + the caller's profile to a
// validated AIContext. Kept separate from the route so it can be unit-tested
// without a Next request. All entity ids are accepted only as strings; anything
// else is dropped (never trust client-supplied context — RLS is still the
// backstop, but we don't forward garbage to tools).

import type { AIContext } from './types'
import type { Role } from '@/types/database'

export interface AIChatBody {
  message?: unknown
  page?: unknown
  patientId?: unknown
  consultationId?: unknown
  appointmentId?: unknown
  invoiceId?: unknown
  prescriptionId?: unknown
  labOrderId?: unknown
  pharmacyOrderId?: unknown
  filters?: unknown
  widgets?: unknown
}

export interface CallerProfile {
  id: string
  role: Role
  clinic_id: string
  locale?: string | null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function buildAIContext(profile: CallerProfile, body: AIChatBody): AIContext {
  return {
    role: profile.role,
    clinicId: profile.clinic_id,
    userId: profile.id,
    locale: profile.locale ?? undefined,
    page: str(body.page),
    patientId: str(body.patientId),
    consultationId: str(body.consultationId),
    appointmentId: str(body.appointmentId),
    invoiceId: str(body.invoiceId),
    prescriptionId: str(body.prescriptionId),
    labOrderId: str(body.labOrderId),
    pharmacyOrderId: str(body.pharmacyOrderId),
    filters:
      body.filters && typeof body.filters === 'object'
        ? (body.filters as Record<string, unknown>)
        : undefined,
    widgets: Array.isArray(body.widgets)
      ? (body.widgets.filter((w) => typeof w === 'string') as string[])
      : undefined,
  }
}

/** Extract the user message, if a non-empty string. */
export function extractMessage(body: AIChatBody): string | undefined {
  return str(body.message)
}

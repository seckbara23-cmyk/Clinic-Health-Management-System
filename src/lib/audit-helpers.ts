import type { NextRequest } from 'next/server'

// Best-effort client IP + user-agent for audit metadata. IP comes from the
// proxy headers Vercel sets; falls back to null when unavailable.
export function requestClientInfo(req: NextRequest): { ip: string | null; ua: string | null } {
  const fwd = req.headers.get('x-forwarded-for')
  const ip = fwd ? fwd.split(',')[0].trim() : (req.headers.get('x-real-ip') ?? null)
  const ua = req.headers.get('user-agent') ?? null
  return { ip, ua }
}

// Entity types that may be view-logged / soft-deleted via the audit API.
export const AUDITABLE_ENTITIES = ['patient', 'appointment', 'consultation', 'prescription', 'invoice'] as const
export type AuditableEntity = (typeof AUDITABLE_ENTITIES)[number]

export function isAuditableEntity(v: unknown): v is AuditableEntity {
  return typeof v === 'string' && (AUDITABLE_ENTITIES as readonly string[]).includes(v)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

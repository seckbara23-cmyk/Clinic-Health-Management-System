// Client-safe AI UI helpers. No server imports — safe to use in client
// components. Pure functions are unit-tested (the React components themselves
// are verified via build + production smoke; jsdom component tests are a
// follow-up since the jest project is node-only).

import type { AIConfidenceLevel, AIWarningLevel } from './types'

/**
 * Client visibility flag. The server route still enforces AI_ENABLED — this only
 * controls whether the Copilot UI renders. Both default off.
 */
export const AI_UI_ENABLED = process.env.NEXT_PUBLIC_AI_ENABLED === 'true'

/** Badge variant for a confidence level (variants from components/ui/badge). */
export function confidenceVariant(level: AIConfidenceLevel): 'success' | 'info' | 'secondary' {
  switch (level) {
    case 'high':
      return 'success'
    case 'medium':
      return 'info'
    default:
      return 'secondary'
  }
}

/** Badge variant for a warning level. */
export function warningVariant(level: AIWarningLevel): 'destructive' | 'warning' | 'info' {
  switch (level) {
    case 'critical':
      return 'destructive'
    case 'warning':
      return 'warning'
    default:
      return 'info'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Derive entity context from the current route so the user never re-explains
 * what they're looking at (revision #2). Conservative: only recognizes the
 * detail routes that carry a UUID segment.
 */
export function parsePageContext(pathname: string): {
  page: string
  patientId?: string
  consultationId?: string
} {
  const out: { page: string; patientId?: string; consultationId?: string } = { page: pathname }
  const seg = pathname.split('/').filter(Boolean)
  for (let i = 0; i < seg.length - 1; i++) {
    const id = seg[i + 1]
    if (!UUID_RE.test(id)) continue
    if (seg[i] === 'patients') out.patientId = id
    if (seg[i] === 'consultations') out.consultationId = id
  }
  return out
}

// ── Credential reminder engine (Phase 21) ──────────────────────────
//
// Pure, deterministic given `now`. Computes expiry reminder tiers
// (90 / 60 / 30 days / expired) for employee credentials. It NEVER verifies a
// credential and NEVER changes verification status — reminders are operational
// nudges only. Verification is a human-only action performed elsewhere.

import type { Credential, ReminderTier, VerificationStatus } from './types'

const DAY = 86_400_000

function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function parseDate(v?: string | null): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from `now` until `expiry` (negative once past). null if no date. */
export function daysUntil(expiryDate: string | null | undefined, now: Date): number | null {
  const at = parseDate(expiryDate)
  if (!at) return null
  return Math.round((startOfDayUTC(at) - startOfDayUTC(now)) / DAY)
}

/**
 * Reminder tier for an expiry date, or null when there's nothing to nudge:
 *   expired  → already past
 *   due_30   → 0..30 days out
 *   due_60   → 31..60 days out
 *   due_90   → 61..90 days out
 *   null     → no date, or more than 90 days out
 */
export function reminderTier(expiryDate: string | null | undefined, now: Date): ReminderTier {
  const days = daysUntil(expiryDate, now)
  if (days === null) return null
  if (days < 0) return 'expired'
  if (days <= 30) return 'due_30'
  if (days <= 60) return 'due_60'
  if (days <= 90) return 'due_90'
  return null
}

export function isExpired(expiryDate: string | null | undefined, now: Date): boolean {
  return reminderTier(expiryDate, now) === 'expired'
}

/** Does this tier warrant surfacing on the dashboard / insights? */
export function isActionableTier(tier: ReminderTier): boolean {
  return tier !== null
}

export interface CredentialReminder {
  credential: Credential
  tier: Exclude<ReminderTier, null>
  days: number
}

/**
 * All credentials that are expired or expiring within 90 days, most-urgent
 * first (most overdue / soonest). Deterministic given `now`.
 */
export function credentialReminders(
  credentials: Credential[] | null | undefined,
  now: Date,
): CredentialReminder[] {
  if (!Array.isArray(credentials)) return []
  const out: CredentialReminder[] = []
  for (const c of credentials) {
    const tier = reminderTier(c.expiryDate, now)
    if (tier === null) continue
    const days = daysUntil(c.expiryDate, now)!
    out.push({ credential: c, tier, days })
  }
  return out.sort((a, b) => a.days - b.days)
}

// The credential kinds every clinical professional is expected to hold. Used to
// flag "missing credentials" — an operational completeness nudge, not a block.
export const EXPECTED_CLINICAL_CREDENTIALS: string[] = ['license']

/**
 * Is a required credential kind missing for this member? Purely structural:
 * "no credential row of an expected type exists". Never evaluates quality.
 */
export function missingCredentialTypes(
  credentials: Credential[] | null | undefined,
  expected: string[] = EXPECTED_CLINICAL_CREDENTIALS,
): string[] {
  const present = new Set((credentials ?? []).map(c => c.credentialType))
  return expected.filter(t => !present.has(t as never))
}

/** A verification status is only ever human-authored — this never derives it. */
export function isHumanVerified(status: VerificationStatus): boolean {
  return status === 'verified'
}

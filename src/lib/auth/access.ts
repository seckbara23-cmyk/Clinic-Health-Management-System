// ── Access-state classification (pure) ────────────────────────────
//
// Decides where an authenticated request goes based on the profile lookup
// result. Pure + deterministic so every state is unit-testable and — critically
// — DISTINCT. Before this, a failed profile query collapsed into
// "reason=inactive" (P0 lockout after migration 037 made the clinic embed
// ambiguous). Now a query/DB/RLS error, a missing profile, and a genuinely
// deactivated account are three separate outcomes.
//
// The ONLY path that may ever emit reason=inactive is an explicit
// `profile.is_active === false` on a SUCCESSFULLY fetched row.

export type AccessProfile = {
  is_active: boolean
  must_change_password: boolean
  clinic_id: string | null
  role: string
}

export interface ClassifyAccessInput {
  hasUser: boolean
  /** True when the profile query returned an error (DB / RLS / PostgREST). */
  hadQueryError: boolean
  /** The profile row, or null when no row came back (and no error). */
  profile: AccessProfile | null
  /** clinic.status of the joined clinic, or null when there is no clinic. */
  clinicStatus: string | null
}

export type AccessDecision = { allow: true } | { allow: false; redirect: string }

// Clinic lifecycle states that block access (super_admin is exempt — no clinic).
export const CLINIC_BLOCKED_STATUSES = ['suspended', 'inactive', 'archived', 'pending'] as const

export function classifyProfileAccess(input: ClassifyAccessInput): AccessDecision {
  if (!input.hasUser) return { allow: false, redirect: '/login' }

  // A failed lookup is an infrastructure problem, NEVER an inactive user.
  if (input.hadQueryError) return { allow: false, redirect: '/suspended?reason=error' }

  // Authenticated but no profile row (not provisioned / RLS filtered to empty).
  if (!input.profile) return { allow: false, redirect: '/suspended?reason=unknown' }

  // The single legitimate "inactive" path: an explicitly deactivated account.
  if (input.profile.is_active === false) return { allow: false, redirect: '/suspended?reason=inactive' }

  if (input.profile.must_change_password) return { allow: false, redirect: '/change-password' }

  // Clinic-level lifecycle guard (super_admin has no clinic and is exempt).
  if (input.profile.clinic_id && input.profile.role !== 'super_admin') {
    const status = input.clinicStatus ?? 'active'
    if ((CLINIC_BLOCKED_STATUSES as readonly string[]).includes(status)) {
      return { allow: false, redirect: `/suspended?reason=${status}` }
    }
  }

  return { allow: true }
}

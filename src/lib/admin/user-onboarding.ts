import { randomBytes } from 'crypto'

// ── Admin staff onboarding — pure, server-safe logic ────────────────
//
// Shared by the /api/admin/create-user route handler. Kept pure (crypto only,
// no Supabase client, no privileged key) so it is unit-testable and can never
// leak a privileged client into the browser bundle. The route is the ONLY
// caller — the browser must never generate a password or create an auth user.

// Roles an admin / super_admin may onboard. Never 'super_admin' — a super admin
// account is provisioned out-of-band, not via this flow.
export const ONBOARDABLE_ROLES = [
  'admin', 'doctor', 'receptionist', 'nurse', 'cashier', 'lab_technician', 'pharmacist',
] as const
export type OnboardableRole = (typeof ONBOARDABLE_ROLES)[number]

export function isOnboardableRole(v: unknown): v is OnboardableRole {
  return typeof v === 'string' && (ONBOARDABLE_ROLES as readonly string[]).includes(v)
}

export interface OnboardingCaller {
  role: string | null
  clinicId: string | null
}

/**
 * May this caller create a user in `targetClinicId`?
 *  - super_admin: any clinic (must be a real clinic id)
 *  - admin:       only their own clinic
 *  - anyone else: never
 */
export function canCreateUser(caller: OnboardingCaller, targetClinicId: string | null): boolean {
  if (!targetClinicId) return false
  if (caller.role === 'super_admin') return true
  if (caller.role === 'admin') return !!caller.clinicId && caller.clinicId === targetClinicId
  return false
}

/**
 * The clinic the new user is actually created in — server-authoritative.
 * Admins are PINNED to their own clinic (the client value is ignored, so an
 * admin can never onboard into another tenant). super_admin uses the requested
 * clinic. Returns null when it cannot be resolved (→ caller is then rejected).
 */
export function resolveTargetClinicId(
  caller: OnboardingCaller,
  requestedClinicId: string | null,
): string | null {
  if (caller.role === 'super_admin') return requestedClinicId?.trim() || null
  if (caller.role === 'admin') return caller.clinicId
  return null
}

/**
 * Password strength policy — mirrors the server-side check in
 * /api/auth/change-password so a generated temporary password would also pass
 * the user's own subsequent change. ≥8 chars, lower + upper + digit + special.
 */
export function passwordMeetsPolicy(pw: string): boolean {
  return (
    pw.length >= 8 &&
    /[a-z]/.test(pw) &&
    /[A-Z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  )
}

// Unambiguous alphabets (no 0/O/1/l/I) so the password is safe to read aloud or
// copy by hand. Special chars are shell/CSV-neutral (no quotes, backslash, space).
const LOWER   = 'abcdefghjkmnpqrstuvwxyz'
const UPPER   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGIT   = '23456789'
const SPECIAL = '@#%+=?'
const ALL     = LOWER + UPPER + DIGIT + SPECIAL

function pick(set: string): string {
  return set[randomBytes(1)[0] % set.length]
}

/**
 * Generate a strong temporary password (crypto-random). Guarantees at least one
 * lowercase, uppercase, digit and special character, so it always satisfies
 * passwordMeetsPolicy(). Default length 16. The result is returned to the caller
 * once and is NEVER stored or logged.
 */
export function generateTempPassword(length = 16): string {
  const size = Math.max(length, 8)
  // Guarantee one from each required category…
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SPECIAL)]
  // …then fill the remainder from the full alphabet.
  const rest = Array.from(randomBytes(Math.max(size - required.length, 0)), b => ALL[b % ALL.length])
  const chars = [...required, ...rest]
  // Fisher–Yates shuffle with crypto bytes so the required chars aren't front-loaded.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

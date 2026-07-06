import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ONBOARDABLE_ROLES, isOnboardableRole,
  canCreateUser, resolveTargetClinicId,
  passwordMeetsPolicy, generateTempPassword,
} from '../admin/user-onboarding'
import type { OnboardingCaller } from '../admin/user-onboarding'

// ── Admin staff onboarding — temporary-password flow (Phase: onboarding) ──
//
// jest runs in node with no live DB, so the route handler is proven two ways:
//  (A) the pure authorisation / password logic it delegates to is unit-tested
//      directly; and
//  (B) a source guard on the route + client page proves the security invariants
//      the requirements demand (server-only creation, no client Admin API, no
//      client-side password generation, no password logged/audited/stored, and
//      the existing email-invitation flow is untouched).

const adminA:     OnboardingCaller = { role: 'admin', clinicId: 'clinic-A' }
const adminB:     OnboardingCaller = { role: 'admin', clinicId: 'clinic-B' }
const superAdmin: OnboardingCaller = { role: 'super_admin', clinicId: null }
const doctor:     OnboardingCaller = { role: 'doctor', clinicId: 'clinic-A' }
const noRole:     OnboardingCaller = { role: null, clinicId: null }

// ── (A) Authorisation ───────────────────────────────────────────────
describe('canCreateUser — who may onboard where', () => {
  it('an admin CAN create a user in their OWN clinic', () => {
    expect(canCreateUser(adminA, 'clinic-A')).toBe(true)
  })
  it('an admin CANNOT create a user in ANOTHER clinic (tenant isolation)', () => {
    expect(canCreateUser(adminA, 'clinic-B')).toBe(false)
    expect(canCreateUser(adminB, 'clinic-A')).toBe(false) // symmetric — B cannot reach A
  })
  it('a super_admin CAN create a user for any selected clinic', () => {
    expect(canCreateUser(superAdmin, 'clinic-A')).toBe(true)
    expect(canCreateUser(superAdmin, 'clinic-Z')).toBe(true)
  })
  it('a super_admin still needs a concrete clinic (no null-clinic user)', () => {
    expect(canCreateUser(superAdmin, null)).toBe(false)
  })
  it('non-admin roles can never create users', () => {
    expect(canCreateUser(doctor, 'clinic-A')).toBe(false)
    expect(canCreateUser(noRole, 'clinic-A')).toBe(false)
  })
  it('an admin with no clinic assignment cannot create users', () => {
    expect(canCreateUser({ role: 'admin', clinicId: null }, 'clinic-A')).toBe(false)
  })
})

describe('resolveTargetClinicId — server-authoritative clinic pinning', () => {
  it('pins an admin to their OWN clinic, ignoring any client-supplied clinic', () => {
    // Even if a crafted request asks for clinic-B, an admin is pinned to clinic-A.
    expect(resolveTargetClinicId(adminA, 'clinic-B')).toBe('clinic-A')
    expect(canCreateUser(adminA, resolveTargetClinicId(adminA, 'clinic-B'))).toBe(true)
    // …and that resolved clinic is still their own, never the requested other one.
    expect(resolveTargetClinicId(adminA, 'clinic-B')).not.toBe('clinic-B')
  })
  it('lets a super_admin target the requested clinic', () => {
    expect(resolveTargetClinicId(superAdmin, 'clinic-Z')).toBe('clinic-Z')
    expect(resolveTargetClinicId(superAdmin, '  clinic-Z  ')).toBe('clinic-Z')
    expect(resolveTargetClinicId(superAdmin, '')).toBeNull()
    expect(resolveTargetClinicId(superAdmin, null)).toBeNull()
  })
  it('resolves to null for non-admin callers', () => {
    expect(resolveTargetClinicId(doctor, 'clinic-A')).toBeNull()
  })
})

describe('onboardable roles', () => {
  it('never includes super_admin', () => {
    expect(ONBOARDABLE_ROLES).not.toContain('super_admin')
  })
  it('accepts staff roles and rejects anything else', () => {
    expect(isOnboardableRole('doctor')).toBe(true)
    expect(isOnboardableRole('admin')).toBe(true)
    expect(isOnboardableRole('super_admin')).toBe(false)
    expect(isOnboardableRole('root')).toBe(false)
    expect(isOnboardableRole(null)).toBe(false)
  })
})

// ── (A) Temporary password strength ─────────────────────────────────
describe('generateTempPassword — strong, server-side', () => {
  it('always satisfies the password policy (lower+upper+digit+special, ≥8)', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword()
      expect(passwordMeetsPolicy(pw)).toBe(true)
      expect(pw.length).toBe(16)
    }
  })
  it('honours a custom length but never drops below the 8-char floor', () => {
    expect(generateTempPassword(24)).toHaveLength(24)
    expect(generateTempPassword(4).length).toBeGreaterThanOrEqual(8)
    expect(passwordMeetsPolicy(generateTempPassword(4))).toBe(true)
  })
  it('is high-entropy — repeated calls do not collide', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()))
    expect(seen.size).toBe(500)
  })
  it('uses only the unambiguous alphabet (no 0/O/1/l/I, no quotes/space)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).toMatch(/^[A-HJ-NP-Za-hj-km-z2-9@#%+=?]+$/)
    }
  })
})

describe('passwordMeetsPolicy', () => {
  it('rejects weak passwords', () => {
    expect(passwordMeetsPolicy('short1!')).toBe(false)      // < 8
    expect(passwordMeetsPolicy('alllowercase1!')).toBe(false) // no upper
    expect(passwordMeetsPolicy('ALLUPPERCASE1!')).toBe(false) // no lower
    expect(passwordMeetsPolicy('NoDigitsHere!')).toBe(false)  // no digit
    expect(passwordMeetsPolicy('NoSpecial123')).toBe(false)   // no special
  })
  it('accepts a strong password', () => {
    expect(passwordMeetsPolicy('Str0ng@Pass')).toBe(true)
  })
})

// ── (B) Route source guard — security invariants ────────────────────
const ROUTE = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'admin', 'create-user', 'route.ts'), 'utf8',
)

describe('create-user route — server-only, privileged, audited', () => {
  it('creates the auth user via the service-role Admin API (never the browser)', () => {
    expect(ROUTE).toMatch(/createServiceClient\(\)/)
    expect(ROUTE).toMatch(/service\.auth\.admin\.createUser/)
  })

  it('restricts creation to admin / super_admin and delegates authZ to the pure guards', () => {
    expect(ROUTE).toMatch(/caller\?\.role !== 'admin' && caller\?\.role !== 'super_admin'/)
    expect(ROUTE).toMatch(/canCreateUser\(/)
    expect(ROUTE).toMatch(/resolveTargetClinicId\(/)
    expect(ROUTE).toMatch(/isOnboardableRole\(/)
  })

  it('forces must_change_password + is_active on the created user', () => {
    // app_metadata flag (read by middleware) AND the profile mirror.
    expect(ROUTE).toMatch(/app_metadata:\s*\{\s*must_change_password:\s*true/)
    expect(ROUTE).toMatch(/must_change_password:\s*true/)
    expect(ROUTE).toMatch(/is_active:\s*true/)
  })

  it('writes an audit event with actor / clinic / role / target email — and NO password', () => {
    expect(ROUTE).toMatch(/action:\s*'user\.create_with_temp_password'/)
    const auditStart = ROUTE.indexOf('logAuditEvent(')
    const audit = ROUTE.slice(auditStart, ROUTE.indexOf('})', auditStart))
    expect(auditStart).toBeGreaterThan(-1)
    expect(audit).toMatch(/actor_email/)
    expect(audit).toMatch(/target_email/)
    expect(audit).toMatch(/target_role/)
    expect(audit).toMatch(/clinic_id/)
    // Hard invariant: the plaintext password never reaches the audit call, and
    // the metadata payload carries no password field of any kind. (The action
    // NAME "user.create_with_temp_password" describes the event, not a secret.)
    expect(audit).not.toMatch(/tempPassword/)          // the plaintext var (camelCase)
    const meta = audit.slice(audit.indexOf('metadata'))
    expect(meta).not.toMatch(/password/i)              // metadata carries no password field
  })

  it('never logs the plaintext password and never persists it', () => {
    // No console.* statement references the password.
    expect(ROUTE).not.toMatch(/console\.\w+\([^)]*password/i)
    // The plaintext variable only appears in generation, the Admin API call, and
    // the one-time response — never near a log, the audit, or a DB write.
    for (const line of ROUTE.split('\n')) {
      if (/tempPassword|temp_password/.test(line)) {
        expect(line).not.toMatch(/logAuditEvent|metadata|console\.|\.upsert\(|\.insert\(|\.update\(/)
      }
    }
    // The profile upsert stores the must_change_password FLAG but never the
    // plaintext password itself.
    const upsertStart = ROUTE.indexOf('.upsert(')
    const upsert = ROUTE.slice(upsertStart, ROUTE.indexOf('} as never', upsertStart))
    expect(upsert).not.toMatch(/tempPassword|temp_password/)
    expect(upsert).toMatch(/must_change_password:\s*true/) // flag, not the secret
  })

  it('returns the temporary password exactly once (in the JSON response)', () => {
    expect(ROUTE).toMatch(/temp_password:\s*tempPassword/)
    // Exactly one response assignment of the plaintext to the client.
    expect((ROUTE.match(/temp_password:\s*tempPassword/g) ?? []).length).toBe(1)
  })

  it('rolls back the orphaned auth user if the profile write fails', () => {
    expect(ROUTE).toMatch(/deleteUser\(newUserId\)/)
  })
})

// ── (B) Client page guard — browser never privileged, invite intact ──
const PAGE = readFileSync(
  join(__dirname, '..', '..', 'app', '(dashboard)', 'admin', 'users', 'page.tsx'), 'utf8',
)

describe('admin/users page — client stays unprivileged', () => {
  it('never touches the service role, the Admin API, or generates a password', () => {
    expect(PAGE).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE|service_role/)
    expect(PAGE).not.toMatch(/auth\.admin\./)
    expect(PAGE).not.toMatch(/generateTempPassword/)
  })
  it('drives temp-password onboarding through the server route only', () => {
    expect(PAGE).toMatch(/\/api\/admin\/create-user/)
  })
  it('does not persist the revealed password in web storage (shown once)', () => {
    expect(PAGE).not.toMatch(/localStorage|sessionStorage/)
  })
  it('preserves the existing email-invitation flow', () => {
    expect(PAGE).toMatch(/clinic_invitations/)
    expect(PAGE).toMatch(/toastInviteSent/)
  })
})

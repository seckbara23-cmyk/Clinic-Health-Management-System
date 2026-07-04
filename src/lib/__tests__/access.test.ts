import { classifyProfileAccess, type AccessProfile } from '../auth/access'
import { resolveWorkspace, allModulesConfig } from '../workspace/resolve'

const activeProfile: AccessProfile = { is_active: true, must_change_password: false, clinic_id: 'c1', role: 'doctor' }

const base = { hasUser: true, hadQueryError: false, profile: activeProfile, clinicStatus: 'active' as string | null }

describe('classifyProfileAccess — states never collapse', () => {
  it('ALLOWS an authenticated, active user with an active clinic', () => {
    expect(classifyProfileAccess(base)).toEqual({ allow: true })
  })

  it('unauthenticated → /login (not /suspended)', () => {
    expect(classifyProfileAccess({ ...base, hasUser: false })).toEqual({ allow: false, redirect: '/login' })
  })

  // ★ The P0 regression: a failed profile query must be its OWN state, never inactive.
  it('profile query error (PGRST201 / DB / RLS) → reason=error, NEVER inactive', () => {
    const d = classifyProfileAccess({ hasUser: true, hadQueryError: true, profile: null, clinicStatus: null })
    expect(d).toEqual({ allow: false, redirect: '/suspended?reason=error' })
    expect(d).not.toEqual({ allow: false, redirect: '/suspended?reason=inactive' })
  })

  it('query error takes precedence even over a stale profile object', () => {
    expect(classifyProfileAccess({ ...base, hadQueryError: true }))
      .toEqual({ allow: false, redirect: '/suspended?reason=error' })
  })

  it('authenticated but missing profile row → reason=unknown (not inactive)', () => {
    expect(classifyProfileAccess({ hasUser: true, hadQueryError: false, profile: null, clinicStatus: null }))
      .toEqual({ allow: false, redirect: '/suspended?reason=unknown' })
  })

  it('the ONLY inactive path is an explicit is_active === false', () => {
    expect(classifyProfileAccess({ ...base, profile: { ...activeProfile, is_active: false } }))
      .toEqual({ allow: false, redirect: '/suspended?reason=inactive' })
  })

  it('must_change_password → /change-password', () => {
    expect(classifyProfileAccess({ ...base, profile: { ...activeProfile, must_change_password: true } }))
      .toEqual({ allow: false, redirect: '/change-password' })
  })

  it('clinic suspended → reason=suspended (distinct from inactive)', () => {
    expect(classifyProfileAccess({ ...base, clinicStatus: 'suspended' }))
      .toEqual({ allow: false, redirect: '/suspended?reason=suspended' })
  })
  it('clinic pending/archived pass through their own reason', () => {
    expect(classifyProfileAccess({ ...base, clinicStatus: 'pending' }).redirect).toBe('/suspended?reason=pending')
    expect(classifyProfileAccess({ ...base, clinicStatus: 'archived' }).redirect).toBe('/suspended?reason=archived')
  })

  it('clinic missing (null status) defaults to active → ALLOW, never inactive', () => {
    expect(classifyProfileAccess({ ...base, clinicStatus: null })).toEqual({ allow: true })
  })

  it('super_admin privacy: no clinic_id, exempt from clinic lifecycle gate', () => {
    const sa: AccessProfile = { is_active: true, must_change_password: false, clinic_id: null, role: 'super_admin' }
    expect(classifyProfileAccess({ hasUser: true, hadQueryError: false, profile: sa, clinicStatus: null })).toEqual({ allow: true })
    // even if a clinic status is present, super_admin is not blocked
    expect(classifyProfileAccess({ hasUser: true, hadQueryError: false, profile: { ...sa, clinic_id: 'c1' }, clinicStatus: 'suspended' })).toEqual({ allow: true })
  })
})

// Login gating must NOT depend on Phase-14 workspace/preferences/settings.
describe('login gating is independent of workspace / preferences (Phase 14)', () => {
  it('classifier signature consults only auth + profile + clinic status', () => {
    // An active user is allowed with no preferences, no workspace, no settings —
    // those are never inputs to the access decision.
    expect(classifyProfileAccess(base)).toEqual({ allow: true })
  })
  it('missing user_preferences never blocks: resolveWorkspace falls back cleanly', () => {
    const spec = resolveWorkspace({ role: 'doctor', specialty: 'general_practice', clinic: allModulesConfig('doctor') /* no prefs */ })
    expect(spec.dashboardWidgets.length).toBeGreaterThan(0)
    expect(spec.specialty).toBe('general_practice')
  })
})

import { tenantGateView, isNavVisible, nextCacheAction, clinicDisplayName } from '../tenant'
import type { Role } from '@/types/database'

// Representative nav gates from the Sidebar.
const ADMIN_MENU_ROLES: Role[] = ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist', 'cashier']
const ANALYTICS_ROLES: Role[] = ['super_admin', 'admin']

describe('tenantGateView — separate loading from missing-profile', () => {
  it('renders (ready) whenever a profile exists, even while revalidating/erroring', () => {
    expect(tenantGateView('loading', true)).toBe('ready')
    expect(tenantGateView('error', true)).toBe('ready')
    expect(tenantGateView('ready', true)).toBe('ready')
  })

  it('shows an explicit error only on a hard failure with NO profile', () => {
    expect(tenantGateView('error', false)).toBe('error')
  })

  it('shows a loader (never a generic shell) while loading with no profile yet', () => {
    expect(tenantGateView('loading', false)).toBe('loading')
  })
})

describe('isNavVisible — role gating (admin refresh preserves the menu)', () => {
  it('an admin sees gated items (full menu), not just dashboard/settings', () => {
    expect(isNavVisible('admin', ADMIN_MENU_ROLES)).toBe(true)
    expect(isNavVisible('admin', ANALYTICS_ROLES)).toBe(true)
  })

  it('ungated items (dashboard, settings) are always visible', () => {
    expect(isNavVisible(undefined, undefined)).toBe(true)
    expect(isNavVisible('doctor', undefined)).toBe(true)
  })

  it('an unknown role hides gated items (this is exactly what the gate prevents)', () => {
    expect(isNavVisible(undefined, ADMIN_MENU_ROLES)).toBe(false)
    expect(isNavVisible(undefined, ANALYTICS_ROLES)).toBe(false)
  })

  it('a role without permission does not see the item', () => {
    expect(isNavVisible('pharmacist', ANALYTICS_ROLES)).toBe(false)
  })
})

describe('nextCacheAction — user switch clears cached tenant context', () => {
  it('wipes when a DIFFERENT user loads on the same device', () => {
    expect(nextCacheAction('user-a', 'user-b')).toBe('switch-wipe')
  })
  it('keeps the cache for the SAME user (stable across refresh/navigation)', () => {
    expect(nextCacheAction('user-a', 'user-a')).toBe('keep')
    expect(nextCacheAction(null, 'user-a')).toBe('keep')
  })
  it('wipes on logout (session gone but an owner was stored)', () => {
    expect(nextCacheAction('user-a', null)).toBe('logout-wipe')
  })
})

describe('clinicDisplayName — never falls back to a hardcoded "CHMS"', () => {
  it('returns the real tenant name', () => {
    expect(clinicDisplayName({ name: 'Hôpital Régional de Saint Louis' })).toBe('Hôpital Régional de Saint Louis')
  })
  it('returns null (not "CHMS") when the clinic is absent/empty', () => {
    expect(clinicDisplayName(null)).toBeNull()
    expect(clinicDisplayName({ name: '' })).toBeNull()
    expect(clinicDisplayName({ name: '   ' })).toBeNull()
    expect(clinicDisplayName(undefined)).toBeNull()
  })
})

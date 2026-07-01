// Pure tenant-resolution helpers. No React, no Supabase — unit-tested. These
// encode the rules that keep tenant context stable and prevent the app from
// ever rendering a generic/degraded shell for an authenticated user.

import type { Role } from '@/types/database'

export type TenantStatus = 'loading' | 'ready' | 'error'

/**
 * What the tenant gate should render. The invariant: if we HAVE a profile we
 * always render the app (even while revalidating) — we never fall back to a
 * generic shell. Only a genuine failure with NO data shows the error screen;
 * otherwise we show a loader. This separates "loading" from "missing profile".
 */
export function tenantGateView(status: TenantStatus, hasProfile: boolean): 'loading' | 'error' | 'ready' {
  if (hasProfile) return 'ready'
  if (status === 'error') return 'error'
  return 'loading'
}

/** Whether a nav item is visible for a role. Undefined role → gated items hidden. */
export function isNavVisible(role: Role | undefined, itemRoles?: Role[]): boolean {
  if (!itemRoles) return true
  return role ? itemRoles.includes(role) : false
}

/**
 * Cache action when (re)resolving the tenant, given the previously stored owner
 * uid and the current uid. Ensures a different user on the same device never
 * inherits the previous user's cached tenant data.
 */
export type CacheAction = 'logout-wipe' | 'switch-wipe' | 'keep'
export function nextCacheAction(owner: string | null, uid: string | null): CacheAction {
  if (!uid) return owner ? 'logout-wipe' : 'keep'
  if (owner && owner !== uid) return 'switch-wipe'
  return 'keep'
}

/**
 * Clinic display name — the REAL tenant name or null. Never a hardcoded product
 * fallback; callers decide how to present a genuinely clinic-less user (e.g.
 * super_admin), but they must not paper over a missing tenant with "CHMS".
 */
export function clinicDisplayName(clinic: { name?: string | null } | null | undefined): string | null {
  const name = clinic?.name?.trim()
  return name ? name : null
}

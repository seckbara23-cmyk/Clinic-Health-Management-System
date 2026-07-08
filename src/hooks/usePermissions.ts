'use client'

// ── usePermissions — Enterprise Authorization React binding (Phase 40) ──
//
// Turns the current tenant profile into a `Principal` and exposes the pure engine
// as memoized helpers. Components call `can('consultations.view')` instead of
// checking `role === 'doctor'`. Purely a UI/UX layer — RLS still enforces on the
// server; a permitted button whose data RLS refuses simply yields an empty result.

import { useMemo } from 'react'
import { useClinic } from '@/context/ClinicContext'
import {
  can as engineCan,
  canAny as engineCanAny,
  canAll as engineCanAll,
  canField as engineCanField,
  maskField as engineMaskField,
  canModule as engineCanModule,
  visibleModules as engineVisibleModules,
  permissionsFor,
  aiDomainsFor,
  canAiDomain as engineCanAiDomain,
  type Principal,
} from '@/lib/authz/engine'

export function usePermissions() {
  const { profile } = useClinic()

  const principal: Principal = useMemo(() => ({
    role: profile?.role ?? null,
    primarySpecialtyId: profile?.primary_specialty ?? null,
    // customGrants / breakGlass are intentionally omitted in v1.0 — the default
    // matrix drives all access. Custom-role wiring reads authz_custom_grants later.
  }), [profile?.role, profile?.primary_specialty])

  return useMemo(() => ({
    principal,
    can: (perm: string) => engineCan(principal, perm),
    canAny: (perms: string[]) => engineCanAny(principal, perms),
    canAll: (perms: string[]) => engineCanAll(principal, perms),
    canModule: (moduleId: string) => engineCanModule(principal, moduleId),
    canField: (field: string) => engineCanField(principal, field),
    maskField: <T,>(field: string, value: T, mask?: string) => engineMaskField(principal, field, value, mask),
    visibleModules: () => engineVisibleModules(principal),
    permissions: () => permissionsFor(principal),
    aiDomains: () => aiDomainsFor(principal),
    canAiDomain: (domain: string) => engineCanAiDomain(principal, domain),
  }), [principal])
}

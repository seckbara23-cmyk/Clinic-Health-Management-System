import { useMemo } from 'react'
import { useClinic } from '@/context/ClinicContext'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import { useEnabledPacks } from '@/hooks/useCopilotGovernance'
import { resolveEffectiveWorkspace } from '@/lib/workspace/spec'
import type { WorkspaceSpec } from '@/lib/workspace/types'
import type { Role } from '@/types/database'

// ── useWorkspaceSpec (Phase 14.2.6 — Workspace Renderer Foundation) ─
//
// Combines every layer built so far — professional identity (14.2.1/.2),
// specialty selection (14.2.3), enabled Copilot Packs (14.2.4/.5), user
// preferences (14.1) — into the single resolved WorkspaceSpec via the pure
// resolveWorkspace() engine (14.1), through the spec.ts adapter.
//
// FOUNDATION ONLY: no Copilot Pack currently contributes any widget, action,
// template, or AI tool (every future*Id list is empty, 14.2.4) — so
// `enabledPackIds` is informational only and has NO effect on the resolved
// spec yet. Similarly, only `general_practice` is a registered specialty
// (14.1), so ANY specialty selection other than general_practice safely falls
// back — there is no specialty-specific workspace in this phase.
//
// Tolerant by construction: every input hook already degrades to a safe
// default on a missing table/row (professional profile → fallback profile,
// preferences → {}, pack governance → []). resolveEffectiveWorkspace is pure
// and always returns a valid spec. This hook can NEVER throw and NEVER blocks
// login or the dashboard — nothing currently renders it in place of the real
// dashboard page (see WorkspaceRenderer / the read-only "My Workspace" preview).
export interface UseWorkspaceSpecResult {
  spec: WorkspaceSpec
  role: Role
  /** The professional's SELECTED specialty (may be unregistered — see above). */
  selectedSpecialtyId: string | null
  /** The specialty the spec was actually RESOLVED against (post-fallback). */
  resolvedSpecialtyId: string
  professionId: string
  enabledPackIds: string[]
  isFallback: boolean
  isLoading: boolean
}

export function useWorkspaceSpec(): UseWorkspaceSpecResult {
  const { profile: account } = useClinic()
  const identity = useProfessionalIdentity()
  const prefsQuery = useUserPreferences()
  const packs = useEnabledPacks()

  const role = (account?.role as Role | undefined) ?? 'doctor'
  const selectedSpecialtyId = identity.specialties.primary?.id ?? null
  const prefs = prefsQuery.data

  const spec = useMemo(
    () => resolveEffectiveWorkspace({ role, specialtyId: selectedSpecialtyId, prefs }),
    [role, selectedSpecialtyId, prefs],
  )

  return {
    spec,
    role,
    selectedSpecialtyId,
    resolvedSpecialtyId: spec.specialty,
    professionId: identity.profession.id,
    enabledPackIds: packs.enabled.map(p => p.packId),
    isFallback: identity.isFallback || !selectedSpecialtyId || spec.specialty !== selectedSpecialtyId,
    isLoading: identity.isLoading || prefsQuery.isLoading || packs.isLoading,
  }
}

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { COPILOT_PACKS, PLATFORM_VERSION, getCopilotPack } from '@/lib/copilot-packs/registry'
import { CAPABILITY_LEVELS } from '@/lib/copilot-packs/capability-levels'
import { validatePackCompatibility, packsForContext, type PackContext } from '@/lib/copilot-packs/compatibility'
import { resolveDependencies, optionalExtensionsOf } from '@/lib/copilot-packs/dependencies'
import type { PackInstallation, PackInstallStatus, CapabilityLevelId } from '@/lib/copilot-packs/types'

// ── Clinical Copilot Pack hooks (Phase 14.2.4) ─────────────────────
//
// Tolerant by construction: the registry is CODE (no read can fail), and the
// only DB touch — clinic installations — degrades to [] when the table is
// absent (migration 040 not yet applied). Nothing here renders, calls AI, or
// executes a workflow. Nothing can block login, the dashboard, or navigation.
//
// P0 guard: the installations read hits a SINGLE table by its own columns — no
// `clinics` embed, no relationship traversal — so no PGRST201 surface.

/** The full catalog + capability-level vocabulary. Pure, always available. */
export function useCopilotRegistry() {
  return {
    packs: COPILOT_PACKS,
    capabilityLevels: CAPABILITY_LEVELS,
    platformVersion: PLATFORM_VERSION,
  }
}

/** Clinic pack installations (migration 040). Tolerant → [] if table absent. */
export function useClinicPackInstallations() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['copilot_pack_installations', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PackInstallation[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('copilot_pack_installations')
          .select('pack_id, status, capability_level')
          .eq('clinic_id', clinic!.id)
        if (error) return []
        return (data ?? []).map((r: { pack_id: string; status: string; capability_level: string | null }) => ({
          packId: r.pack_id,
          status: (r.status as PackInstallStatus) ?? 'installed',
          capabilityLevel: (r.capability_level as CapabilityLevelId | null) ?? null,
        }))
      } catch {
        return []
      }
    },
  })
}

/** Build a compatibility context from the current professional identity. */
function useCurrentPackContext(): { ctx: PackContext; installedIds: string[]; isLoading: boolean } {
  const identity = useProfessionalIdentity()
  const installs = useClinicPackInstallations()
  const installedIds = useMemo(
    () => (installs.data ?? []).filter(i => i.status === 'installed').map(i => i.packId),
    [installs.data],
  )
  const ctx = useMemo<PackContext>(() => ({
    professionId: identity.profession.id,
    primarySpecialty: identity.specialties.primary?.id ?? null,
    secondarySpecialties: identity.specialties.secondaries.map(s => s.id),
    installedPackIds: installedIds,
    platformVersion: PLATFORM_VERSION,
  }), [identity.profession.id, identity.specialties, installedIds])
  return { ctx, installedIds, isLoading: identity.isLoading || installs.isLoading }
}

export interface AvailablePack {
  id: string
  installed: boolean
  compatible: boolean
}

/** Packs the current professional could use (profession + specialty), each
 *  annotated with clinic-installation + full-compatibility status. */
export function useAvailablePacks() {
  const { ctx, installedIds, isLoading } = useCurrentPackContext()
  const available = useMemo<AvailablePack[]>(() => {
    const installed = new Set(installedIds)
    return packsForContext(ctx).map(pack => ({
      id: pack.id,
      installed: installed.has(pack.id),
      compatible: validatePackCompatibility(pack, ctx).compatible,
    }))
  }, [ctx, installedIds])
  return { packs: available, isLoading }
}

/** Validate a specific pack against the current context. Tolerant/null-safe. */
export function usePackValidation(packId: string | null | undefined) {
  const { ctx, isLoading } = useCurrentPackContext()
  const result = useMemo(() => {
    const pack = getCopilotPack(packId)
    return pack ? validatePackCompatibility(pack, ctx) : null
  }, [packId, ctx])
  return { result, isLoading }
}

/** Resolve a pack's dependency closure + optional extensions. Pure/deterministic. */
export function usePackDependencies(packId: string | null | undefined) {
  return useMemo(() => {
    if (!packId) return null
    return {
      resolution: resolveDependencies(packId),
      optionalExtensions: optionalExtensionsOf(packId),
    }
  }, [packId])
}

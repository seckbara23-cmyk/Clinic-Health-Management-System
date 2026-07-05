import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { COPILOT_PACKS, PLATFORM_VERSION, getCopilotPack } from '@/lib/copilot-packs/registry'
import {
  parseClinicPackRecords, parsePackEnablement, resolveEffectivePacks, effectivelyEnabledPacks,
  canProfessionalToggle, type ClinicPackRecord, type PackEnablement,
} from '@/lib/copilot-packs/governance'
import { detectVersionState, pendingUpgrades, packsNeedingAttention } from '@/lib/copilot-packs/lifecycle'
import type { PackContext } from '@/lib/copilot-packs/compatibility'

// ── Clinical Copilot Governance hooks (Phase 14.2.5) ───────────────
//
// Read + management SEAMS for pack governance. Tolerant by construction: the
// catalog is code, and the only DB touches (clinic installations, professional
// enablement) degrade to []/{} when migrations 040/041 are absent. Nothing here
// renders, calls AI, or runs a workflow — the output feeds a LATER renderer.
//
// P0 guard: every read hits a SINGLE table by its own columns (no `clinics`
// embed, no relationship traversal) → no PGRST201 surface. Writes are RLS-gated
// (installations: admin/super_admin; enablement: the professional's own row).

// ── Reads ───────────────────────────────────────────────────────────

/** Clinic pack installation + governance records (migration 040/041). → [] tolerant. */
export function useInstalledPacks() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['copilot_pack_governance', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ClinicPackRecord[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('copilot_pack_installations')
          .select('*')
          .eq('clinic_id', clinic!.id)
        if (error) return []
        return parseClinicPackRecords(data)
      } catch {
        return []
      }
    },
  })
}

/** Clinic governance view: records + helpers. Pure derivations over the read. */
export function useClinicGovernance() {
  const query = useInstalledPacks()
  const records = useMemo(() => query.data ?? [], [query.data])
  const byPackId = useMemo(() => new Map(records.map(r => [r.packId, r])), [records])
  return {
    records,
    byPackId,
    mandatory: records.filter(r => r.requirement === 'mandatory').map(r => r.packId),
    hidden: records.filter(r => r.hidden).map(r => r.packId),
    locked: records.filter(r => r.locked).map(r => r.packId),
    installed: records.filter(r => r.status === 'installed').map(r => r.packId),
    isLoading: query.isLoading,
  }
}

/** The current professional's per-pack enablement map (professional_profiles JSONB). */
export function useProfessionalEnablement() {
  const { profile: account, clinic } = useClinic()
  const supabase = createClient()
  const userId = account?.id
  const clinicId = clinic?.id
  return useQuery({
    queryKey: ['professional_pack_enablement', userId, clinicId],
    enabled: !!userId && !!clinicId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, PackEnablement>> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('professional_profiles')
          .select('pack_enablement')
          .eq('user_id', userId!)
          .eq('clinic_id', clinicId!)
          .maybeSingle()
        if (error) return {}
        return parsePackEnablement(data?.pack_enablement)
      } catch {
        return {}
      }
    },
  })
}

function useGovernanceContext(): { context: PackContext; isLoading: boolean } {
  const identity = useProfessionalIdentity()
  const context = useMemo<PackContext>(() => ({
    professionId: identity.profession.id,
    primarySpecialty: identity.specialties.primary?.id ?? null,
    secondarySpecialties: identity.specialties.secondaries.map(s => s.id),
    platformVersion: PLATFORM_VERSION,
  }), [identity.profession.id, identity.specialties])
  return { context, isLoading: identity.isLoading }
}

/** The effective pack set for the current professional (governance applied).
 *  This is the renderer's future input — computed here, rendered later. */
export function useEnabledPacks() {
  const installs = useInstalledPacks()
  const enablementQ = useProfessionalEnablement()
  const { context, isLoading } = useGovernanceContext()

  const states = useMemo(() => {
    const input = {
      catalog: COPILOT_PACKS,
      clinicRecords: installs.data ?? [],
      enablement: enablementQ.data ?? {},
      context,
    }
    return {
      all: resolveEffectivePacks(input),
      enabled: effectivelyEnabledPacks(input),
    }
  }, [installs.data, enablementQ.data, context])

  return {
    states: states.all,
    enabled: states.enabled,
    isLoading: isLoading || installs.isLoading || enablementQ.isLoading,
  }
}

/** Version / lifecycle state for one pack, or a clinic-wide summary. */
export function usePackLifecycle(packId?: string | null) {
  const { records, isLoading } = useClinicGovernance()
  return useMemo(() => {
    if (packId) {
      const record = records.find(r => r.packId === packId) ?? null
      return { version: detectVersionState(record, getCopilotPack(packId)), isLoading }
    }
    return {
      upgrades: pendingUpgrades(records, COPILOT_PACKS),
      needsAttention: packsNeedingAttention(records, COPILOT_PACKS),
      isLoading,
    }
  }, [packId, records, isLoading])
}

// ── Writes (RLS-gated seams; no UI wired this phase) ───────────────

export interface InstallPackInput {
  packId: string
  status?: 'installed' | 'disabled' | 'deprecated'
  lifecycleStage?: 'preview' | 'beta' | 'stable' | 'retired'
  requirement?: 'mandatory' | 'optional'
  hidden?: boolean
  locked?: boolean
  minCapabilityLevel?: string | null
  maxCapabilityLevel?: string | null
  capabilityLevel?: string | null
  currentVersion?: string | null
  previousVersion?: string | null
}

/** Install / govern a pack for the clinic (admin/super_admin via RLS). */
export function useSetPackInstallation() {
  const qc = useQueryClient()
  const { profile: account, clinic } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: InstallPackInput) => {
      if (!clinic?.id) throw new Error('No active clinic')
      const manifest = getCopilotPack(input.packId)
      const row: Record<string, unknown> = {
        clinic_id: clinic.id,
        pack_id: input.packId,
        installed_by: account?.id ?? null,
        updated_at: new Date().toISOString(),
      }
      if (input.status !== undefined) row.status = input.status
      if (input.lifecycleStage !== undefined) row.lifecycle_stage = input.lifecycleStage
      if (input.requirement !== undefined) row.requirement = input.requirement
      if (input.hidden !== undefined) row.hidden = input.hidden
      if (input.locked !== undefined) row.locked = input.locked
      if (input.minCapabilityLevel !== undefined) row.min_capability_level = input.minCapabilityLevel
      if (input.maxCapabilityLevel !== undefined) row.max_capability_level = input.maxCapabilityLevel
      if (input.capabilityLevel !== undefined) row.capability_level = input.capabilityLevel
      // Version bookkeeping — default to the catalog version on first install.
      if (input.currentVersion !== undefined) row.current_version = input.currentVersion
      else if (manifest) row.current_version = manifest.version
      if (input.previousVersion !== undefined) row.previous_version = input.previousVersion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('copilot_pack_installations')
        .upsert(row, { onConflict: 'clinic_id,pack_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot_pack_governance', clinic?.id] }),
  })
}

/** Set the current professional's enablement for one pack (own row via RLS).
 *  Merges into the pack_enablement JSONB — other packs untouched. */
export function useSetProfessionalEnablement() {
  const qc = useQueryClient()
  const { profile: account, clinic } = useClinic()
  const enablementQ = useProfessionalEnablement()
  const supabase = createClient()
  return useMutation({
    mutationFn: async ({ packId, entry }: { packId: string; entry: PackEnablement }) => {
      const userId = account?.id
      const clinicId = clinic?.id
      if (!userId || !clinicId) throw new Error('No active session/clinic')
      const current = enablementQ.data ?? {}
      const merged = { ...current, [packId]: { ...current[packId], ...entry } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('professional_profiles')
        .upsert({ user_id: userId, clinic_id: clinicId, pack_enablement: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id,clinic_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['professional_pack_enablement', account?.id, clinic?.id] }),
  })
}

// Re-export the pure toggle check for consumers.
export { canProfessionalToggle }

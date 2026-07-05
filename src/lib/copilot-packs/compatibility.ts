// ── Copilot Pack compatibility engine (Phase 14.2.4) ───────────────
//
// Pure VALIDATION only — no renderer, no workflow, no side effects. Answers
// "may this pack apply in this context?" by comparing the pack's declared
// targeting metadata against a plain context object of ids. It imports nothing
// from the profession/specialty layers: the caller (a hook) passes the resolved
// ids in, so this engine stays fully decoupled and reusable.
//
// Compatibility is NOT authorization: it never grants or removes anything. RBAC,
// RLS and permissions are entirely untouched by pack compatibility.

import type { CopilotPackManifest, CapabilityLevelId } from './types'
import { COPILOT_PACKS, PLATFORM_VERSION } from './registry'
import { satisfiesMinVersion } from './dependencies'

export interface PackContext {
  professionId?: string | null
  primarySpecialty?: string | null
  secondarySpecialties?: string[]
  capabilityLevel?: string | null
  /** Pack ids the clinic has installed (for install + dependency checks). */
  installedPackIds?: string[]
  platformVersion?: string
}

// Error codes (i18n at the UI layer, later phases).
export type PackCompatCode =
  | 'pack_not_active'
  | 'platform_too_old'
  | 'profession_incompatible'
  | 'primary_specialty_incompatible'
  | 'secondary_specialty_incompatible'
  | 'specialty_incompatible'
  | 'capability_level_unsupported'
  | 'not_installed'
  | 'dependency_not_installed'

export interface PackCompatResult {
  compatible: boolean
  errors: PackCompatCode[]
  // Granular signals (useful for later UI without re-deriving).
  professionCompatible: boolean
  primarySpecialtyCompatible: boolean
  secondarySpecialtyCompatible: boolean
  capabilityLevelCompatible: boolean
  installed: boolean | null       // null when installedPackIds not provided
}

/**
 * Validate a pack against a professional/clinic context. Deterministic, tolerant
 * of missing context fields (a field that isn't provided is simply not checked).
 */
export function validatePackCompatibility(
  pack: CopilotPackManifest,
  ctx: PackContext,
): PackCompatResult {
  const errors: PackCompatCode[] = []

  // Status + platform version
  if (pack.status !== 'active') errors.push('pack_not_active')
  const platform = ctx.platformVersion ?? PLATFORM_VERSION
  if (!satisfiesMinVersion(platform, pack.minPlatformVersion)) errors.push('platform_too_old')

  // Profession compatibility (only when a profession is supplied)
  const professionCompatible =
    !ctx.professionId || pack.requiredProfessions.length === 0
      ? true
      : pack.requiredProfessions.includes(ctx.professionId)
  if (ctx.professionId && !professionCompatible) errors.push('profession_incompatible')

  // Specialty compatibility. A pack with no supportedSpecialties is universal.
  const supported = new Set(pack.supportedSpecialties)
  const hasSpecialtyTargeting = supported.size > 0
  const primarySpecialtyCompatible =
    !hasSpecialtyTargeting || (!!ctx.primarySpecialty && supported.has(ctx.primarySpecialty))
  const secondaries = ctx.secondarySpecialties ?? []
  const secondarySpecialtyCompatible =
    !hasSpecialtyTargeting || secondaries.some(s => supported.has(s))

  if (hasSpecialtyTargeting && (ctx.primarySpecialty !== undefined || secondaries.length > 0)) {
    // Overall specialty compatibility = primary OR any secondary matches.
    if (!primarySpecialtyCompatible && !secondarySpecialtyCompatible) {
      errors.push('specialty_incompatible')
      if (ctx.primarySpecialty) errors.push('primary_specialty_incompatible')
      if (secondaries.length) errors.push('secondary_specialty_incompatible')
    }
  }

  // Capability level (only when one is supplied)
  const capabilityLevelCompatible =
    !ctx.capabilityLevel || pack.capabilityLevels.includes(ctx.capabilityLevel as CapabilityLevelId)
  if (ctx.capabilityLevel && !capabilityLevelCompatible) errors.push('capability_level_unsupported')

  // Clinic installation (only when the installed set is supplied)
  let installed: boolean | null = null
  if (ctx.installedPackIds) {
    const set = new Set(ctx.installedPackIds)
    installed = set.has(pack.id)
    if (!installed) errors.push('not_installed')
    // Hard dependencies must also be installed.
    for (const d of pack.dependsOn) {
      if (!set.has(d.id)) { errors.push('dependency_not_installed'); break }
    }
  }

  return {
    compatible: errors.length === 0,
    errors,
    professionCompatible,
    primarySpecialtyCompatible,
    secondarySpecialtyCompatible,
    capabilityLevelCompatible,
    installed,
  }
}

/** Packs a professional could use (profession + specialty), independent of clinic
 *  installation. Pure filter — no side effects. */
export function packsForContext(
  ctx: PackContext,
  registry: CopilotPackManifest[] = COPILOT_PACKS,
): CopilotPackManifest[] {
  return registry.filter(pack => {
    if (pack.status !== 'active') return false
    const r = validatePackCompatibility(pack, { ...ctx, installedPackIds: undefined })
    return r.professionCompatible && (r.primarySpecialtyCompatible || r.secondarySpecialtyCompatible)
  })
}

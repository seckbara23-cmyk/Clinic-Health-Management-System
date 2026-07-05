// ── Clinical Copilot Governance engine (Phase 14.2.5) ──────────────
//
// Pure, deterministic governance over the pack registry. It answers, for a given
// professional in a given clinic, WHICH packs are effectively enabled and at what
// capability level — WITHOUT rendering anything. The future Workspace Renderer
// consumes this output; this layer never renders, calls AI, or runs a workflow.
//
// Three-tier model (frozen §11): catalog (code) ⊇ clinic install/governance
// (data) ⊇ professional enablement (data). Governance is NEVER authorization:
// RBAC, RLS and permissions are entirely untouched. A "locked" or "mandatory"
// pack shapes the workspace, it does not grant or remove data access.

import type { CopilotPackManifest, CapabilityLevelId } from './types'
import { CAPABILITY_LEVELS } from './capability-levels'
import { validatePackCompatibility, type PackContext } from './compatibility'

// ── Governance data model (mirrors migration 041) ──────────────────
export type InstallStatus = 'installed' | 'disabled' | 'deprecated'
export type LifecycleStage = 'preview' | 'beta' | 'stable' | 'retired'
export type PackRequirement = 'mandatory' | 'optional'

export interface ClinicPackRecord {
  packId: string
  status: InstallStatus
  lifecycleStage: LifecycleStage
  currentVersion: string | null
  previousVersion: string | null
  requirement: PackRequirement
  hidden: boolean
  locked: boolean
  minCapabilityLevel: CapabilityLevelId | null
  maxCapabilityLevel: CapabilityLevelId | null
  capabilityLevel: CapabilityLevelId | null   // clinic-wide default level (optional)
  installedBy: string | null
  installedAt: string | null
}

export interface PackEnablement {
  enabled?: boolean
  preferred?: boolean
  pinned?: boolean
  favorite?: boolean
  level?: CapabilityLevelId | null
}

// ── Tolerant parsers (DB row / JSONB → model) ──────────────────────
const INSTALL_STATUSES: InstallStatus[] = ['installed', 'disabled', 'deprecated']
const LIFECYCLE_STAGES: LifecycleStage[] = ['preview', 'beta', 'stable', 'retired']

function asLevel(v: unknown): CapabilityLevelId | null {
  return CAPABILITY_LEVELS.some(l => l.id === v) ? (v as CapabilityLevelId) : null
}

/** Map raw copilot_pack_installations rows → ClinicPackRecord[] (never throws). */
export function parseClinicPackRecords(rows: unknown): ClinicPackRecord[] {
  if (!Array.isArray(rows)) return []
  const out: ClinicPackRecord[] = []
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.pack_id !== 'string') continue
    out.push({
      packId: r.pack_id,
      status: INSTALL_STATUSES.includes(r.status as InstallStatus) ? (r.status as InstallStatus) : 'installed',
      lifecycleStage: LIFECYCLE_STAGES.includes(r.lifecycle_stage as LifecycleStage) ? (r.lifecycle_stage as LifecycleStage) : 'stable',
      currentVersion: typeof r.current_version === 'string' ? r.current_version : null,
      previousVersion: typeof r.previous_version === 'string' ? r.previous_version : null,
      requirement: r.requirement === 'mandatory' ? 'mandatory' : 'optional',
      hidden: r.hidden === true,
      locked: r.locked === true,
      minCapabilityLevel: asLevel(r.min_capability_level),
      maxCapabilityLevel: asLevel(r.max_capability_level),
      capabilityLevel: asLevel(r.capability_level),
      installedBy: typeof r.installed_by === 'string' ? r.installed_by : null,
      installedAt: typeof r.installed_at === 'string' ? r.installed_at : null,
    })
  }
  return out
}

/** Map professional_profiles.pack_enablement JSONB → typed map (never throws). */
export function parsePackEnablement(input: unknown): Record<string, PackEnablement> {
  let raw: unknown = input
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return {} }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, PackEnablement> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const e = v as Record<string, unknown>
    out[k] = {
      enabled: e.enabled === true,
      preferred: e.preferred === true,
      pinned: e.pinned === true,
      favorite: e.favorite === true,
      level: asLevel(e.level),
    }
  }
  return out
}

// ── Capability-level clamping ───────────────────────────────────────
function rank(level: CapabilityLevelId | null): number | null {
  return CAPABILITY_LEVELS.find(l => l.id === level)?.rank ?? null
}

/**
 * Clamp a desired capability level into the clinic's [min, max] window AND the
 * pack's offered ladder. Pure. Returns null when nothing is offered/desired.
 * This shapes experience only — it is not a permission tier.
 */
export function clampCapabilityLevel(
  desired: CapabilityLevelId | null,
  pack: CopilotPackManifest,
  min: CapabilityLevelId | null,
  max: CapabilityLevelId | null,
): CapabilityLevelId | null {
  // Offered levels, ordered by rank.
  const offered = pack.capabilityLevels
    .map(id => CAPABILITY_LEVELS.find(l => l.id === id))
    .filter((l): l is (typeof CAPABILITY_LEVELS)[number] => !!l)
    .sort((a, b) => a.rank - b.rank)
  const minR = rank(min)
  const maxR = rank(max)
  const allowed = offered.filter(l => (minR == null || l.rank >= minR) && (maxR == null || l.rank <= maxR))
  if (allowed.length === 0) return null

  // A desired level is only meaningful if the pack OFFERS it (same ladder). A
  // wrong-ladder / unknown level is treated as "unset".
  const desiredValid = desired && offered.some(l => l.id === desired) ? desired : null
  if (!desiredValid) {
    // Truly unset with no constraint → null; otherwise fall to the lowest allowed.
    return desired == null && minR == null && maxR == null ? null : allowed[0].id
  }
  const desiredR = rank(desiredValid)!
  if (allowed.some(l => l.id === desiredValid)) return desiredValid
  if (desiredR < allowed[0].rank) return allowed[0].id
  return allowed[allowed.length - 1].id
}

// ── Effective resolution (the governance engine) ───────────────────
export type EffectiveReason =
  | 'not_installed' | 'clinic_disabled' | 'deprecated' | 'incompatible'
  | 'mandatory' | 'locked' | 'professional_opt_in' | 'professional_opt_out'

export type EffectiveSource = 'mandatory' | 'locked' | 'professional' | 'unavailable'

export interface EffectivePackState {
  packId: string
  available: boolean            // clinic-installed + compatible
  effectivelyEnabled: boolean
  canToggle: boolean            // may the professional change enablement?
  hidden: boolean
  pinned: boolean
  favorite: boolean
  preferred: boolean
  effectiveLevel: CapabilityLevelId | null
  source: EffectiveSource
  reasons: EffectiveReason[]
}

export interface GovernanceInput {
  catalog: CopilotPackManifest[]
  clinicRecords: ClinicPackRecord[]
  enablement: Record<string, PackEnablement>
  context: PackContext          // profession + specialties of the professional
}

/**
 * Resolve the effective pack set for a professional. Precedence:
 *   1. clinic must have INSTALLED it (status installed, not disabled/deprecated)
 *   2. it must be COMPATIBLE (profession + primary/secondary specialty)
 *   3. MANDATORY → forced enabled, cannot toggle
 *   4. LOCKED → cannot toggle; effective = professional's stored value
 *   5. OPTIONAL → professional opt-in decides
 *   6. capability level = clamp(professional desired → clinic [min,max] ∩ pack ladder)
 * Deterministic; never throws. Output feeds the future renderer — no UI here.
 */
export function resolveEffectivePacks(input: GovernanceInput): EffectivePackState[] {
  const recByPack = new Map(input.clinicRecords.map(r => [r.packId, r]))
  const installedIds = input.clinicRecords.filter(r => r.status === 'installed').map(r => r.packId)

  return input.catalog.map(pack => {
    const record = recByPack.get(pack.id)
    const en = input.enablement[pack.id] ?? {}
    const base: EffectivePackState = {
      packId: pack.id, available: false, effectivelyEnabled: false, canToggle: false,
      hidden: record?.hidden ?? false, pinned: !!en.pinned, favorite: !!en.favorite,
      preferred: !!en.preferred, effectiveLevel: null, source: 'unavailable', reasons: [],
    }

    // 1. Installation gate.
    if (!record || record.status === 'disabled' || record.status === 'deprecated') {
      base.reasons.push(!record ? 'not_installed' : record.status === 'disabled' ? 'clinic_disabled' : 'deprecated')
      return base
    }

    // 2. Compatibility gate (profession + specialty only — level handled by clamp).
    const compat = validatePackCompatibility(pack, { ...input.context, installedPackIds: installedIds })
    if (!compat.professionCompatible || !(compat.primarySpecialtyCompatible || compat.secondarySpecialtyCompatible)) {
      base.reasons.push('incompatible')
      return base
    }

    base.available = true
    const level = clampCapabilityLevel(en.level ?? record.capabilityLevel ?? null, pack, record.minCapabilityLevel, record.maxCapabilityLevel)
    base.effectiveLevel = level

    // 3–5. Enablement precedence.
    if (record.requirement === 'mandatory') {
      base.effectivelyEnabled = true
      base.canToggle = false
      base.source = 'mandatory'
      base.reasons.push('mandatory')
    } else if (record.locked) {
      base.effectivelyEnabled = en.enabled === true
      base.canToggle = false
      base.source = 'locked'
      base.reasons.push('locked')
    } else {
      base.effectivelyEnabled = en.enabled === true
      base.canToggle = true
      base.source = 'professional'
      base.reasons.push(base.effectivelyEnabled ? 'professional_opt_in' : 'professional_opt_out')
    }
    return base
  })
}

/** The packs a professional actually has ON — the renderer's input set. */
export function effectivelyEnabledPacks(input: GovernanceInput): EffectivePackState[] {
  return resolveEffectivePacks(input).filter(p => p.effectivelyEnabled)
}

/** May a professional toggle this pack's enablement? (mandatory/locked → no.) */
export function canProfessionalToggle(record: ClinicPackRecord | null | undefined): boolean {
  if (!record || record.status !== 'installed') return false
  return record.requirement !== 'mandatory' && !record.locked
}

// ── Clinical Copilot Pack Registry — types (Phase 14.2.4) ──────────
//
// The authoritative CAPABILITY-DECLARATION model for every future Clinical
// Copilot. METADATA ONLY: a manifest declares WHAT a pack will contribute; it
// contains no widget, template, AI, workflow, or renderer code.
//
// HARD DECOUPLING (frozen architecture): this module imports NOTHING from the
// profession, specialty, workspace, widget, template, AI or pathway layers. A
// pack references those layers exclusively by BARE STRING ID:
//   • requiredProfessions / supportedSpecialties → ids from those registries
//   • future*Ids → ids of capabilities added in LATER phases (always empty now)
// Referential integrity (those ids resolving to real registry entries) is
// asserted by tests, not by a runtime import — so the registry stays standalone,
// reusable, and independently extensible.

// ── Capability levels ───────────────────────────────────────────────
// Two ladders (frozen §6). Levels shape FUTURE workspace composition only —
// NEVER permissions, NEVER RBAC.
export type CapabilityLevelId =
  | 'basic' | 'advanced' | 'expert'                 // proficiency ladder
  | 'observer' | 'operator' | 'reviewer' | 'trainer' // workflow ladder

export type CapabilityLadder = 'proficiency' | 'workflow'

export interface CapabilityLevel {
  id: CapabilityLevelId
  labelKey: string
  ladder: CapabilityLadder
  /** Ordinal within its ladder (1-based). Ordering only — not a permission tier. */
  rank: number
}

// ── Pack taxonomy ───────────────────────────────────────────────────
export type PackCategory = 'clinical' | 'diagnostic' | 'support'
export type PackStatus = 'active' | 'draft' | 'deprecated'

/** A dependency on another pack, optionally pinned to a minimum version. */
export interface PackDependency {
  id: string
  minVersion?: string
}

// ── The manifest ────────────────────────────────────────────────────
export interface CopilotPackManifest {
  id: string                       // machine id, e.g. 'cardiology.core'
  code: string                     // human/marketplace code, e.g. 'CARDIO-CORE'
  labelKey: string                 // i18n name key (dot-free)
  descKey: string                  // i18n description key
  version: string                  // semver
  publisher: string                // 'chms' | third-party (future)
  status: PackStatus
  minPlatformVersion: string       // semver — capability negotiation
  category: PackCategory

  // Targeting (by id — see decoupling note above)
  requiredProfessions: string[]    // profession ids that may use this pack
  supportedSpecialties: string[]   // specialty ids this pack serves
  capabilityLevels: CapabilityLevelId[] // levels this pack offers

  // Dependencies
  dependsOn: PackDependency[]      // hard: must be installed for this pack to work
  optionalDependsOn: PackDependency[] // soft: this pack extends them when present

  // FUTURE capability contributions — ALWAYS EMPTY in 14.2.4 (metadata only).
  // Later phases populate these with ids from the respective registries.
  futureAiToolIds: string[]
  futureWidgetIds: string[]
  futureTemplateIds: string[]
  futureReportIds: string[]
  futureQuickActionIds: string[]
  futureTimelineEventTypes: string[]
  futureDocHelperIds: string[]
  futurePrintFormIds: string[]
  futurePathwayIds: string[]

  schemaVersion: number
}

// ── Clinic installation record (mirrors migration 040) ─────────────
export type PackInstallStatus = 'installed' | 'disabled'

export interface PackInstallation {
  packId: string
  status: PackInstallStatus
  capabilityLevel: CapabilityLevelId | null
}

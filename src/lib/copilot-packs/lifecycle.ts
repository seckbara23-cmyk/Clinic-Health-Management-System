// ── Copilot Pack lifecycle & version management (Phase 14.2.5) ─────
//
// Pure, deterministic version/lifecycle analysis. Detects upgrades,
// incompatibilities, deprecation, and describes (future) migration paths. No
// I/O, no rendering, no side effects — a later phase acts on these signals.

import type { CopilotPackManifest } from './types'
import { PLATFORM_VERSION } from './registry'
import { compareVersions, satisfiesMinVersion } from './dependencies'
import type { ClinicPackRecord, LifecycleStage } from './governance'

export type VersionState =
  | 'up_to_date' | 'upgrade_available' | 'ahead' | 'deprecated' | 'incompatible' | 'unknown'

export interface PackVersionInfo {
  packId: string
  installedVersion: string | null
  catalogVersion: string | null
  state: VersionState
  upgradeAvailable: boolean
  deprecated: boolean
  incompatible: boolean
  lifecycleStage: LifecycleStage | null
}

/**
 * Compare a clinic's installed version against the catalog manifest.
 * Precedence: incompatible → deprecated → version comparison. Never throws.
 */
export function detectVersionState(
  record: ClinicPackRecord | null | undefined,
  manifest: CopilotPackManifest | null | undefined,
  platformVersion: string = PLATFORM_VERSION,
): PackVersionInfo {
  const installedVersion = record?.currentVersion ?? null
  const catalogVersion = manifest?.version ?? null

  // Pack removed from / retired in the catalog.
  if (!manifest) {
    return {
      packId: record?.packId ?? 'unknown', installedVersion, catalogVersion: null,
      state: 'unknown', upgradeAvailable: false, deprecated: true, incompatible: false,
      lifecycleStage: record?.lifecycleStage ?? null,
    }
  }

  const incompatible = !satisfiesMinVersion(platformVersion, manifest.minPlatformVersion)
  const deprecated = manifest.status === 'deprecated' || record?.status === 'deprecated' || record?.lifecycleStage === 'retired'

  let state: VersionState
  let upgradeAvailable = false
  if (incompatible) {
    state = 'incompatible'
  } else if (deprecated) {
    state = 'deprecated'
  } else if (!installedVersion) {
    state = 'unknown'
  } else {
    const cmp = compareVersions(catalogVersion!, installedVersion)
    if (cmp > 0) { state = 'upgrade_available'; upgradeAvailable = true }
    else if (cmp < 0) state = 'ahead'
    else state = 'up_to_date'
  }

  return {
    packId: manifest.id, installedVersion, catalogVersion,
    state, upgradeAvailable, deprecated, incompatible,
    lifecycleStage: record?.lifecycleStage ?? null,
  }
}

export function isUpgradeAvailable(record: ClinicPackRecord | null | undefined, manifest: CopilotPackManifest | null | undefined): boolean {
  return detectVersionState(record, manifest).upgradeAvailable
}

/** All installed packs that have a newer catalog version. */
export function pendingUpgrades(records: ClinicPackRecord[], catalog: CopilotPackManifest[]): PackVersionInfo[] {
  const byId = new Map(catalog.map(p => [p.id, p]))
  return records
    .map(r => detectVersionState(r, byId.get(r.packId)))
    .filter(v => v.upgradeAvailable)
}

/** Installed packs that are deprecated or incompatible (need attention). */
export function packsNeedingAttention(records: ClinicPackRecord[], catalog: CopilotPackManifest[]): PackVersionInfo[] {
  const byId = new Map(catalog.map(p => [p.id, p]))
  return records
    .map(r => detectVersionState(r, byId.get(r.packId)))
    .filter(v => v.deprecated || v.incompatible)
}

// ── Migration paths (forward placeholder) ──────────────────────────
export interface MigrationPath {
  packId: string
  from: string | null
  to: string | null
  /** No transformation is defined yet — future phases register these. */
  hasMigration: false
}

/** Describe the version transition a pending upgrade would perform. The actual
 *  migration logic is intentionally NOT implemented in this phase. */
export function migrationPathFor(record: ClinicPackRecord | null | undefined, manifest: CopilotPackManifest | null | undefined): MigrationPath | null {
  if (!record || !manifest) return null
  const info = detectVersionState(record, manifest)
  if (!info.upgradeAvailable) return null
  return { packId: manifest.id, from: record.currentVersion, to: manifest.version, hasMigration: false }
}

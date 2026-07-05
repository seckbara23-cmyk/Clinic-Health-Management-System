// ── Copilot Pack dependency engine (Phase 14.2.4) ──────────────────
//
// Deterministic, pure dependency analysis over the pack registry:
//   • missing dependencies      (a required pack id is not registered)
//   • circular dependencies     (A → B → A)
//   • duplicate ids             (registry integrity)
//   • version conflicts         (available pack version < required minVersion)
//   • topological install order (dependencies before dependants)
//   • optional extensions       (packs that optionally extend a given pack)
//
// Every function accepts the registry as an argument (default: COPILOT_PACKS) so
// tests can exercise it against controlled fixtures. No I/O, no imports beyond
// the pack types + the shipped registry.

import type { CopilotPackManifest } from './types'
import { COPILOT_PACKS } from './registry'

// ── semver (numeric dotted, deterministic) ──────────────────────────
/** compareVersions('1.2.0','1.10.0') < 0. Non-numeric parts treated as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}
export function satisfiesMinVersion(available: string, min?: string): boolean {
  if (!min) return true
  return compareVersions(available, min) >= 0
}

function index(registry: CopilotPackManifest[]): Map<string, CopilotPackManifest> {
  const m = new Map<string, CopilotPackManifest>()
  for (const p of registry) if (!m.has(p.id)) m.set(p.id, p)
  return m
}

// ── Registry integrity ──────────────────────────────────────────────
export function duplicatePackIds(registry: CopilotPackManifest[] = COPILOT_PACKS): string[] {
  const counts = new Map<string, number>()
  for (const p of registry) counts.set(p.id, (counts.get(p.id) ?? 0) + 1)
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
}

// ── Per-pack analysis ───────────────────────────────────────────────
export interface VersionConflict { dependency: string; required: string; available: string }

export function missingDependencies(pack: CopilotPackManifest, registry: CopilotPackManifest[] = COPILOT_PACKS): string[] {
  const byId = index(registry)
  return pack.dependsOn.filter(d => !byId.has(d.id)).map(d => d.id)
}

export function versionConflicts(pack: CopilotPackManifest, registry: CopilotPackManifest[] = COPILOT_PACKS): VersionConflict[] {
  const byId = index(registry)
  const out: VersionConflict[] = []
  for (const d of pack.dependsOn) {
    const dep = byId.get(d.id)
    if (dep && d.minVersion && !satisfiesMinVersion(dep.version, d.minVersion)) {
      out.push({ dependency: d.id, required: d.minVersion, available: dep.version })
    }
  }
  return out
}

/** Packs that OPTIONALLY extend the given pack (Pack C optionally extends Pack A). */
export function optionalExtensionsOf(packId: string, registry: CopilotPackManifest[] = COPILOT_PACKS): string[] {
  return registry.filter(p => p.optionalDependsOn.some(d => d.id === packId)).map(p => p.id)
}

// ── Resolution + cycle detection ────────────────────────────────────
export interface DependencyResolution {
  ok: boolean
  /** Hard dependencies before dependants; the pack itself is last. */
  order: string[]
  missing: string[]
  circular: string[]              // ids participating in a cycle (empty if none)
  versionConflicts: VersionConflict[]
}

/** Resolve a pack's hard-dependency closure. Deterministic; never throws. */
export function resolveDependencies(packId: string, registry: CopilotPackManifest[] = COPILOT_PACKS): DependencyResolution {
  const byId = index(registry)
  const order: string[] = []
  const missing = new Set<string>()
  const circular = new Set<string>()
  const conflicts: VersionConflict[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  function visit(id: string, stack: string[]) {
    const pack = byId.get(id)
    if (!pack) { missing.add(id); return }
    const s = state.get(id)
    if (s === 'done') return
    if (s === 'visiting') {
      // Cycle: everything from the first occurrence of id in the stack onward.
      const from = stack.indexOf(id)
      for (const c of stack.slice(from)) circular.add(c)
      circular.add(id)
      return
    }
    state.set(id, 'visiting')
    for (const dep of pack.dependsOn) {
      if (dep.minVersion) {
        const d = byId.get(dep.id)
        if (d && !satisfiesMinVersion(d.version, dep.minVersion)) {
          conflicts.push({ dependency: dep.id, required: dep.minVersion, available: d.version })
        }
      }
      visit(dep.id, [...stack, id])
    }
    state.set(id, 'done')
    order.push(id)
  }

  visit(packId, [])
  return {
    ok: missing.size === 0 && circular.size === 0 && conflicts.length === 0,
    order,
    missing: [...missing],
    circular: [...circular],
    versionConflicts: conflicts,
  }
}

/** Any cyclic dependency across the whole registry (integrity gate). */
export function detectCircularDependencies(registry: CopilotPackManifest[] = COPILOT_PACKS): string[] {
  const all = new Set<string>()
  for (const p of registry) for (const c of resolveDependencies(p.id, registry).circular) all.add(c)
  return [...all]
}

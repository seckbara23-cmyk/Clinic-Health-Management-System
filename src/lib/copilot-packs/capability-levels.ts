// ── Capability Levels registry (Phase 14.2.4) ──────────────────────
//
// The controlled set of capability levels a pack may offer. Levels represent
// professional capability / workflow complexity and influence FUTURE workspace
// composition ONLY — never permissions, never RBAC (frozen §6).

import type { CapabilityLevel, CapabilityLevelId, CapabilityLadder } from './types'

export const CAPABILITY_LEVELS: CapabilityLevel[] = [
  // Proficiency ladder
  { id: 'basic', labelKey: 'lvl_basic', ladder: 'proficiency', rank: 1 },
  { id: 'advanced', labelKey: 'lvl_advanced', ladder: 'proficiency', rank: 2 },
  { id: 'expert', labelKey: 'lvl_expert', ladder: 'proficiency', rank: 3 },
  // Workflow ladder
  { id: 'observer', labelKey: 'lvl_observer', ladder: 'workflow', rank: 1 },
  { id: 'operator', labelKey: 'lvl_operator', ladder: 'workflow', rank: 2 },
  { id: 'reviewer', labelKey: 'lvl_reviewer', ladder: 'workflow', rank: 3 },
  { id: 'trainer', labelKey: 'lvl_trainer', ladder: 'workflow', rank: 4 },
]

export const PROFICIENCY_LEVELS: CapabilityLevelId[] = ['basic', 'advanced', 'expert']
export const WORKFLOW_LEVELS: CapabilityLevelId[] = ['observer', 'operator', 'reviewer', 'trainer']

export function getCapabilityLevel(id?: string | null): CapabilityLevel | null {
  return CAPABILITY_LEVELS.find(l => l.id === id) ?? null
}

export function isCapabilityLevel(id?: string | null): id is CapabilityLevelId {
  return !!id && CAPABILITY_LEVELS.some(l => l.id === id)
}

export function ladderOf(id?: string | null): CapabilityLadder | null {
  return getCapabilityLevel(id)?.ladder ?? null
}

/** All levels within a pack's ladders belong to the same ladder set — a pack must
 *  not mix proficiency and workflow levels. Pure check used by registry tests. */
export function isSingleLadder(levels: CapabilityLevelId[]): boolean {
  const ladders = new Set(levels.map(ladderOf).filter(Boolean))
  return ladders.size <= 1
}

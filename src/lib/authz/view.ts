// ── Enterprise Authorization — Matrix view builders (Phase 40) ───
//
// PURE presenters that turn the engine + registries into display grids for the
// read-only Settings › Authorization page. No I/O — everything derives from the
// default matrix, so the page shows EXACTLY what the engine enforces.

import type { Role } from '@/types/database'
import { ROLES } from './matrix'
import { MODULES, SENSITIVE_FIELDS } from './modules'
import { AI_DOMAINS, can, canField, canAiDomain, permissionsFor, type Principal } from './engine'

/** A generic principal for a role (no specialty refinement — role-level view). */
export function principalForRole(role: Role): Principal {
  return { role }
}

export interface MatrixRow {
  key: string
  labelKey: string
  cells: Record<string, boolean>   // role → allowed
}

/** Module × Role grid, keyed on each module's `view` permission. */
export function buildModuleMatrix(): MatrixRow[] {
  return MODULES.map(m => ({
    key: m.id,
    labelKey: m.labelKey,
    cells: Object.fromEntries(ROLES.map(r => [r, can(principalForRole(r), `${m.id}.view`)])),
  }))
}

/** Sensitive-field × Role grid (field-level security). */
export function buildFieldMatrix(): MatrixRow[] {
  return SENSITIVE_FIELDS.map(f => ({
    key: f,
    labelKey: `field_${f}`,
    cells: Object.fromEntries(ROLES.map(r => [r, canField(principalForRole(r), f)])),
  }))
}

/** AI data-domain × Role grid — proves AI inherits (never exceeds) user access. */
export function buildAiMatrix(): MatrixRow[] {
  return Object.keys(AI_DOMAINS).map(domain => ({
    key: domain,
    labelKey: `ai_${domain}`,
    cells: Object.fromEntries(ROLES.map(r => [r, canAiDomain(principalForRole(r), domain)])),
  }))
}

/** Per-role total number of concrete permissions (for a summary badge). */
export function permissionCounts(): Record<string, number> {
  return Object.fromEntries(ROLES.map(r => [r, permissionsFor(principalForRole(r)).length]))
}

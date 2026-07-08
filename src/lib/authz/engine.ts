// ── Enterprise Authorization — Engine (Phase 40) ─────────────────
//
// Pure, deterministic permission resolution. No I/O, no Date.now, no randomness —
// every answer is a function of (principal, permission). This is the single place
// the UI asks "may this user do X?" via `can(principal, 'consultation.view')`
// instead of scattered `role === 'doctor'` checks.
//
// SECURITY MODEL — this layer is ADDITIVE and sits ON TOP of RLS. It decides what
// the UI shows/enables and which data domains AI may read. It CANNOT grant access
// the database would refuse: RLS remains the enforcement boundary and is unchanged.
// Least-privilege by default (see matrix.ts).
//
// Resolution order for `can`:
//   1. Authoritative refinements that grants/wildcards can NEVER bypass
//      (radiology signing authority; psychiatry-notes care-team confidentiality).
//   2. Effective grant set = default matrix ∪ valid custom grants ∪ active
//      break-glass grants, matched with `<module>.*` / `*` wildcard support.

import type { Role } from '@/types/database'
import { defaultGrantsFor } from './matrix'
import { isValidPermission, allPermissionIds, MODULE_IDS, SENSITIVE_FIELDS, type SensitiveField } from './modules'

// ── Principal ─────────────────────────────────────────────────────
export interface Principal {
  role: Role | null
  /** Doctor's primary specialty (refines radiology signing authority). */
  primarySpecialtyId?: string | null
  /** Extra permission ids for custom roles / per-user grants (validated before use). */
  customGrants?: string[]
  /** Emergency elevation — DESIGN-ONLY, inert unless explicitly active & unexpired. */
  breakGlass?: BreakGlassContext | null
}

// Care team = roles allowed to read confidential psychiatric notes. NOTE: excludes
// super_admin by design (platform owner is not a member of the clinical care team).
export const CARE_TEAM_ROLES: Role[] = ['doctor', 'nurse', 'admin']

export function isCareTeam(role?: Role | string | null): boolean {
  return !!role && (CARE_TEAM_ROLES as string[]).includes(role)
}

// ── Break-glass (DESIGN-ONLY) ─────────────────────────────────────
// Future emergency-access path. Kept inert in v1.0: no production flow sets
// `active`. When wired, it MUST require a reason, be time-boxed (expiresAt), and be
// audited (see audit.ts buildBreakGlassAudit). Engine stays pure — `now` is injected.
export interface BreakGlassContext {
  active: boolean
  reason?: string | null
  grants?: string[]
  expiresAt?: string | null   // ISO 8601
  now?: string | null         // ISO 8601 (injected for deterministic expiry checks)
}

export function isBreakGlassActive(bg?: BreakGlassContext | null): boolean {
  if (!bg || !bg.active) return false
  if (!bg.reason || !bg.reason.trim()) return false          // reason REQUIRED
  if (bg.expiresAt && bg.now && bg.now >= bg.expiresAt) return false  // expired
  return true
}

function breakGlassGrants(bg?: BreakGlassContext | null): string[] {
  return isBreakGlassActive(bg) ? (bg?.grants ?? []) : []
}

// ── Grant resolution ──────────────────────────────────────────────
function effectiveGrantSet(principal?: Principal | null): Set<string> {
  const set = new Set<string>()
  for (const g of defaultGrantsFor(principal?.role)) set.add(g)
  for (const g of principal?.customGrants ?? []) if (isValidPermission(g)) set.add(g)
  for (const g of breakGlassGrants(principal?.breakGlass)) if (isValidPermission(g)) set.add(g)
  return set
}

function matchesGrant(grants: Set<string>, perm: string): boolean {
  if (grants.has('*')) return true
  if (grants.has(perm)) return true
  const dot = perm.indexOf('.')
  if (dot > 0 && grants.has(`${perm.slice(0, dot)}.*`)) return true
  return false
}

/** Radiology signing authority: radiologist (doctor + radiology) or clinic/platform admin. */
export function canRadiologySign(principal?: Principal | null): boolean {
  const role = principal?.role
  if (role === 'admin' || role === 'super_admin') return true
  if (role === 'doctor') return (principal?.primarySpecialtyId ?? '').toLowerCase() === 'radiology'
  return false
}

// ── Core: can ─────────────────────────────────────────────────────
export function can(principal: Principal | null | undefined, perm: string): boolean {
  if (!perm) return false

  // (1) Authoritative refinements — not bypassable by wildcards or custom grants.
  if (perm === 'radiology.sign') return canRadiologySign(principal)
  if (perm === 'field.psychiatry_notes' && !isCareTeam(principal?.role)) return false

  // (2) Grant match.
  return matchesGrant(effectiveGrantSet(principal), perm)
}

export function canAny(principal: Principal | null | undefined, perms: string[]): boolean {
  return perms.some(p => can(principal, p))
}

export function canAll(principal: Principal | null | undefined, perms: string[]): boolean {
  return perms.every(p => can(principal, p))
}

/** Full, concrete, sorted permission list (wildcards expanded, refinements applied). */
export function permissionsFor(principal?: Principal | null): string[] {
  const out: string[] = []
  for (const p of allPermissionIds()) if (can(principal, p)) out.push(p)
  return out.sort()
}

/** Module ids whose landing page is visible (drives sidebar & page guards). */
export function visibleModules(principal?: Principal | null): string[] {
  return MODULE_IDS.filter(id => can(principal, `${id}.view`))
}

export function canModule(principal: Principal | null | undefined, moduleId: string): boolean {
  return can(principal, `${moduleId}.view`)
}

// ── Field-level security ──────────────────────────────────────────
export function isSensitiveField(field: string): field is SensitiveField {
  return (SENSITIVE_FIELDS as readonly string[]).includes(field)
}

/** Non-sensitive fields are always visible; sensitive ones require `field.<name>`. */
export function canField(principal: Principal | null | undefined, field: string): boolean {
  if (!isSensitiveField(field)) return true
  return can(principal, `field.${field}`)
}

const MASK = '••••••'

/** Returns the value if permitted, otherwise a mask token (never the raw value). */
export function maskField<T>(
  principal: Principal | null | undefined,
  field: string,
  value: T,
  mask: string = MASK,
): T | string {
  return canField(principal, field) ? value : mask
}

// ── AI permission inheritance ─────────────────────────────────────
// AI features may only read data domains the principal can already reach. Each
// domain is gated by an existing module/field permission, so AI can NEVER see more
// than the user. Lab AI → laboratory, Radiology AI → radiology, Executive AI →
// executive metrics, Psychiatry copilot → confidential (care team only).
export const AI_DOMAINS: Record<string, string> = {
  clinical:     'consultations.view',
  laboratory:   'laboratory.view',
  radiology:    'radiology.view',
  pharmacy:     'pharmacy.view',
  executive:    'reports.view',
  confidential: 'field.psychiatry_notes',
}

export type AiDomain = keyof typeof AI_DOMAINS

/** Data domains AI may read for this principal, derived purely from can(). */
export function aiDomainsFor(principal?: Principal | null): string[] {
  return Object.keys(AI_DOMAINS).filter(domain => can(principal, AI_DOMAINS[domain]))
}

/** Whether an AI feature scoped to `domain` is permitted for this principal. */
export function canAiDomain(principal: Principal | null | undefined, domain: string): boolean {
  const gate = AI_DOMAINS[domain]
  return !!gate && can(principal, gate)
}

// ── Professional Identity Engine — pure logic (Phase 14.2.2) ───────
//
// Deterministic, framework-free rules that make the 14.2.1 profile foundation
// operational: role→profession resolution, field/credential validation, duplicate
// -license detection, and the STABLE media-path convention used for safe
// replace/delete. No React, no Supabase, no I/O — every branch is unit-testable.
//
// Scope guard: this layer is generic. It imports the Professional Registry and
// the profile types only — never a specialty, Copilot Pack, widget, or workspace
// module. It adds no permissions and touches no RLS.

import type {
  Credential,
  CredentialKind,
  ProfessionalMediaKind,
  ProfessionalProfile,
  ProfessionDefinition,
} from './professions/types'
import { PROFESSIONS, getProfession, professionForRole, isRegisteredProfession } from './professions'
import { isMediaPathOwnedBy } from './professional-profile'

export const CREDENTIAL_KINDS: CredentialKind[] = [
  'medical_license', 'board_certification', 'specialty_certification',
  'fellowship', 'professional_membership', 'cme', 'hospital_privilege', 'diploma',
]

// ── Role → Profession resolution (Role Integration) ────────────────
// Every authenticated user resolves: RBAC role → profession → profile. The stored
// profession wins when valid; otherwise it is derived from the role. Never throws.
export function resolveProfession(
  profile: Pick<ProfessionalProfile, 'profession'> | null | undefined,
  role: string | null | undefined,
): ProfessionDefinition {
  if (profile?.profession && isRegisteredProfession(profile.profession)) {
    return getProfession(profile.profession)
  }
  return professionForRole(role)
}

/** Professions a user may self-select: those mapping to their EXISTING RBAC role.
 *  (e.g. a `nurse` role → [nurse, midwife]). Empty when the role has no clinical
 *  profession (admin/super_admin) — the editor then shows the resolved one read-only. */
export function selectableProfessions(role: string | null | undefined): ProfessionDefinition[] {
  return PROFESSIONS.filter(p => p.role === role)
}

// ── Identity field validation ──────────────────────────────────────
export type FieldErrors = Record<string, string>

// Language tag: ISO 639 (2–3 letters) with an optional region/script subtag.
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i

export interface IdentityInput {
  displayName?: string | null
  yearsExperience?: number | string | null
  languages?: string[]
}

/** Validate the free-form identity fields. Returns {} when valid. */
export function validateIdentity(input: IdentityInput): FieldErrors {
  const errors: FieldErrors = {}

  const name = (input.displayName ?? '').trim()
  if (name && (name.length < 2 || name.length > 80)) errors.displayName = 'invalid_display_name'

  if (input.yearsExperience !== null && input.yearsExperience !== undefined && input.yearsExperience !== '') {
    const y = Number(input.yearsExperience)
    if (!Number.isFinite(y) || !Number.isInteger(y) || y < 0 || y > 70) errors.yearsExperience = 'invalid_years'
  }

  const langs = input.languages ?? []
  if (langs.length > 12) errors.languages = 'too_many_languages'
  else if (langs.some(l => !LANG_RE.test(String(l).trim()))) errors.languages = 'invalid_language'
  else if (new Set(langs.map(l => l.toLowerCase())).size !== langs.length) errors.languages = 'duplicate_language'

  return errors
}

/** Normalise a raw language entry to a lowercase primary subtag; '' if invalid. */
export function normalizeLanguage(raw: string): string {
  const t = String(raw ?? '').trim()
  return LANG_RE.test(t) ? t.toLowerCase() : ''
}

// ── Credential validation ──────────────────────────────────────────
// Kinds that are meaningless without an identifying number.
const REQUIRES_IDENTIFIER: CredentialKind[] = ['medical_license']

/** Validate a single credential. Returns {} when valid. */
export function validateCredential(c: Credential | null | undefined): FieldErrors {
  const errors: FieldErrors = {}
  if (!c || !CREDENTIAL_KINDS.includes(c.kind)) { errors.kind = 'invalid_kind'; return errors }

  if (REQUIRES_IDENTIFIER.includes(c.kind) && !nonEmpty(c.identifier)) {
    errors.identifier = 'identifier_required'
  }

  const issued = parseDate(c.issuedAt)
  const expires = parseDate(c.expiresAt)
  if (c.issuedAt && !issued) errors.issuedAt = 'invalid_date'
  if (c.expiresAt && !expires) errors.expiresAt = 'invalid_date'
  if (issued && expires && issued.getTime() > expires.getTime()) errors.expiresAt = 'expiry_before_issue'

  if (c.kind === 'cme' && c.cmeCredits !== null && c.cmeCredits !== undefined) {
    const n = Number(c.cmeCredits)
    if (!Number.isFinite(n) || n < 0) errors.cmeCredits = 'invalid_credits'
  }
  return errors
}

/** Validate every credential; returns a map of index → field errors (only invalid). */
export function validateCredentials(creds: Credential[] | null | undefined): Record<number, FieldErrors> {
  const out: Record<number, FieldErrors> = {}
  if (!Array.isArray(creds)) return out
  creds.forEach((c, i) => {
    const e = validateCredential(c)
    if (Object.keys(e).length) out[i] = e
  })
  return out
}

// ── Duplicate-license detection ────────────────────────────────────
export function normalizeLicenseNumber(v?: string | null): string {
  // Treat whitespace and hyphens as cosmetic separators so "SN 42", "SN-42" and
  // "sn42" are detected as the SAME license. Two replaces (not one char class) —
  // a combined class has historically mishandled the hyphen.
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/-+/g, '')
}

/** License numbers that appear more than once WITHIN one profile's credentials. */
export function duplicateLicenseNumbers(creds: Credential[] | null | undefined): string[] {
  if (!Array.isArray(creds)) return []
  const counts = new Map<string, number>()
  for (const c of creds) {
    if (c?.kind !== 'medical_license') continue
    const n = normalizeLicenseNumber(c.identifier)
    if (!n) continue
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k)
}

/** Would `candidate` collide with a license already registered elsewhere in the
 *  clinic? `existingClinicLicenses` is whatever the caller can read under RLS
 *  (admins see clinic rows; a normal user sees only their own → best-effort). */
export function licenseConflictsInClinic(
  candidate: string | null | undefined,
  existingClinicLicenses: (string | null | undefined)[],
): boolean {
  const n = normalizeLicenseNumber(candidate)
  if (!n) return false
  return existingClinicLicenses.map(normalizeLicenseNumber).includes(n)
}

/** Extract every medical-license number from a set of profiles (for clinic checks). */
export function licenseNumbersFrom(profiles: { credentials?: Credential[] }[]): string[] {
  const out: string[] = []
  for (const p of profiles) {
    for (const c of p.credentials ?? []) {
      if (c?.kind === 'medical_license') {
        const n = normalizeLicenseNumber(c.identifier)
        if (n) out.push(n)
      }
    }
  }
  return out
}

// ── Stable media path (safe replace / delete) ──────────────────────
// A single canonical object per (clinic, user, kind): {clinic}/{user}/{kind}.
// Because the path is STABLE (independent of the source filename), re-uploading
// overwrites the same object (safe replacement, no orphans) and deletion targets
// exactly one object. Mirrors — and is enforced by — the 038 storage RLS
// (folder[1]=clinic, folder[2]=user).
export function professionalMediaPath(
  clinicId: string,
  userId: string,
  kind: ProfessionalMediaKind,
): string {
  return `${clinicId}/${userId}/${kind}`
}

/** Defence-in-depth: only ever act on a media path that is the caller's own. */
export function assertOwnMediaPath(path: string, clinicId: string, userId: string): boolean {
  return isMediaPathOwnedBy(path, clinicId, userId)
}

// ── Fallback avatar (initials) ─────────────────────────────────────
/** Up to two uppercase initials from a name, for the fallback avatar. */
export function initialsOf(name?: string | null): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

// ── helpers ─────────────────────────────────────────────────────────
function nonEmpty(v?: string | null): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
function parseDate(v?: string | null): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

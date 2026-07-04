// ── Specialty selection — pure logic (Phase 14.2.3) ────────────────
//
// Deterministic, framework-free rules connecting the Professional Registry to
// the Clinical Specialty Registry:
//
//   Profession → Primary Specialty (exactly one)
//              → Secondary Specialties (unlimited)
//              → Sub-specialties (unlimited, parent must be selected)
//
// Profession compatibility is DATA (each specialty's defaultProfessions) —
// it never grants or removes anything: RBAC roles, RLS and permissions are
// completely untouched by specialty selection. No React, no DB client, no I/O.

import type { ProfessionId } from '@/lib/professions/types'
import { getProfession } from '@/lib/professions'
import {
  SPECIALTY_TAXONOMY,
  getClinicalSpecialty,
  isRegisteredClinicalSpecialty,
  parentOfSubSpecialty,
  type ClinicalSpecialty,
  type SubSpecialtyDef,
} from './taxonomy'

// ── Selection shape (mirrors professional_profiles storage) ────────
export interface SpecialtySelection {
  primary: string | null      // professional_profiles.primary_specialty (039)
  secondaries: string[]       // professional_profiles.secondary_specialties (038, JSONB)
  subs: string[]              // professional_profiles.sub_specialties (038, JSONB)
}

export const EMPTY_SELECTION: SpecialtySelection = { primary: null, secondaries: [], subs: [] }

// ── Profession compatibility ────────────────────────────────────────
/** Active specialties this profession may practice. Pure data lookup. */
export function allowedSpecialtiesForProfession(professionId?: string | null): ClinicalSpecialty[] {
  if (!professionId) return []
  return SPECIALTY_TAXONOMY.filter(
    s => s.status === 'active' && s.defaultProfessions.includes(professionId as ProfessionId),
  )
}

export function isSpecialtyAllowedForProfession(professionId?: string | null, specialtyId?: string | null): boolean {
  if (!specialtyId) return false
  return allowedSpecialtiesForProfession(professionId).some(s => s.id === specialtyId)
}

// ── Validation ──────────────────────────────────────────────────────
// Error codes (i18n happens at the UI layer, later phases):
//   profession_no_specialties | primary_required | primary_not_registered |
//   primary_not_allowed | secondary_not_registered | secondary_not_allowed |
//   secondary_equals_primary | duplicate_secondary | sub_not_registered |
//   sub_parent_missing | duplicate_sub
export type SelectionErrors = Record<string, string>

export function validateSpecialtySelection(
  professionId: string | null | undefined,
  sel: SpecialtySelection,
): SelectionErrors {
  const errors: SelectionErrors = {}
  const profession = getProfession(professionId)
  const hasAny = !!sel.primary || sel.secondaries.length > 0 || sel.subs.length > 0

  // A profession that doesn't practice specialties must carry an empty selection.
  if (!profession.usesSpecialties) {
    if (hasAny) errors.profession = 'profession_no_specialties'
    return errors
  }

  // Primary: exactly one, required as soon as anything is selected.
  if (!sel.primary) {
    if (hasAny) errors.primary = 'primary_required'
  } else if (!isRegisteredClinicalSpecialty(sel.primary)) {
    errors.primary = 'primary_not_registered'
  } else if (!isSpecialtyAllowedForProfession(profession.id, sel.primary)) {
    errors.primary = 'primary_not_allowed'
  }

  // Secondaries: unlimited, registered, allowed, unique, distinct from primary.
  const seen = new Set<string>()
  for (const id of sel.secondaries) {
    if (!isRegisteredClinicalSpecialty(id)) { errors.secondaries = 'secondary_not_registered'; break }
    if (!isSpecialtyAllowedForProfession(profession.id, id)) { errors.secondaries = 'secondary_not_allowed'; break }
    if (id === sel.primary) { errors.secondaries = 'secondary_equals_primary'; break }
    if (seen.has(id)) { errors.secondaries = 'duplicate_secondary'; break }
    seen.add(id)
  }

  // Subs: unlimited, registered, unique, parent must be primary or a secondary.
  const selected = new Set([sel.primary, ...sel.secondaries].filter(Boolean) as string[])
  const seenSubs = new Set<string>()
  for (const id of sel.subs) {
    const parent = parentOfSubSpecialty(id)
    if (!parent) { errors.subs = 'sub_not_registered'; break }
    if (!selected.has(parent.id)) { errors.subs = 'sub_parent_missing'; break }
    if (seenSubs.has(id)) { errors.subs = 'duplicate_sub'; break }
    seenSubs.add(id)
  }

  return errors
}

/** Drop unknown/duplicate/orphaned entries — the tolerant read-side companion of
 *  validateSpecialtySelection (which is the strict write-side gate). */
export function normalizeSelection(
  professionId: string | null | undefined,
  sel: Partial<SpecialtySelection> | null | undefined,
): SpecialtySelection {
  const profession = getProfession(professionId)
  if (!profession.usesSpecialties || !sel) return { ...EMPTY_SELECTION }

  const primary = isSpecialtyAllowedForProfession(profession.id, sel.primary ?? null) ? sel.primary! : null
  const secondaries = [...new Set(sel.secondaries ?? [])]
    .filter(id => id !== primary && isSpecialtyAllowedForProfession(profession.id, id))
  const selected = new Set([primary, ...secondaries].filter(Boolean) as string[])
  const subs = [...new Set(sel.subs ?? [])]
    .filter(id => { const p = parentOfSubSpecialty(id); return !!p && selected.has(p.id) })

  return { primary, secondaries, subs }
}

// ── Resolution (the identity chain) ─────────────────────────────────
export interface ResolvedSubSpecialty {
  def: SubSpecialtyDef
  parent: ClinicalSpecialty
}

export interface ResolvedSpecialties {
  primary: ClinicalSpecialty | null
  secondaries: ClinicalSpecialty[]
  subs: ResolvedSubSpecialty[]
}

/** Resolve stored ids → registry objects. Unknown ids are silently dropped, so a
 *  profile written against a NEWER taxonomy (or a missing migration) degrades
 *  cleanly instead of failing. Never throws. */
export function resolveSpecialtySelection(
  profile: { primarySpecialty?: string | null; secondarySpecialties?: string[]; subSpecialties?: string[] } | null | undefined,
): ResolvedSpecialties {
  if (!profile) return { primary: null, secondaries: [], subs: [] }
  const primary = getClinicalSpecialty(profile.primarySpecialty)
  const secondaries = (profile.secondarySpecialties ?? [])
    .map(getClinicalSpecialty)
    .filter((s): s is ClinicalSpecialty => !!s)
  const subs: ResolvedSubSpecialty[] = []
  for (const id of profile.subSpecialties ?? []) {
    const parent = parentOfSubSpecialty(id)
    const def = parent?.subSpecialties.find(x => x.id === id)
    if (parent && def) subs.push({ def, parent })
  }
  return { primary, secondaries, subs }
}

// ── Enterprise Identity — Model & rules (Phase 42) ───────────────
//
// Pure, deterministic identity logic that permanently separates the three
// concepts CHMS conflated in the admin UI:
//
//   1. ROLE     — drives Enterprise Authorization (`can()`). NEVER derived here.
//   2. DEPARTMENT — organizational metadata only. NEVER a permission.
//   3. PRIMARY SPECIALTY — doctors only; activates exactly ONE specialty workspace.
//
// This module NEVER imports the authorization engine and NEVER influences `can()`
// or RLS. It reuses the clinical specialty TAXONOMY as the single source of truth
// (no duplicated specialty definitions).

import {
  SPECIALTY_TAXONOMY,
  isRegisteredClinicalSpecialty,
  type ClinicalSpecialty,
} from '@/lib/specialties/taxonomy'
import type { Role } from '@/types/database'

// ── Which roles carry a clinical specialty ───────────────────────
/** A primary specialty applies to DOCTORS only. Nurses, technicians, cashiers,
 *  receptionists, admins never carry one. */
export function requiresSpecialty(role?: Role | string | null): boolean {
  return role === 'doctor'
}
export const canHaveSpecialty = requiresSpecialty

// ── Doctor-practicable specialties (reuses the taxonomy) ──────────
/** The specialties a doctor may hold. Sourced from the taxonomy's own
 *  profession-compatibility data — no separate/duplicated list. */
export function specialtyOptions(): ClinicalSpecialty[] {
  return SPECIALTY_TAXONOMY.filter(
    s => s.status === 'active' && s.defaultProfessions.some(p => p === 'doctor'),
  )
}
export function isDoctorSpecialty(id?: string | null): boolean {
  return !!id && specialtyOptions().some(s => s.id === id)
}

// ── Cleaning & validation ────────────────────────────────────────
export interface IdentityInput {
  role: Role | string | null | undefined
  department?: string | null
  primary_specialty?: string | null
}

/** Enforce the identity rules on write: a non-doctor NEVER keeps a specialty; a
 *  blank value becomes null. Returns only the identity metadata — role,
 *  permissions and authentication are never touched. */
export function normalizeIdentity(
  input: IdentityInput,
): { department: string | null; primary_specialty: string | null } {
  const department = input.department && input.department.trim() ? input.department : null
  const primary_specialty =
    requiresSpecialty(input.role) && input.primary_specialty && input.primary_specialty.trim()
      ? input.primary_specialty
      : null
  return { department, primary_specialty }
}

export type IdentityErrorCode =
  | 'specialty_required'
  | 'specialty_not_registered'
  | 'specialty_forbidden_for_role'

/** Validate an identity selection. Doctors must have a registered specialty;
 *  non-doctors must not have one. */
export function validateIdentity(input: IdentityInput): { primary_specialty?: IdentityErrorCode } {
  const errors: { primary_specialty?: IdentityErrorCode } = {}
  if (requiresSpecialty(input.role)) {
    if (!input.primary_specialty) errors.primary_specialty = 'specialty_required'
    else if (!isRegisteredClinicalSpecialty(input.primary_specialty)) errors.primary_specialty = 'specialty_not_registered'
  } else if (input.primary_specialty) {
    errors.primary_specialty = 'specialty_forbidden_for_role'
  }
  return errors
}

// ── Copilot / workspace activation ───────────────────────────────
/** The single specialty workspace/copilot a user activates — or null. Only a
 *  DOCTOR with a registered primary specialty activates one, and it is always
 *  exactly that one specialty. Department and role never activate a workspace. */
export function activeSpecialtyWorkspace(
  role?: Role | string | null,
  primary_specialty?: string | null,
): string | null {
  if (!requiresSpecialty(role)) return null
  if (!primary_specialty || !isRegisteredClinicalSpecialty(primary_specialty)) return null
  return primary_specialty
}

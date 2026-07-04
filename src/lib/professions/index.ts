// ── Professional Registry (Layer 0 — the profession) ───────────────
//
// The single plug-in point for professions, mirroring SPECIALTIES, ALL_TOOLS and
// SETTINGS_SECTIONS: a future profession is ONE entry appended here — no page,
// resolver, or core change. This registry is intentionally generic — it maps each
// profession to an EXISTING RBAC role and knows nothing about any specific
// specialty or Copilot Pack (basePacks stay empty in this foundation phase).

import type { ProfessionDefinition, ProfessionId } from './types'

export const DEFAULT_PROFESSION: ProfessionId = 'doctor'

// 9 initial professions. `role` is always an EXISTING platform role — professions
// never introduce a role or RLS policy. `usesSpecialties` is true only where a
// specialty hierarchy is clinically meaningful.
export const PROFESSIONS: ProfessionDefinition[] = [
  {
    id: 'doctor',
    labelKey: 'profession_doctor',
    icon: 'Stethoscope',
    role: 'doctor',
    usesSpecialties: true,
    credentialKinds: ['medical_license', 'board_certification', 'specialty_certification', 'fellowship', 'professional_membership', 'cme', 'hospital_privilege', 'diploma'],
    basePacks: [],
  },
  {
    id: 'nurse',
    labelKey: 'profession_nurse',
    icon: 'HeartPulse',
    role: 'nurse',
    usesSpecialties: true,
    credentialKinds: ['medical_license', 'specialty_certification', 'professional_membership', 'cme', 'diploma'],
    basePacks: [],
  },
  {
    // Midwife maps to the existing `nurse` role (no new RLS role) — profession is
    // a presentation/identity layer over the role; permissions never change.
    id: 'midwife',
    labelKey: 'profession_midwife',
    icon: 'Baby',
    role: 'nurse',
    usesSpecialties: true,
    credentialKinds: ['medical_license', 'specialty_certification', 'professional_membership', 'cme', 'diploma'],
    basePacks: [],
  },
  {
    id: 'pharmacist',
    labelKey: 'profession_pharmacist',
    icon: 'Pill',
    role: 'pharmacist',
    usesSpecialties: false,
    credentialKinds: ['medical_license', 'professional_membership', 'cme', 'diploma'],
    basePacks: [],
  },
  {
    id: 'lab_technologist',
    labelKey: 'profession_lab_technologist',
    icon: 'FlaskConical',
    role: 'lab_technician',
    usesSpecialties: false,
    credentialKinds: ['specialty_certification', 'professional_membership', 'cme', 'diploma'],
    basePacks: [],
  },
  {
    // Radiographer reuses an existing clinical/diagnostic role until a dedicated
    // role is warranted. No new role, no RLS change.
    id: 'radiographer',
    labelKey: 'profession_radiographer',
    icon: 'ScanLine',
    role: 'lab_technician',
    usesSpecialties: false,
    credentialKinds: ['specialty_certification', 'professional_membership', 'cme', 'diploma'],
    basePacks: [],
  },
  {
    id: 'receptionist',
    labelKey: 'profession_receptionist',
    icon: 'ConciergeBell',
    role: 'receptionist',
    usesSpecialties: false,
    credentialKinds: ['diploma'],
    basePacks: [],
  },
  {
    id: 'cashier',
    labelKey: 'profession_cashier',
    icon: 'Banknote',
    role: 'cashier',
    usesSpecialties: false,
    credentialKinds: ['diploma'],
    basePacks: [],
  },
  {
    id: 'administrator',
    labelKey: 'profession_administrator',
    icon: 'Building2',
    role: 'admin',
    usesSpecialties: false,
    credentialKinds: ['diploma'],
    basePacks: [],
  },
  // ← future professions plug in here (dentist, physiotherapist, psychologist…)
]

/** Resolve a profession by id, falling back to `doctor` (never throws). */
export function getProfession(id?: string | null): ProfessionDefinition {
  return PROFESSIONS.find(p => p.id === id) ?? PROFESSIONS[0]
}

export function isRegisteredProfession(id?: string | null): boolean {
  return !!id && PROFESSIONS.some(p => p.id === id)
}

/** First profession whose RBAC role matches — a safe default when only the role
 *  is known (e.g. a legacy user with no profile yet). Never throws. */
export function professionForRole(role?: string | null): ProfessionDefinition {
  return PROFESSIONS.find(p => p.role === role) ?? PROFESSIONS[0]
}

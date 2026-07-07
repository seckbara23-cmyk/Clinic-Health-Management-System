// ── Clinical Specialty Registry — taxonomy (Phase 14.2.3) ──────────
//
// The authoritative, controlled vocabulary of clinical expertise for the
// Healthcare OS: primary specialties, secondary specialties and sub-specialties.
// Senegal / West-Africa first; international mapping comes later (frozen §5).
//
// HARD BOUNDARY (frozen architecture): Specialty ≠ Copilot Pack.
//   A specialty identifies WHAT a professional practices (clinical expertise).
//   A Copilot Pack provides workspace CAPABILITIES. They are never coupled:
//   this module imports NO pack, workspace, widget, template or AI code, and
//   `futurePackIds` is a reserved, ALWAYS-EMPTY list of bare strings so later
//   phases can target packs without this registry ever importing them.
//
// This is a plug-in registry in the house style (PROFESSIONS, ALL_TOOLS,
// SETTINGS_SECTIONS): a future specialty or sub-specialty is ONE entry appended
// here — no core change anywhere. Labels/descriptions are i18n keys resolved in
// the `specialties` message namespace (fr + en today; more languages later).
//
// NOTE: distinct from src/lib/specialties/index.ts (the Phase 14.1 workspace
// SpecialtyDefinition registry, which evolves into Copilot Packs in a later
// phase). This file is pure clinical taxonomy — no capabilities.

import type { ProfessionId } from '@/lib/professions/types'

// ── Types ───────────────────────────────────────────────────────────
export type ClinicalSpecialtyCategory =
  | 'primary_care' | 'medical' | 'surgical' | 'maternal_child' | 'mental_health'
  | 'diagnostic' | 'pharmacy' | 'nursing' | 'allied_health' | 'dental'

export type ClinicalSpecialtyId =
  | 'general_practice' | 'family_medicine' | 'internal_medicine' | 'pediatrics'
  | 'obgyn' | 'midwifery' | 'cardiology' | 'dermatology' | 'neurology'
  | 'psychiatry' | 'general_surgery' | 'orthopedics' | 'ent' | 'ophthalmology'
  | 'emergency_medicine' | 'anesthesiology' | 'radiology' | 'laboratory_medicine'
  | 'oncology' | 'urology' | 'nephrology' | 'pulmonology' | 'dentistry' | 'nutrition'
  | 'physiotherapy' | 'pharmacy' | 'nursing'

export interface SubSpecialtyDef {
  id: string
  labelKey: string
}

export interface ClinicalSpecialty {
  id: ClinicalSpecialtyId
  labelKey: string
  descKey: string
  category: ClinicalSpecialtyCategory
  usesSubspecialties: boolean
  subSpecialties: SubSpecialtyDef[]
  /** Professions that may practice this specialty. Compatibility DATA only —
   *  never permissions: RBAC and RLS are untouched by specialty selection. */
  defaultProfessions: ProfessionId[]
  /** Reserved for later phases. ALWAYS empty in 14.2.3 (Specialty ≠ Pack). */
  futurePackIds: string[]
  status: 'active' | 'deprecated'
  version: number
}

const sub = (id: string): SubSpecialtyDef => ({ id, labelKey: `sub_${id}` })

// ── The taxonomy ────────────────────────────────────────────────────
// West-Africa-focused starter set. Extending = append an entry (+ i18n keys).
export const SPECIALTY_TAXONOMY: ClinicalSpecialty[] = [
  {
    id: 'general_practice', labelKey: 'sp_general_practice', descKey: 'spd_general_practice',
    category: 'primary_care', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'family_medicine', labelKey: 'sp_family_medicine', descKey: 'spd_family_medicine',
    category: 'primary_care', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'internal_medicine', labelKey: 'sp_internal_medicine', descKey: 'spd_internal_medicine',
    category: 'medical', usesSubspecialties: true,
    subSpecialties: [sub('diabetology'), sub('infectious_diseases'), sub('gastroenterology'), sub('pneumology'), sub('rheumatology')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'pediatrics', labelKey: 'sp_pediatrics', descKey: 'spd_pediatrics',
    category: 'maternal_child', usesSubspecialties: true,
    subSpecialties: [sub('neonatology'), sub('pediatric_infectious_diseases'), sub('adolescent_medicine')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'obgyn', labelKey: 'sp_obgyn', descKey: 'spd_obgyn',
    category: 'maternal_child', usesSubspecialties: true,
    subSpecialties: [sub('high_risk_obstetrics'), sub('reproductive_medicine'), sub('gynecologic_surgery'), sub('obstetric_ultrasound')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'midwifery', labelKey: 'sp_midwifery', descKey: 'spd_midwifery',
    category: 'maternal_child', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['midwife'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'cardiology', labelKey: 'sp_cardiology', descKey: 'spd_cardiology',
    category: 'medical', usesSubspecialties: true,
    subSpecialties: [sub('interventional_cardiology'), sub('echocardiography')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'dermatology', labelKey: 'sp_dermatology', descKey: 'spd_dermatology',
    category: 'medical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'neurology', labelKey: 'sp_neurology', descKey: 'spd_neurology',
    category: 'medical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'psychiatry', labelKey: 'sp_psychiatry', descKey: 'spd_psychiatry',
    category: 'mental_health', usesSubspecialties: true,
    subSpecialties: [sub('child_adolescent_psychiatry'), sub('addiction_medicine')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'general_surgery', labelKey: 'sp_general_surgery', descKey: 'spd_general_surgery',
    category: 'surgical', usesSubspecialties: true,
    subSpecialties: [sub('visceral_surgery'), sub('pediatric_surgery'), sub('trauma_surgery')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'orthopedics', labelKey: 'sp_orthopedics', descKey: 'spd_orthopedics',
    category: 'surgical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'ent', labelKey: 'sp_ent', descKey: 'spd_ent',
    category: 'surgical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'ophthalmology', labelKey: 'sp_ophthalmology', descKey: 'spd_ophthalmology',
    category: 'surgical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'emergency_medicine', labelKey: 'sp_emergency_medicine', descKey: 'spd_emergency_medicine',
    category: 'medical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'anesthesiology', labelKey: 'sp_anesthesiology', descKey: 'spd_anesthesiology',
    category: 'surgical', usesSubspecialties: true,
    subSpecialties: [sub('intensive_care')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'radiology', labelKey: 'sp_radiology', descKey: 'spd_radiology',
    category: 'diagnostic', usesSubspecialties: true,
    subSpecialties: [sub('ultrasound_imaging'), sub('cross_sectional_imaging'), sub('interventional_radiology')],
    defaultProfessions: ['doctor', 'radiographer'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'laboratory_medicine', labelKey: 'sp_laboratory_medicine', descKey: 'spd_laboratory_medicine',
    category: 'diagnostic', usesSubspecialties: true,
    subSpecialties: [sub('medical_microbiology'), sub('hematology_lab'), sub('clinical_biochemistry'), sub('parasitology')],
    defaultProfessions: ['doctor', 'lab_technologist'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'oncology', labelKey: 'sp_oncology', descKey: 'spd_oncology',
    category: 'medical', usesSubspecialties: true,
    subSpecialties: [sub('medical_oncology'), sub('radiation_oncology')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'urology', labelKey: 'sp_urology', descKey: 'spd_urology',
    category: 'surgical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'nephrology', labelKey: 'sp_nephrology', descKey: 'spd_nephrology',
    category: 'medical', usesSubspecialties: true,
    subSpecialties: [sub('hemodialysis')],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'pulmonology', labelKey: 'sp_pulmonology', descKey: 'spd_pulmonology',
    category: 'medical', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'dentistry', labelKey: 'sp_dentistry', descKey: 'spd_dentistry',
    category: 'dental', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'nutrition', labelKey: 'sp_nutrition', descKey: 'spd_nutrition',
    category: 'allied_health', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor', 'nurse'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'physiotherapy', labelKey: 'sp_physiotherapy', descKey: 'spd_physiotherapy',
    category: 'allied_health', usesSubspecialties: false, subSpecialties: [],
    defaultProfessions: ['doctor'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'pharmacy', labelKey: 'sp_pharmacy', descKey: 'spd_pharmacy',
    category: 'pharmacy', usesSubspecialties: true,
    subSpecialties: [sub('clinical_pharmacy'), sub('hospital_pharmacy'), sub('pharmacovigilance')],
    defaultProfessions: ['pharmacist'], futurePackIds: [], status: 'active', version: 1,
  },
  {
    id: 'nursing', labelKey: 'sp_nursing', descKey: 'spd_nursing',
    category: 'nursing', usesSubspecialties: true,
    subSpecialties: [sub('community_health_nursing'), sub('pediatric_nursing'), sub('surgical_nursing'), sub('anesthesia_nursing')],
    defaultProfessions: ['nurse', 'midwife'], futurePackIds: [], status: 'active', version: 1,
  },
  // ← future specialties / sub-specialties plug in here (registry entry + i18n keys only)
]

// ── Lookups (never throw) ───────────────────────────────────────────
export function getClinicalSpecialty(id?: string | null): ClinicalSpecialty | null {
  return SPECIALTY_TAXONOMY.find(s => s.id === id) ?? null
}

export function isRegisteredClinicalSpecialty(id?: string | null): boolean {
  return !!id && SPECIALTY_TAXONOMY.some(s => s.id === id)
}

export function subSpecialtiesOf(specialtyId?: string | null): SubSpecialtyDef[] {
  return getClinicalSpecialty(specialtyId)?.subSpecialties ?? []
}

/** The specialty a sub-specialty belongs to (null for an unknown sub id). */
export function parentOfSubSpecialty(subId?: string | null): ClinicalSpecialty | null {
  if (!subId) return null
  return SPECIALTY_TAXONOMY.find(s => s.subSpecialties.some(x => x.id === subId)) ?? null
}

export function specialtiesByCategory(category: ClinicalSpecialtyCategory): ClinicalSpecialty[] {
  return SPECIALTY_TAXONOMY.filter(s => s.category === category && s.status === 'active')
}

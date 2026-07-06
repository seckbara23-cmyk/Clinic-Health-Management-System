// ── Clinical Copilot Pack Registry (Phase 14.2.4) ──────────────────
//
// The single source of truth for every Clinical Copilot Pack — the foundation
// of the future CHMS Marketplace. Registry-driven: a future pack is ONE entry
// appended here (+ i18n keys), never a change to core application code.
//
// METADATA ONLY. These entries declare capabilities; they implement none. All
// `future*` lists are EMPTY in 14.2.4 — no widgets, templates, AI, workflows,
// reports, timeline, quick actions, print forms or pathways exist yet.

import type { CopilotPackManifest } from './types'

/** Platform version these packs target (for min-version negotiation). */
export const PLATFORM_VERSION = '14.2.4'

// Shared empty capability contribution (metadata-only phase).
const NO_CAPABILITIES = {
  futureAiToolIds: [] as string[],
  futureWidgetIds: [] as string[],
  futureTemplateIds: [] as string[],
  futureReportIds: [] as string[],
  futureQuickActionIds: [] as string[],
  futureTimelineEventTypes: [] as string[],
  futureDocHelperIds: [] as string[],
  futurePrintFormIds: [] as string[],
  futurePathwayIds: [] as string[],
}

const BASE = {
  version: '1.0.0',
  publisher: 'chms',
  status: 'active' as const,
  minPlatformVersion: '14.2.0',
  dependsOn: [],
  optionalDependsOn: [],
  schemaVersion: 1,
  ...NO_CAPABILITIES,
}

const PROFICIENCY = ['basic', 'advanced', 'expert'] as const
const WORKFLOW = ['observer', 'operator', 'reviewer', 'trainer'] as const

export const COPILOT_PACKS: CopilotPackManifest[] = [
  {
    // Phase 16 — the FIRST production Copilot Pack. Unlike the placeholder cores
    // below, its capability lists reference REAL registered capabilities (widgets,
    // quick actions, templates, AI tools, doc helpers) — all read-only,
    // operational, deterministic. Referential integrity is guard-tested.
    ...BASE, id: 'general_practice.core', code: 'GP-CORE',
    labelKey: 'pk_general_practice_core', descKey: 'pkd_general_practice_core',
    category: 'clinical', requiredProfessions: ['doctor'],
    supportedSpecialties: ['general_practice', 'family_medicine'], capabilityLevels: [...PROFICIENCY],
    futureWidgetIds: ['ai_brief', 'kpis', 'today_queue', 'quick_actions'],
    futureQuickActionIds: ['new_consultation', 'new_prescription', 'order_lab', 'schedule_appointment', 'new_invoice'],
    futureTemplateIds: ['gp_consultation', 'gp_acute', 'gp_chronic_followup', 'gp_hypertension', 'gp_diabetes', 'gp_annual_physical', 'gp_minor_illness'],
    futureAiToolIds: ['get_patient_consultations', 'get_patient_prescriptions', 'get_patient_lab_results', 'get_patient_outstanding', 'get_patient_followups', 'get_today_queue', 'get_pending_lab_orders', 'get_critical_lab_results', 'get_unpaid_invoices'],
    futureDocHelperIds: ['consultation_completeness', 'documentation_quality', 'preventive_reminders', 'medication_review', 'follow_up_assistant', 'operational_timeline'],
    futureTimelineEventTypes: ['consultation', 'appointment', 'prescription', 'lab', 'invoice', 'dispensing'],
  },
  {
    // Phase 17 — the SECOND real Copilot Pack (extends the GP reference pattern).
    ...BASE, id: 'pediatrics.core', code: 'PEDS-CORE',
    labelKey: 'pk_pediatrics_core', descKey: 'pkd_pediatrics_core',
    category: 'clinical', requiredProfessions: ['doctor'],
    supportedSpecialties: ['pediatrics'], capabilityLevels: [...PROFICIENCY],
    futureWidgetIds: ['ai_brief', 'kpis', 'today_queue', 'quick_actions'],
    futureQuickActionIds: ['new_consultation', 'new_prescription', 'order_lab', 'schedule_appointment', 'new_invoice'],
    futureTemplateIds: ['peds_well_child', 'peds_sick_visit', 'peds_vaccination_visit', 'peds_nutrition_followup', 'peds_school_certificate', 'peds_newborn_followup'],
    futureAiToolIds: ['get_patient_consultations', 'get_patient_prescriptions', 'get_patient_lab_results', 'get_patient_outstanding', 'get_patient_followups'],
    futureDocHelperIds: ['pediatric_brief', 'growth_monitoring', 'vaccination_tracker', 'developmental_reminders', 'pediatric_completeness', 'pediatric_medication_review'],
    futureTimelineEventTypes: ['consultation', 'appointment', 'prescription', 'lab', 'invoice', 'dispensing'],
  },
  {
    ...BASE, id: 'obstetrics.core', code: 'OB-CORE',
    labelKey: 'pk_obstetrics_core', descKey: 'pkd_obstetrics_core',
    category: 'clinical', requiredProfessions: ['doctor', 'midwife'],
    supportedSpecialties: ['obgyn', 'midwifery'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'cardiology.core', code: 'CARDIO-CORE',
    labelKey: 'pk_cardiology_core', descKey: 'pkd_cardiology_core',
    category: 'clinical', requiredProfessions: ['doctor'],
    supportedSpecialties: ['cardiology'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'ent.core', code: 'ORL-CORE',
    labelKey: 'pk_ent_core', descKey: 'pkd_ent_core',
    category: 'clinical', requiredProfessions: ['doctor'],
    supportedSpecialties: ['ent'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'radiology.core', code: 'RADIO-CORE',
    labelKey: 'pk_radiology_core', descKey: 'pkd_radiology_core',
    category: 'diagnostic', requiredProfessions: ['doctor', 'radiographer'],
    supportedSpecialties: ['radiology'], capabilityLevels: [...WORKFLOW],
  },
  {
    ...BASE, id: 'pharmacy.core', code: 'PHARMA-CORE',
    labelKey: 'pk_pharmacy_core', descKey: 'pkd_pharmacy_core',
    category: 'support', requiredProfessions: ['pharmacist'],
    supportedSpecialties: ['pharmacy'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'laboratory.core', code: 'LAB-CORE',
    labelKey: 'pk_laboratory_core', descKey: 'pkd_laboratory_core',
    category: 'diagnostic', requiredProfessions: ['doctor', 'lab_technologist'],
    supportedSpecialties: ['laboratory_medicine'], capabilityLevels: [...WORKFLOW],
  },
  {
    ...BASE, id: 'emergency.core', code: 'EMERG-CORE',
    labelKey: 'pk_emergency_core', descKey: 'pkd_emergency_core',
    category: 'clinical', requiredProfessions: ['doctor'],
    supportedSpecialties: ['emergency_medicine'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'dentistry.core', code: 'DENT-CORE',
    labelKey: 'pk_dentistry_core', descKey: 'pkd_dentistry_core',
    category: 'clinical', requiredProfessions: ['doctor'],
    supportedSpecialties: ['dentistry'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'nursing.core', code: 'NURSE-CORE',
    labelKey: 'pk_nursing_core', descKey: 'pkd_nursing_core',
    category: 'clinical', requiredProfessions: ['nurse', 'midwife'],
    supportedSpecialties: ['nursing'], capabilityLevels: [...PROFICIENCY],
  },
  {
    ...BASE, id: 'midwifery.core', code: 'MIDWIFE-CORE',
    labelKey: 'pk_midwifery_core', descKey: 'pkd_midwifery_core',
    category: 'clinical', requiredProfessions: ['midwife'],
    supportedSpecialties: ['midwifery'], capabilityLevels: [...PROFICIENCY],
  },
  // ← future Copilot Packs plug in here (registry entry + i18n keys only)
]

// ── Lookups (never throw) ───────────────────────────────────────────
export function getCopilotPack(id?: string | null): CopilotPackManifest | null {
  return COPILOT_PACKS.find(p => p.id === id) ?? null
}

export function isRegisteredPack(id?: string | null): boolean {
  return !!id && COPILOT_PACKS.some(p => p.id === id)
}

export function packsByCategory(category: string): CopilotPackManifest[] {
  return COPILOT_PACKS.filter(p => p.category === category && p.status === 'active')
}

export function activePacks(): CopilotPackManifest[] {
  return COPILOT_PACKS.filter(p => p.status === 'active')
}

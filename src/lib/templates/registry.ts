// ── Consultation-template registry (shared) ───────────────────────
//
// Templates COMPOSE the existing consultation model — they do not fork it.
// Phase 14.1 ships the general SOAP template whose sections map 1:1 onto the
// EXISTING consultation columns, reproducing the Phase 9 consultation editor
// exactly (no schema change). Specialty templates (ANC visit, well-child…) are
// added by their packs and may target clinical_entries (a later step).

import type { ConsultationTemplate } from '@/lib/workspace/types'

// General practice — SOAP. Section ids/order and column mapping intentionally
// match src/app/(dashboard)/consultations/[id]/page.tsx (Phase 9).
const GP_CONSULTATION: ConsultationTemplate = {
  id: 'gp_consultation',
  specialty: 'general_practice',
  noteStyle: 'soap',
  sections: [
    { id: 'chief_complaint', labelKey: 'sectionChiefComplaint', fields: [
      { key: 'chief_complaint', type: 'textarea', labelKey: 'sectionChiefComplaint', target: { store: 'consultation', column: 'chief_complaint' } },
    ] },
    { id: 'hpi', labelKey: 'sectionHPI', fields: [
      { key: 'symptoms', type: 'textarea', labelKey: 'sectionHPI', target: { store: 'consultation', column: 'symptoms' } },
    ] },
    { id: 'exam', labelKey: 'sectionExam', fields: [
      { key: 'notes', type: 'textarea', labelKey: 'sectionExam', target: { store: 'consultation', column: 'notes' } },
    ] },
    { id: 'assessment', labelKey: 'sectionAssessment', fields: [
      { key: 'diagnosis', type: 'textarea', labelKey: 'sectionAssessment', target: { store: 'consultation', column: 'diagnosis' } },
    ] },
    { id: 'plan', labelKey: 'sectionPlan', fields: [
      { key: 'treatment_plan', type: 'textarea', labelKey: 'sectionPlan', target: { store: 'consultation', column: 'treatment_plan' } },
      { key: 'follow_up_date', type: 'date', labelKey: 'labelFollowUp', target: { store: 'consultation', column: 'follow_up_date' } },
    ] },
  ],
}

// ── General Practice Copilot — smart templates (Phase 16) ─────────
//
// Visit-type documentation scaffolds for the first production Copilot. Each
// composes a SUBSET/ordering of the SAME existing consultation columns (no
// schema change, no clinical_entries) and reuses the section labelKeys above —
// templates are documentation guides, they generate NO diagnosis or content.
type Sec = ConsultationTemplate['sections'][number]
const S = {
  cc: (): Sec => ({ id: 'chief_complaint', labelKey: 'sectionChiefComplaint', fields: [{ key: 'chief_complaint', type: 'textarea', labelKey: 'sectionChiefComplaint', target: { store: 'consultation', column: 'chief_complaint' } }] }),
  hpi: (): Sec => ({ id: 'hpi', labelKey: 'sectionHPI', fields: [{ key: 'symptoms', type: 'textarea', labelKey: 'sectionHPI', target: { store: 'consultation', column: 'symptoms' } }] }),
  exam: (): Sec => ({ id: 'exam', labelKey: 'sectionExam', fields: [{ key: 'notes', type: 'textarea', labelKey: 'sectionExam', target: { store: 'consultation', column: 'notes' } }] }),
  assessment: (): Sec => ({ id: 'assessment', labelKey: 'sectionAssessment', fields: [{ key: 'diagnosis', type: 'textarea', labelKey: 'sectionAssessment', target: { store: 'consultation', column: 'diagnosis' } }] }),
  plan: (withFollowUp: boolean): Sec => ({ id: 'plan', labelKey: 'sectionPlan', fields: [
    { key: 'treatment_plan', type: 'textarea', labelKey: 'sectionPlan', target: { store: 'consultation', column: 'treatment_plan' } },
    ...(withFollowUp ? [{ key: 'follow_up_date', type: 'date' as const, labelKey: 'labelFollowUp', target: { store: 'consultation' as const, column: 'follow_up_date' as const } }] : []),
  ] }),
}

function gpTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'general_practice', noteStyle: 'soap', sections }
}

// Ids are registered on the general_practice.core pack (futureTemplateIds).
export const GP_SMART_TEMPLATE_IDS = [
  'gp_acute', 'gp_chronic_followup', 'gp_hypertension', 'gp_diabetes', 'gp_annual_physical', 'gp_minor_illness',
] as const

const GP_SMART_TEMPLATES: ConsultationTemplate[] = [
  gpTemplate('gp_acute', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  gpTemplate('gp_chronic_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  gpTemplate('gp_hypertension', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  gpTemplate('gp_diabetes', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  gpTemplate('gp_annual_physical', [S.hpi(), S.exam(), S.assessment(), S.plan(false)]),
  gpTemplate('gp_minor_illness', [S.cc(), S.exam(), S.assessment(), S.plan(false)]),
]

// ── Pediatrics Copilot — smart templates (Phase 17) ───────────────
// Visit-type scaffolds mapping ONLY to existing consultation columns (no schema
// change). Documentation guides — they generate NO diagnosis or content.
function pedTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'pediatrics', noteStyle: 'soap', sections }
}

export const PEDS_SMART_TEMPLATE_IDS = [
  'peds_well_child', 'peds_sick_visit', 'peds_vaccination_visit',
  'peds_nutrition_followup', 'peds_school_certificate', 'peds_newborn_followup',
] as const

const PEDS_SMART_TEMPLATES: ConsultationTemplate[] = [
  pedTemplate('peds_well_child', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  pedTemplate('peds_sick_visit', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  pedTemplate('peds_vaccination_visit', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pedTemplate('peds_nutrition_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pedTemplate('peds_school_certificate', [S.cc(), S.exam(), S.assessment(), S.plan(false)]),
  pedTemplate('peds_newborn_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Obstetrics & Gynecology Copilot — smart templates (Phase 18) ──
// Visit-type scaffolds mapping ONLY to existing consultation columns. The
// Delivery-summary is a PLACEHOLDER scaffold — no generated findings.
function obgTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'obgyn', noteStyle: 'soap', sections }
}

export const OBGYN_SMART_TEMPLATE_IDS = [
  'obg_anc_visit', 'obg_gyne_consult', 'obg_postpartum', 'obg_family_planning',
  'obg_fertility', 'obg_ultrasound_followup', 'obg_delivery_summary',
] as const

const OBGYN_SMART_TEMPLATES: ConsultationTemplate[] = [
  obgTemplate('obg_anc_visit', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  obgTemplate('obg_gyne_consult', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  obgTemplate('obg_postpartum', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  obgTemplate('obg_family_planning', [S.cc(), S.assessment(), S.plan(true)]),
  obgTemplate('obg_fertility', [S.cc(), S.hpi(), S.assessment(), S.plan(true)]),
  obgTemplate('obg_ultrasound_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  obgTemplate('obg_delivery_summary', [S.cc(), S.exam(), S.assessment(), S.plan(false)]),
]

// ── ORL / ENT Copilot — smart templates (Phase 19) ────────────────
// Visit-type scaffolds mapping ONLY to existing consultation columns.
function orlTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'ent', noteStyle: 'soap', sections }
}

export const ORL_SMART_TEMPLATE_IDS = [
  'orl_consultation', 'orl_otitis', 'orl_hearing_loss', 'orl_vertigo',
  'orl_rhinosinusitis', 'orl_tonsillitis', 'orl_voice', 'orl_neck_mass', 'orl_post_op',
] as const

const ORL_SMART_TEMPLATES: ConsultationTemplate[] = [
  orlTemplate('orl_consultation', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_otitis', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_hearing_loss', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_vertigo', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_rhinosinusitis', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_tonsillitis', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_voice', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_neck_mass', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orlTemplate('orl_post_op', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Cardiology Copilot — smart templates (Phase 22) ───────────────
// Visit-type scaffolds mapping ONLY to existing consultation columns (no schema
// change). Documentation guides — they generate NO diagnosis or content.
function cardioTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'cardiology', noteStyle: 'soap', sections }
}

export const CARDIO_SMART_TEMPLATE_IDS = [
  'cardio_initial_consult', 'cardio_hypertension_review', 'cardio_heart_failure_review',
  'cardio_arrhythmia_followup', 'cardio_chest_pain_eval', 'cardio_post_pci_followup',
  'cardio_post_cabg_followup', 'cardio_cardiac_clearance',
] as const

const CARDIO_SMART_TEMPLATES: ConsultationTemplate[] = [
  cardioTemplate('cardio_initial_consult', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_hypertension_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_heart_failure_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_arrhythmia_followup', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_chest_pain_eval', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_post_pci_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_post_cabg_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  cardioTemplate('cardio_cardiac_clearance', [S.cc(), S.exam(), S.assessment(), S.plan(false)]),
]

// ── Emergency Medicine Copilot — smart templates (Phase 23) ───────
// Visit-type scaffolds mapping ONLY to existing consultation columns (no schema
// change). Documentation guides — they generate NO diagnosis or content.
function emTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'emergency_medicine', noteStyle: 'soap', sections }
}

export const EMERGENCY_SMART_TEMPLATE_IDS = [
  'em_chest_pain', 'em_abdominal_pain', 'em_trauma', 'em_shortness_of_breath',
  'em_fever', 'em_stroke_eval', 'em_seizure', 'em_general_assessment',
] as const

const EMERGENCY_SMART_TEMPLATES: ConsultationTemplate[] = [
  emTemplate('em_chest_pain', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_abdominal_pain', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_trauma', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_shortness_of_breath', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_fever', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_stroke_eval', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_seizure', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  emTemplate('em_general_assessment', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Internal Medicine Copilot — smart templates (Phase 24) ────────
// Chronic-disease visit scaffolds mapping ONLY to existing consultation columns
// (no schema change). Documentation guides — they generate NO diagnosis or content.
function imTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'internal_medicine', noteStyle: 'soap', sections }
}

export const IM_SMART_TEMPLATE_IDS = [
  'im_initial_consult', 'im_diabetes_followup', 'im_hypertension_followup', 'im_ckd_followup',
  'im_asthma_copd_followup', 'im_dyslipidemia_followup', 'im_thyroid_followup', 'im_discharge_followup',
] as const

const IM_SMART_TEMPLATES: ConsultationTemplate[] = [
  imTemplate('im_initial_consult', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_diabetes_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_hypertension_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_ckd_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_asthma_copd_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_dyslipidemia_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_thyroid_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  imTemplate('im_discharge_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Orthopedics Copilot — smart templates (Phase 25) ─────────────
// Musculoskeletal visit scaffolds mapping ONLY to existing consultation columns
// (no schema change). Documentation guides — they generate NO diagnosis or content.
function orthoTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'orthopedics', noteStyle: 'soap', sections }
}

export const ORTHO_SMART_TEMPLATE_IDS = [
  'ortho_initial_consult', 'ortho_fracture_followup', 'ortho_cast_review', 'ortho_joint_pain_review',
  'ortho_post_op_review', 'ortho_wound_review', 'ortho_physiotherapy_referral', 'ortho_sports_injury_review',
] as const

const ORTHO_SMART_TEMPLATES: ConsultationTemplate[] = [
  orthoTemplate('ortho_initial_consult', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_fracture_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_cast_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_joint_pain_review', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_post_op_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_wound_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_physiotherapy_referral', [S.cc(), S.assessment(), S.plan(true)]),
  orthoTemplate('ortho_sports_injury_review', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Ophthalmology Copilot — smart templates (Phase 26) ───────────
// Eye-care visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis or content.
function ophthTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'ophthalmology', noteStyle: 'soap', sections }
}

export const OPHTH_SMART_TEMPLATE_IDS = [
  'ophth_initial_consult', 'ophth_visual_acuity_review', 'ophth_cataract_followup', 'ophth_glaucoma_followup',
  'ophth_diabetic_eye_screening', 'ophth_eye_procedure_followup', 'ophth_post_op_review', 'ophth_refraction_visit',
] as const

const OPHTH_SMART_TEMPLATES: ConsultationTemplate[] = [
  ophthTemplate('ophth_initial_consult', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_visual_acuity_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_cataract_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_glaucoma_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_diabetic_eye_screening', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_eye_procedure_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_post_op_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  ophthTemplate('ophth_refraction_visit', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Psychiatry / Mental Health Copilot — smart templates (Phase 27) ─
// Mental-health visit scaffolds mapping ONLY to existing consultation columns
// (no schema change). Documentation guides — they generate NO diagnosis, no risk
// assessment, no sensitive conclusion.
function mhTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'psychiatry', noteStyle: 'soap', sections }
}

export const MH_SMART_TEMPLATE_IDS = [
  'mh_initial_assessment', 'mh_therapy_session', 'mh_medication_review', 'mh_crisis_followup',
  'mh_safety_plan_review', 'mh_family_meeting', 'mh_referral_followup', 'mh_return_visit',
] as const

const MH_SMART_TEMPLATES: ConsultationTemplate[] = [
  mhTemplate('mh_initial_assessment', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_therapy_session', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_medication_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_crisis_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_safety_plan_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_family_meeting', [S.cc(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_referral_followup', [S.cc(), S.assessment(), S.plan(true)]),
  mhTemplate('mh_return_visit', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Pulmonology Copilot — smart templates (Phase 28) ─────────────
// Respiratory visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis or content.
function pulmTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'pulmonology', noteStyle: 'soap', sections }
}

export const PULM_SMART_TEMPLATE_IDS = [
  'pulm_initial_visit', 'pulm_asthma_followup', 'pulm_copd_followup', 'pulm_pft_review',
  'pulm_bronchoscopy_followup', 'pulm_sleep_study_review', 'pulm_smoking_cessation', 'pulm_rehab_review',
] as const

const PULM_SMART_TEMPLATES: ConsultationTemplate[] = [
  pulmTemplate('pulm_initial_visit', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_asthma_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_copd_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_pft_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_bronchoscopy_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_sleep_study_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_smoking_cessation', [S.cc(), S.assessment(), S.plan(true)]),
  pulmTemplate('pulm_rehab_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Nephrology Copilot — smart templates (Phase 29) ──────────────
// Kidney-care visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis or content.
function nephroTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'nephrology', noteStyle: 'soap', sections }
}

export const NEPHRO_SMART_TEMPLATE_IDS = [
  'nephro_initial_visit', 'nephro_ckd_followup', 'nephro_dialysis_review', 'nephro_biopsy_followup',
  'nephro_transplant_followup', 'nephro_hypertension_followup', 'nephro_nutrition_review', 'nephro_post_discharge_review',
] as const

const NEPHRO_SMART_TEMPLATES: ConsultationTemplate[] = [
  nephroTemplate('nephro_initial_visit', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_ckd_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_dialysis_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_biopsy_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_transplant_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_hypertension_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_nutrition_review', [S.cc(), S.assessment(), S.plan(true)]),
  nephroTemplate('nephro_post_discharge_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Oncology Copilot — smart templates (Phase 30) ────────────────
// Cancer-care visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis, staging or
// treatment content.
function oncoTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'oncology', noteStyle: 'soap', sections }
}

export const ONCO_SMART_TEMPLATE_IDS = [
  'onco_initial_visit', 'onco_chemo_followup', 'onco_radio_followup', 'onco_immuno_review',
  'onco_tumor_board_followup', 'onco_survivorship_visit', 'onco_supportive_care_review', 'onco_nutrition_followup',
] as const

const ONCO_SMART_TEMPLATES: ConsultationTemplate[] = [
  oncoTemplate('onco_initial_visit', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_chemo_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_radio_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_immuno_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_tumor_board_followup', [S.cc(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_survivorship_visit', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_supportive_care_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  oncoTemplate('onco_nutrition_followup', [S.cc(), S.assessment(), S.plan(true)]),
]

// ── General Surgery Copilot — smart templates (Phase 31) ─────────
// Surgical visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis, operative
// recommendation or content.
function surgeryTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'general_surgery', noteStyle: 'soap', sections }
}

export const SURGERY_SMART_TEMPLATE_IDS = [
  'surg_consultation', 'surg_preop_assessment', 'surg_operative_followup', 'surg_postop_review',
  'surg_drain_review', 'surg_suture_removal', 'surg_wound_review', 'surg_discharge_followup',
] as const

const SURGERY_SMART_TEMPLATES: ConsultationTemplate[] = [
  surgeryTemplate('surg_consultation', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  surgeryTemplate('surg_preop_assessment', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  surgeryTemplate('surg_operative_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  surgeryTemplate('surg_postop_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  surgeryTemplate('surg_drain_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  surgeryTemplate('surg_suture_removal', [S.cc(), S.exam(), S.plan(true)]),
  surgeryTemplate('surg_wound_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  surgeryTemplate('surg_discharge_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

// ── Neurology Copilot — smart templates (Phase 32) ───────────────
// Neurology visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis, imaging
// interpretation or content.
function neuroTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'neurology', noteStyle: 'soap', sections }
}

export const NEURO_SMART_TEMPLATE_IDS = [
  'neuro_consultation', 'neuro_stroke_followup', 'neuro_headache_followup', 'neuro_epilepsy_review',
  'neuro_neuropathy_review', 'neuro_rehab_followup', 'neuro_hospital_followup', 'neuro_neurophysiology_review',
] as const

const NEURO_SMART_TEMPLATES: ConsultationTemplate[] = [
  neuroTemplate('neuro_consultation', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_stroke_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_headache_followup', [S.cc(), S.hpi(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_epilepsy_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_neuropathy_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_rehab_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_hospital_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  neuroTemplate('neuro_neurophysiology_review', [S.cc(), S.assessment(), S.plan(true)]),
]

// ── Endocrinology Copilot — smart templates (Phase 33) ───────────
// Endocrinology visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis, laboratory
// interpretation or content.
function endoTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'endocrinology', noteStyle: 'soap', sections }
}

export const ENDO_SMART_TEMPLATE_IDS = [
  'endo_consultation', 'endo_diabetes_followup', 'endo_thyroid_followup', 'endo_pituitary_review',
  'endo_adrenal_review', 'endo_obesity_followup', 'endo_hospital_followup', 'endo_hormone_review',
] as const

const ENDO_SMART_TEMPLATES: ConsultationTemplate[] = [
  endoTemplate('endo_consultation', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_diabetes_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_thyroid_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_pituitary_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_adrenal_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_obesity_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_hospital_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  endoTemplate('endo_hormone_review', [S.cc(), S.assessment(), S.plan(true)]),
]

// ── Dermatology Copilot — smart templates (Phase 34) ─────────────
// Dermatology visit scaffolds mapping ONLY to existing consultation columns (no
// schema change). Documentation guides — they generate NO diagnosis, lesion
// classification or content.
function dermTemplate(id: string, sections: Sec[]): ConsultationTemplate {
  return { id, specialty: 'dermatology', noteStyle: 'soap', sections }
}

export const DERM_SMART_TEMPLATE_IDS = [
  'derm_consultation', 'derm_skin_lesion_review', 'derm_mole_followup', 'derm_biopsy_followup',
  'derm_patch_test_review', 'derm_cryotherapy_followup', 'derm_procedure_followup', 'derm_hospital_followup',
] as const

const DERM_SMART_TEMPLATES: ConsultationTemplate[] = [
  dermTemplate('derm_consultation', [S.cc(), S.hpi(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_skin_lesion_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_mole_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_biopsy_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_patch_test_review', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_cryotherapy_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_procedure_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
  dermTemplate('derm_hospital_followup', [S.cc(), S.exam(), S.assessment(), S.plan(true)]),
]

export const TEMPLATE_REGISTRY: ConsultationTemplate[] = [
  GP_CONSULTATION,
  ...GP_SMART_TEMPLATES,
  ...PEDS_SMART_TEMPLATES,
  ...OBGYN_SMART_TEMPLATES,
  ...ORL_SMART_TEMPLATES,
  ...CARDIO_SMART_TEMPLATES,
  ...EMERGENCY_SMART_TEMPLATES,
  ...IM_SMART_TEMPLATES,
  ...ORTHO_SMART_TEMPLATES,
  ...OPHTH_SMART_TEMPLATES,
  ...MH_SMART_TEMPLATES,
  ...PULM_SMART_TEMPLATES,
  ...NEPHRO_SMART_TEMPLATES,
  ...ONCO_SMART_TEMPLATES,
  ...SURGERY_SMART_TEMPLATES,
  ...NEURO_SMART_TEMPLATES,
  ...ENDO_SMART_TEMPLATES,
  ...DERM_SMART_TEMPLATES,
]

export function getTemplate(id: string): ConsultationTemplate | undefined {
  return TEMPLATE_REGISTRY.find(t => t.id === id)
}

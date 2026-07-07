// ── Clinical Documents registry (Phase 20) ─────────────────────────
//
// The single plug-in point for clinical documents — shared across specialties.
// A future document is ONE entry appended here (+ i18n keys), no core change.
// Definitions are pure data: no diagnosis, no treatment, no AI. Fields are
// clinician-edited; prefill copies existing recorded data only (see prefill.ts).

import type { Role } from '@/types/database'
import type { DocumentDefinition, DocumentField, PrefillSource } from './types'

// ── Field builders ──────────────────────────────────────────────────
const text = (key: string, labelKey: string, prefill?: PrefillSource): DocumentField => ({ key, type: 'text', labelKey, prefill })
const area = (key: string, labelKey: string, prefill?: PrefillSource, required?: boolean): DocumentField => ({ key, type: 'textarea', labelKey, prefill, required })
const date = (key: string, labelKey: string, prefill?: PrefillSource): DocumentField => ({ key, type: 'date', labelKey, prefill })
const num = (key: string, labelKey: string): DocumentField => ({ key, type: 'number', labelKey })

const DEFAULT_PRINT = { showClinicHeader: true, showPatientIdentity: true, showDoctorSignature: true, showDate: true }
const BASE = { outputType: 'print' as const, print: DEFAULT_PRINT, schemaVersion: 1 }
const DOCTOR: Role[] = ['doctor', 'super_admin']
const DOCTOR_NURSE: Role[] = ['doctor', 'nurse', 'super_admin']

function sec(fields: DocumentField[]) {
  return [{ id: 'body', fieldKeys: fields.map(f => f.key) }]
}

// ── The documents ───────────────────────────────────────────────────
export const DOCUMENT_DEFINITIONS: DocumentDefinition[] = [
  // ── Shared (any specialty) — GP-authored ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'gp_referral_letter', specialty: 'shared' as const, category: 'referral' as const, titleKey: 'doc_gp_referral_letter', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('statement', 'df_statement', undefined, true),
      area('notes', 'df_notes'),
    ]; return { ...BASE, id: 'gp_medical_certificate', specialty: 'shared' as const, category: 'certificate' as const, titleKey: 'doc_gp_medical_certificate', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      date('from_date', 'df_from_date', 'today'),
      date('to_date', 'df_to_date'),
      num('days', 'df_days'),
      area('reason', 'df_reason'),
    ]; return { ...BASE, id: 'gp_sick_leave', specialty: 'shared' as const, category: 'certificate' as const, titleKey: 'doc_gp_sick_leave', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Pediatrics ──
  (() => { const f = [
      area('statement', 'df_statement', undefined, true),
      { key: 'fit_for_school', type: 'select' as const, labelKey: 'df_fit_for_school', options: [{ value: 'yes', labelKey: 'opt_yes' }, { value: 'no', labelKey: 'opt_no' }] },
      area('notes', 'df_notes'),
    ]; return { ...BASE, id: 'peds_school_certificate', specialty: 'pediatrics' as const, category: 'certificate' as const, titleKey: 'doc_peds_school_certificate', allowedRoles: DOCTOR_NURSE, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('vaccines', 'df_vaccines', undefined, true),
      area('notes', 'df_notes'),
    ]; return { ...BASE, id: 'peds_vaccination_certificate', specialty: 'pediatrics' as const, category: 'certificate' as const, titleKey: 'doc_peds_vaccination_certificate', allowedRoles: DOCTOR_NURSE, fields: f, sections: sec(f) } })(),

  // ── OB/GYN ──
  (() => { const f = [
      text('gestational_age', 'df_gestational_age'),
      date('edd', 'df_edd'),
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'obgyn_anc_summary', specialty: 'obgyn' as const, category: 'summary' as const, titleKey: 'doc_obgyn_anc_summary', allowedRoles: DOCTOR_NURSE, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      date('lmp', 'df_lmp'),
      date('edd', 'df_edd'),
      text('gravida_para', 'df_gravida_para'),
      area('summary', 'df_summary'),
    ]; return { ...BASE, id: 'obgyn_pregnancy_summary', specialty: 'obgyn' as const, category: 'summary' as const, titleKey: 'doc_obgyn_pregnancy_summary', allowedRoles: DOCTOR_NURSE, fields: f, sections: sec(f) } })(),

  // ── ORL / ENT ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('summary', 'df_summary'),
    ]; return { ...BASE, id: 'orl_audiology_referral', specialty: 'ent' as const, category: 'referral' as const, titleKey: 'doc_orl_audiology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'orl_ent_followup_summary', specialty: 'ent' as const, category: 'summary' as const, titleKey: 'doc_orl_ent_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Cardiology (Phase 22) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'cardiology_referral', specialty: 'cardiology' as const, category: 'referral' as const, titleKey: 'doc_cardiology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      text('procedure', 'df_procedure'),
      area('statement', 'df_statement', undefined, true),
      area('notes', 'df_notes'),
    ]; return { ...BASE, id: 'procedure_clearance', specialty: 'cardiology' as const, category: 'certificate' as const, titleKey: 'doc_procedure_clearance', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'cardiac_followup_summary', specialty: 'cardiology' as const, category: 'summary' as const, titleKey: 'doc_cardiac_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint'),
      area('summary', 'df_summary'),
    ]; return { ...BASE, id: 'cardiac_rehab_referral', specialty: 'cardiology' as const, category: 'referral' as const, titleKey: 'doc_cardiac_rehab_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Emergency Medicine (Phase 23) ──
  // NOTE: an emergency doctor also gets the SHARED referral letter + medical
  // certificate (gp_referral_letter / gp_medical_certificate) — not re-registered.
  (() => { const f = [
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('summary', 'df_summary', 'consultation.notes'),
      area('management', 'df_current_management', 'consultation.treatment_plan'),
      area('disposition', 'df_disposition'),
      date('follow_up', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'emergency_summary', specialty: 'emergency_medicine' as const, category: 'summary' as const, titleKey: 'doc_emergency_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      text('recipient', 'df_recipient'),
      text('destination', 'df_destination'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('summary', 'df_summary', 'consultation.notes'),
    ]; return { ...BASE, id: 'transfer_summary', specialty: 'emergency_medicine' as const, category: 'referral' as const, titleKey: 'doc_transfer_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('observation_course', 'df_observation_course', undefined, true),
      area('disposition', 'df_disposition'),
      date('follow_up', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'observation_summary', specialty: 'emergency_medicine' as const, category: 'summary' as const, titleKey: 'doc_observation_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Internal Medicine (Phase 24) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'internal_medicine_referral', specialty: 'internal_medicine' as const, category: 'referral' as const, titleKey: 'doc_internal_medicine_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'chronic_disease_followup_summary', specialty: 'internal_medicine' as const, category: 'summary' as const, titleKey: 'doc_chronic_disease_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'hospital_discharge_followup_note', specialty: 'internal_medicine' as const, category: 'note' as const, titleKey: 'doc_hospital_discharge_followup_note', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('medications', 'df_medications', undefined, true),
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'medication_review_summary', specialty: 'internal_medicine' as const, category: 'summary' as const, titleKey: 'doc_medication_review_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Orthopedics (Phase 25) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'orthopedic_referral', specialty: 'orthopedics' as const, category: 'referral' as const, titleKey: 'doc_orthopedic_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('summary', 'df_summary'),
    ]; return { ...BASE, id: 'ortho_physiotherapy_referral', specialty: 'orthopedics' as const, category: 'referral' as const, titleKey: 'doc_ortho_physiotherapy_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'cast_review_summary', specialty: 'orthopedics' as const, category: 'summary' as const, titleKey: 'doc_cast_review_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'post_op_orthopedic_summary', specialty: 'orthopedics' as const, category: 'summary' as const, titleKey: 'doc_post_op_orthopedic_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Ophthalmology (Phase 26) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'ophthalmology_referral', specialty: 'ophthalmology' as const, category: 'referral' as const, titleKey: 'doc_ophthalmology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'eye_examination_summary', specialty: 'ophthalmology' as const, category: 'summary' as const, titleKey: 'doc_eye_examination_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('statement', 'df_statement', undefined, true),
      area('notes', 'df_notes'),
    ]; return { ...BASE, id: 'visual_acuity_certificate', specialty: 'ophthalmology' as const, category: 'certificate' as const, titleKey: 'doc_visual_acuity_certificate', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'post_op_ophthalmology_summary', specialty: 'ophthalmology' as const, category: 'summary' as const, titleKey: 'doc_post_op_ophthalmology_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Psychiatry / Mental Health (Phase 27) ──
  // The clinician writes and confirms every field; prefill copies existing
  // recorded data only — no generated psychiatric conclusion.
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('summary', 'df_summary'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'mental_health_referral', specialty: 'psychiatry' as const, category: 'referral' as const, titleKey: 'doc_mental_health_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'therapy_followup_summary', specialty: 'psychiatry' as const, category: 'summary' as const, titleKey: 'doc_therapy_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'crisis_followup_summary', specialty: 'psychiatry' as const, category: 'summary' as const, titleKey: 'doc_crisis_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('statement', 'df_statement', undefined, true),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'return_to_care_reminder', specialty: 'psychiatry' as const, category: 'note' as const, titleKey: 'doc_return_to_care_reminder', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Pulmonology (Phase 28) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'pulmonology_referral', specialty: 'pulmonology' as const, category: 'referral' as const, titleKey: 'doc_pulmonology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'respiratory_followup_summary', specialty: 'pulmonology' as const, category: 'summary' as const, titleKey: 'doc_respiratory_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('summary', 'df_summary'),
    ]; return { ...BASE, id: 'pulmonary_rehab_referral', specialty: 'pulmonology' as const, category: 'referral' as const, titleKey: 'doc_pulmonary_rehab_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'pulmonary_function_summary', specialty: 'pulmonology' as const, category: 'summary' as const, titleKey: 'doc_pulmonary_function_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Nephrology (Phase 29) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'nephrology_referral', specialty: 'nephrology' as const, category: 'referral' as const, titleKey: 'doc_nephrology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'dialysis_summary', specialty: 'nephrology' as const, category: 'summary' as const, titleKey: 'doc_dialysis_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'kidney_biopsy_summary', specialty: 'nephrology' as const, category: 'summary' as const, titleKey: 'doc_kidney_biopsy_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'transplant_followup_summary', specialty: 'nephrology' as const, category: 'summary' as const, titleKey: 'doc_transplant_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Oncology (Phase 30) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'oncology_referral', specialty: 'oncology' as const, category: 'referral' as const, titleKey: 'doc_oncology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'treatment_continuity_summary', specialty: 'oncology' as const, category: 'summary' as const, titleKey: 'doc_treatment_continuity_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'tumor_board_summary', specialty: 'oncology' as const, category: 'summary' as const, titleKey: 'doc_tumor_board_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'survivorship_summary', specialty: 'oncology' as const, category: 'summary' as const, titleKey: 'doc_survivorship_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── General Surgery (Phase 31) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'surgical_referral', specialty: 'general_surgery' as const, category: 'referral' as const, titleKey: 'doc_surgical_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'operative_summary', specialty: 'general_surgery' as const, category: 'summary' as const, titleKey: 'doc_operative_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'postop_summary', specialty: 'general_surgery' as const, category: 'summary' as const, titleKey: 'doc_postop_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'surgical_discharge_summary', specialty: 'general_surgery' as const, category: 'summary' as const, titleKey: 'doc_surgical_discharge_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Neurology (Phase 32) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'neurology_referral', specialty: 'neurology' as const, category: 'referral' as const, titleKey: 'doc_neurology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'neurophysiology_summary', specialty: 'neurology' as const, category: 'summary' as const, titleKey: 'doc_neurophysiology_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'rehabilitation_summary', specialty: 'neurology' as const, category: 'summary' as const, titleKey: 'doc_rehabilitation_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'neurology_followup_summary', specialty: 'neurology' as const, category: 'summary' as const, titleKey: 'doc_neurology_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),

  // ── Endocrinology (Phase 33) ──
  (() => { const f = [
      text('recipient', 'df_recipient'),
      area('reason', 'df_reason', 'consultation.chief_complaint', true),
      area('clinical_summary', 'df_clinical_summary', 'consultation.diagnosis'),
      area('request', 'df_request'),
    ]; return { ...BASE, id: 'endocrinology_referral', specialty: 'endocrinology' as const, category: 'referral' as const, titleKey: 'doc_endocrinology_referral', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'diabetes_followup_summary', specialty: 'endocrinology' as const, category: 'summary' as const, titleKey: 'doc_diabetes_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      area('current_management', 'df_current_management', 'consultation.treatment_plan'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'thyroid_followup_summary', specialty: 'endocrinology' as const, category: 'summary' as const, titleKey: 'doc_thyroid_followup_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
  (() => { const f = [
      area('summary', 'df_summary', 'consultation.notes'),
      date('next_visit', 'df_next_visit', 'consultation.follow_up_date'),
    ]; return { ...BASE, id: 'hormone_investigation_summary', specialty: 'endocrinology' as const, category: 'summary' as const, titleKey: 'doc_hormone_investigation_summary', allowedRoles: DOCTOR, fields: f, sections: sec(f) } })(),
]

// ── Lookups / access ────────────────────────────────────────────────
export function getDocument(id?: string | null): DocumentDefinition | undefined {
  return DOCUMENT_DEFINITIONS.find(d => d.id === id)
}

export function canAccessDocument(def: DocumentDefinition, role?: string | null): boolean {
  return !!role && def.allowedRoles.includes(role as Role)
}

/** Documents a professional may generate: role-permitted AND (shared OR their
 *  specialty). An un-specialised doctor still sees shared documents. */
export function availableDocuments(role?: string | null, specialtyId?: string | null): DocumentDefinition[] {
  if (!role) return []
  return DOCUMENT_DEFINITIONS.filter(d =>
    d.allowedRoles.includes(role as Role) && (d.specialty === 'shared' || d.specialty === specialtyId),
  )
}

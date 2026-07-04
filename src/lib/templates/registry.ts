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

export const TEMPLATE_REGISTRY: ConsultationTemplate[] = [
  GP_CONSULTATION,
]

export function getTemplate(id: string): ConsultationTemplate | undefined {
  return TEMPLATE_REGISTRY.find(t => t.id === id)
}

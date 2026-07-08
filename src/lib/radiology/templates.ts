// ── Radiology report templates — pure registry (Phase 39) ─────────
//
// Templates are empty SCAFFOLDS by modality / exam type / body region — they carry
// a neutral acquisition-technique placeholder and section headers only. They are
// NOT diagnosis generators and contain NO findings or conclusions: the radiologist
// dictates everything. Registry-driven — a future template is one entry here.

import type { Modality } from './types'

export interface RadiologyTemplate {
  id: string
  modality: Modality
  examType: string
  region: string          // brain | chest | abdomen | breast | ...
  labelKey: string        // i18n label
  techniqueKey: string    // i18n NEUTRAL acquisition-protocol placeholder (editable)
}

export const RADIOLOGY_TEMPLATES: RadiologyTemplate[] = [
  { id: 'ct_brain', modality: 'ct', examType: 'ct_brain', region: 'brain', labelKey: 'tpl_ct_brain', techniqueKey: 'tech_ct_brain' },
  { id: 'ct_chest', modality: 'ct', examType: 'ct_chest', region: 'chest', labelKey: 'tpl_ct_chest', techniqueKey: 'tech_ct_chest' },
  { id: 'ct_abdomen', modality: 'ct', examType: 'ct_abdomen', region: 'abdomen', labelKey: 'tpl_ct_abdomen', techniqueKey: 'tech_ct_abdomen' },
  { id: 'mri_brain', modality: 'mri', examType: 'mri_brain', region: 'brain', labelKey: 'tpl_mri_brain', techniqueKey: 'tech_mri_brain' },
  { id: 'ultrasound_abdomen', modality: 'ultrasound', examType: 'ultrasound_abdomen', region: 'abdomen', labelKey: 'tpl_ultrasound_abdomen', techniqueKey: 'tech_ultrasound_abdomen' },
  { id: 'xray_chest', modality: 'xray', examType: 'xray_chest', region: 'chest', labelKey: 'tpl_xray_chest', techniqueKey: 'tech_xray_chest' },
  { id: 'mammography', modality: 'mammography', examType: 'mammography', region: 'breast', labelKey: 'tpl_mammography', techniqueKey: 'tech_mammography' },
]

export const RADIOLOGY_TEMPLATE_IDS = RADIOLOGY_TEMPLATES.map(t => t.id)

export function getRadiologyTemplate(id?: string | null): RadiologyTemplate | null {
  return RADIOLOGY_TEMPLATES.find(t => t.id === id) ?? null
}

export function templatesForModality(modality?: string | null): RadiologyTemplate[] {
  return RADIOLOGY_TEMPLATES.filter(t => t.modality === modality)
}

/** Best-effort template match for an exam type (never throws; null when unknown). */
export function templateForExam(examType?: string | null): RadiologyTemplate | null {
  return RADIOLOGY_TEMPLATES.find(t => t.examType === examType) ?? null
}

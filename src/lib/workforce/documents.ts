// ── Workforce documents registry (Phase 21) ────────────────────────
//
// Registry ONLY. Reuses the Phase 20 document primitives (DocumentField /
// DocumentSection / PrintSettings) but with a WORKFORCE context — employee +
// clinic — that is completely SEPARATE from the patient/clinical document
// context. No patient data ever enters here (a hard stop condition). No content
// is generated: the admin edits and confirms every field; prefill copies only
// existing employee/clinic data, then prints.

import type { Role } from '@/types/database'
import type { DocumentField, DocumentSection, PrintSettings } from '@/lib/documents/types'

export type WorkforceDocumentCategory =
  | 'contract' | 'letter' | 'credential' | 'certificate' | 'review'

// Where a workforce field's initial value comes from — EXISTING employee/clinic
// data only. Nothing here is a patient source; nothing generates content.
export type WorkforcePrefillSource =
  | 'employee.full_name' | 'employee.matricule' | 'employee.national_id'
  | 'employee.position' | 'employee.department' | 'employee.hire_date'
  | 'employee.employment_type' | 'employee.medical_license_number'
  | 'employee.contract_end_date'
  | 'clinic.name' | 'clinic.location' | 'clinic.phone'
  | 'today'

export interface WorkforceDocumentField extends Omit<DocumentField, 'prefill'> {
  prefill?: WorkforcePrefillSource
}

export interface WorkforceDocumentDefinition {
  id: string
  category: WorkforceDocumentCategory
  titleKey: string
  /** Roles permitted to produce this HR document — admin tier only; never widens RLS. */
  allowedRoles: Role[]
  fields: WorkforceDocumentField[]
  sections: DocumentSection[]
  print: PrintSettings
  schemaVersion: number
}

const HR_ROLES: Role[] = ['admin', 'super_admin']

const printDefaults: PrintSettings = {
  showClinicHeader: true,
  showPatientIdentity: false,   // NEVER — this tier has no patient
  showDoctorSignature: true,
  showDate: true,
}

export const WORKFORCE_DOCUMENTS: WorkforceDocumentDefinition[] = [
  {
    id: 'employment_contract',
    category: 'contract',
    titleKey: 'wdoc_employment_contract',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'matricule', type: 'text', labelKey: 'wf_matricule', prefill: 'employee.matricule' },
      { key: 'position', type: 'text', labelKey: 'wf_position', prefill: 'employee.position' },
      { key: 'department', type: 'text', labelKey: 'wf_department', prefill: 'employee.department' },
      { key: 'employment_type', type: 'text', labelKey: 'wf_employment_type', prefill: 'employee.employment_type' },
      { key: 'start_date', type: 'date', labelKey: 'wf_hire_date', prefill: 'employee.hire_date' },
      { key: 'end_date', type: 'date', labelKey: 'wf_contract_end', prefill: 'employee.contract_end_date' },
      { key: 'terms', type: 'textarea', labelKey: 'wdoc_terms', required: true },
    ],
    sections: [
      { id: 'parties', labelKey: 'wdoc_sec_parties', fieldKeys: ['employee_name', 'matricule', 'position', 'department'] },
      { id: 'terms', labelKey: 'wdoc_sec_terms', fieldKeys: ['employment_type', 'start_date', 'end_date', 'terms'] },
    ],
  },
  {
    id: 'appointment_letter',
    category: 'letter',
    titleKey: 'wdoc_appointment_letter',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'position', type: 'text', labelKey: 'wf_position', prefill: 'employee.position' },
      { key: 'department', type: 'text', labelKey: 'wf_department', prefill: 'employee.department' },
      { key: 'start_date', type: 'date', labelKey: 'wf_hire_date', prefill: 'employee.hire_date' },
      { key: 'body', type: 'textarea', labelKey: 'wdoc_letter_body', required: true },
    ],
    sections: [
      { id: 'main', fieldKeys: ['employee_name', 'position', 'department', 'start_date', 'body'] },
    ],
  },
  {
    id: 'license_copy',
    category: 'credential',
    titleKey: 'wdoc_license_copy',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'license_number', type: 'text', labelKey: 'wf_medical_license', prefill: 'employee.medical_license_number' },
      { key: 'issuing_authority', type: 'text', labelKey: 'wf_issuing_authority' },
      { key: 'note', type: 'textarea', labelKey: 'wdoc_note' },
    ],
    sections: [{ id: 'main', fieldKeys: ['employee_name', 'license_number', 'issuing_authority', 'note'] }],
  },
  {
    id: 'board_certificate',
    category: 'certificate',
    titleKey: 'wdoc_board_certificate',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'board', type: 'text', labelKey: 'wdoc_board' },
      { key: 'certificate_number', type: 'text', labelKey: 'wf_number' },
      { key: 'note', type: 'textarea', labelKey: 'wdoc_note' },
    ],
    sections: [{ id: 'main', fieldKeys: ['employee_name', 'board', 'certificate_number', 'note'] }],
  },
  {
    id: 'diploma',
    category: 'certificate',
    titleKey: 'wdoc_diploma',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'institution', type: 'text', labelKey: 'wdoc_institution' },
      { key: 'qualification', type: 'text', labelKey: 'wdoc_qualification' },
      { key: 'note', type: 'textarea', labelKey: 'wdoc_note' },
    ],
    sections: [{ id: 'main', fieldKeys: ['employee_name', 'institution', 'qualification', 'note'] }],
  },
  {
    id: 'training_certificate',
    category: 'certificate',
    titleKey: 'wdoc_training_certificate',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'training_title', type: 'text', labelKey: 'wdoc_training_title' },
      { key: 'provider', type: 'text', labelKey: 'wf_provider' },
      { key: 'completed_date', type: 'date', labelKey: 'wf_completed_date' },
      { key: 'note', type: 'textarea', labelKey: 'wdoc_note' },
    ],
    sections: [{ id: 'main', fieldKeys: ['employee_name', 'training_title', 'provider', 'completed_date', 'note'] }],
  },
  {
    id: 'performance_review',
    category: 'review',
    titleKey: 'wdoc_performance_review',
    allowedRoles: HR_ROLES,
    schemaVersion: 1,
    print: printDefaults,
    fields: [
      { key: 'employee_name', type: 'text', labelKey: 'wf_full_name', prefill: 'employee.full_name' },
      { key: 'position', type: 'text', labelKey: 'wf_position', prefill: 'employee.position' },
      { key: 'period', type: 'text', labelKey: 'wdoc_review_period' },
      // Free-text the reviewer writes themselves — the app never generates or scores it.
      { key: 'summary', type: 'textarea', labelKey: 'wdoc_review_summary', required: true },
    ],
    sections: [{ id: 'main', fieldKeys: ['employee_name', 'position', 'period', 'summary'] }],
  },
]

const BY_ID = new Map(WORKFORCE_DOCUMENTS.map(d => [d.id, d]))

export function getWorkforceDocument(id: string): WorkforceDocumentDefinition | null {
  return BY_ID.get(id) ?? null
}

export function canAccessWorkforceDocument(def: WorkforceDocumentDefinition, role: Role | null): boolean {
  return !!role && def.allowedRoles.includes(role)
}

export function availableWorkforceDocuments(role: Role | null): WorkforceDocumentDefinition[] {
  return WORKFORCE_DOCUMENTS.filter(d => canAccessWorkforceDocument(d, role))
}

// Workforce document prefill context — employee + clinic ONLY. No patient.
export interface WorkforceDocumentContext {
  employee: {
    full_name?: string | null; matricule?: string | null; national_id?: string | null
    position?: string | null; department?: string | null; hire_date?: string | null
    employment_type?: string | null; medical_license_number?: string | null
    contract_end_date?: string | null
  } | null
  clinic: { name?: string | null; location?: string | null; phone?: string | null } | null
  now: Date
}

export function resolveWorkforcePrefill(source: WorkforcePrefillSource | undefined, ctx: WorkforceDocumentContext): string {
  if (!source) return ''
  const [scope, field] = source.split('.') as [string, string]
  if (source === 'today') return ctx.now.toISOString().slice(0, 10)
  if (scope === 'employee') return String(ctx.employee?.[field as keyof typeof ctx.employee] ?? '')
  if (scope === 'clinic') return String(ctx.clinic?.[field as keyof typeof ctx.clinic] ?? '')
  return ''
}

export function buildWorkforceInitialValues(def: WorkforceDocumentDefinition, ctx: WorkforceDocumentContext): Record<string, string> {
  const values: Record<string, string> = {}
  for (const f of def.fields) values[f.key] = resolveWorkforcePrefill(f.prefill, ctx)
  return values
}

export function workforceMissingRequired(def: WorkforceDocumentDefinition, values: Record<string, string>): string[] {
  return def.fields.filter(f => f.required && !(values[f.key] ?? '').trim()).map(f => f.key)
}

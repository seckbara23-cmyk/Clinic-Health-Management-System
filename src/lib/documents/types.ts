// ── Clinical Documents & Forms Framework — types (Phase 20) ────────
//
// A shared, registry-driven document framework used by ALL specialties
// (certificates, referrals, summaries, reports). It is DOCUMENTATION only:
// it NEVER generates a diagnosis or a treatment recommendation. Prefill copies
// EXISTING recorded data (patient identity, clinic, doctor, date, and the
// clinician's own already-written consultation text) — it never invents clinical
// findings. The clinician edits and confirms every field before printing.

import type { Role } from '@/types/database'
import type { SpecialtyId } from '@/lib/workspace/types'

export type DocumentCategory = 'certificate' | 'referral' | 'summary' | 'report' | 'note'
export type DocumentOutputType = 'print'   // browser print / save-as-PDF (no file storage this phase)
export type DocumentFieldType = 'text' | 'textarea' | 'date' | 'number' | 'select'

// Where a field's initial value comes from — EXISTING recorded data only.
// Nothing here generates a clinical finding; consultation.* sources copy the
// clinician's OWN recorded free-text, which they then edit/confirm.
export type PrefillSource =
  | 'patient.full_name' | 'patient.patient_number' | 'patient.date_of_birth' | 'patient.age'
  | 'patient.gender' | 'patient.address' | 'patient.phone' | 'patient.cni'
  | 'consultation.chief_complaint' | 'consultation.symptoms' | 'consultation.diagnosis'
  | 'consultation.treatment_plan' | 'consultation.notes' | 'consultation.follow_up_date'
  | 'profile.full_name' | 'profile.title'
  | 'clinic.name' | 'clinic.location' | 'clinic.phone'
  | 'today'

export interface DocumentField {
  key: string
  type: DocumentFieldType
  labelKey: string
  prefill?: PrefillSource
  required?: boolean
  options?: { value: string; labelKey: string }[]
}

export interface DocumentSection {
  id: string
  labelKey?: string
  fieldKeys: string[]
}

export interface PrintSettings {
  showClinicHeader: boolean
  showPatientIdentity: boolean
  showDoctorSignature: boolean
  showDate: boolean
}

export interface DocumentDefinition {
  id: string
  /** Owning specialty, or 'shared' for cross-specialty documents. */
  specialty: SpecialtyId | 'shared'
  category: DocumentCategory
  titleKey: string
  /** Roles permitted to generate this document (never widens RLS). */
  allowedRoles: Role[]
  outputType: DocumentOutputType
  fields: DocumentField[]
  sections: DocumentSection[]
  print: PrintSettings
  schemaVersion: number
}

// Prefill context — a plain snapshot of already-loaded data (no I/O here).
export interface DocumentContext {
  patient?: {
    full_name?: string | null; patient_number?: string | null; date_of_birth?: string | null
    gender?: string | null; address?: string | null; phone?: string | null; cni?: string | null
  } | null
  consultation?: {
    chief_complaint?: string | null; symptoms?: string | null; diagnosis?: string | null
    treatment_plan?: string | null; notes?: string | null; follow_up_date?: string | null
  } | null
  profile?: { full_name?: string | null; professionalTitle?: string | null } | null
  clinic?: { name?: string | null; location?: string | null; phone?: string | null } | null
  now: Date
}

export type DocumentValues = Record<string, string>

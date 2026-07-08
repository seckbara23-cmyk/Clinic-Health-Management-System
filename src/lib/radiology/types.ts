// ── Radiology (Radiora integration) — shared types (Phase 39) ─────
//
// Pure data types for the radiology reporting workspace. CHMS owns the patient /
// consultation / order / access / billing; Radiora owns the reporting workspace.
// The radiologist remains fully responsible for review, correction, validation and
// signature — the system NEVER interprets images and NEVER invents findings.

export const MODALITIES = ['ct', 'mri', 'ultrasound', 'xray', 'mammography'] as const
export type Modality = (typeof MODALITIES)[number]

export const PRIORITIES = ['routine', 'urgent', 'stat'] as const
export type Priority = (typeof PRIORITIES)[number]

// Order (worklist) statuses.
export const ORDER_STATUSES = [
  'requested', 'scheduled', 'in_progress', 'dictated', 'draft', 'pending_review', 'signed', 'delivered', 'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

// Report lifecycle statuses (distinct from the order/worklist status).
export const REPORT_STATUSES = ['draft', 'review', 'signed', 'amended'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export interface RadiologyOrder {
  id: string
  patientId: string
  consultationId?: string | null
  orderedBy?: string | null
  assignedRadiologistId?: string | null
  modality: string
  examType: string
  clinicalIndication?: string | null
  priority: string
  status: string
  requestedAt: string
  scheduledAt?: string | null
  completedAt?: string | null
}

export interface RadiologyReport {
  id: string
  orderId: string
  patientId: string
  radiologistId?: string | null
  reportStatus: string
  modality?: string | null
  examType?: string | null
  technique?: string | null
  findings?: string | null
  conclusion?: string | null
  recommendations?: string | null
  signedAt?: string | null
  signaturePath?: string | null
  version: number
}

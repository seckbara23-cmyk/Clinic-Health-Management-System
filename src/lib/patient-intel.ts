// ── Patient Intelligence (pure) ───────────────────────────────────
//
// Deterministic, dependency-free helpers behind the Patient Intelligence
// Workspace: an operational completeness score, an informational (non-clinical)
// brief, an operational alert strip, a merged timeline, and role capabilities.
//
// NOTHING here diagnoses, recommends treatment, or calls the AI engine. Every
// output is a pure transform of records the caller already loaded under RLS.

import type {
  Patient, Prescription, LabOrder, Invoice, Appointment, Consultation,
  MedicationDispensing, Role,
} from '@/types/database'

// ── 1. Operational completeness score ─────────────────────────────
// NOT a medical risk score. Purely: how complete is this patient's record?
export interface HealthScoreFactor { key: string; present: boolean }
export interface HealthScore { score: number; missing: string[]; factors: HealthScoreFactor[] }

const SCORE_FIELDS: { key: string; has: (p: Patient) => boolean }[] = [
  { key: 'demographics',     has: p => !!p.date_of_birth && !!p.gender },
  { key: 'phone',            has: p => !!p.phone },
  { key: 'address',          has: p => !!p.address },
  { key: 'bloodGroup',       has: p => !!p.blood_type },
  { key: 'allergies',        has: p => Array.isArray(p.allergies) && p.allergies.length > 0 },
  { key: 'emergencyContact', has: p => !!(p.emergency_contact || p.emergency_phone) },
  { key: 'insurance',        has: p => !!p.insurance_payer_type },
  { key: 'consent',          has: p => !!p.consent_given },
]

export function computeHealthScore(p: Patient): HealthScore {
  const factors = SCORE_FIELDS.map(f => ({ key: f.key, present: f.has(p) }))
  const present = factors.filter(f => f.present).length
  const score = Math.round((present / factors.length) * 100)
  const missing = factors.filter(f => !f.present).map(f => f.key)
  return { score, missing, factors }
}

// ── 2. Informational patient brief (no clinical content) ───────────
export interface PatientBriefData {
  activePrescriptions: number
  /** Completed lab orders awaiting review. */
  pendingLabReviews: number
  outstandingBalance: number
  /** True when at least one operational item is present. */
  hasIssues: boolean
  confidence: 'high' | 'medium' | 'low'
  /** Record categories the brief is based on (citations). */
  sources: string[]
}

export function buildPatientBrief(input: {
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  /** Which record sets successfully loaded (drives confidence). */
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): PatientBriefData {
  const loadedCount = [input.loaded.prescriptions, input.loaded.labs, input.loaded.invoices].filter(Boolean).length
  const confidence: PatientBriefData['confidence'] = loadedCount >= 3 ? 'high' : loadedCount >= 1 ? 'medium' : 'low'
  const sources: string[] = []
  if (input.loaded.prescriptions) sources.push('prescriptions')
  if (input.loaded.labs) sources.push('laboratory')
  if (input.loaded.invoices) sources.push('invoices')
  return {
    activePrescriptions: input.activePrescriptions,
    pendingLabReviews: input.pendingLabReviews,
    outstandingBalance: input.outstandingBalance,
    hasIssues: input.activePrescriptions > 0 || input.pendingLabReviews > 0 || input.outstandingBalance > 0,
    confidence,
    sources,
  }
}

/**
 * Canonical ENGLISH rendering of the brief — the source of truth mirrored by the
 * en `patientProfile.brief_*` messages, and the text asserted by the
 * "no diagnosis wording" test. The UI renders the localized version.
 */
export function composeBriefEnglish(b: PatientBriefData): string {
  if (!b.hasIssues) return 'No operational issues detected.'
  const rx = b.activePrescriptions === 0
    ? 'no active prescriptions'
    : `${b.activePrescriptions} active prescription${b.activePrescriptions === 1 ? '' : 's'}`
  const labs = b.pendingLabReviews === 0
    ? 'no outstanding laboratory reviews'
    : `${b.pendingLabReviews} laboratory result${b.pendingLabReviews === 1 ? '' : 's'} requiring review`
  return `This patient currently has ${rx} and ${labs}.`
}

// ── 3. Operational alert strip ─────────────────────────────────────
export type PatientAlertCode =
  | 'critical_allergy'
  | 'outstanding_balance'
  | 'missed_follow_up'
  | 'abnormal_lab_review'
  | 'stock_issue'
export type AlertSeverity = 'critical' | 'warning' | 'info'
export interface PatientAlert {
  code: PatientAlertCode
  severity: AlertSeverity
  params?: Record<string, string | number>
}

export function buildPatientAlerts(input: {
  allergies: string[] | null | undefined
  outstandingBalance: number
  missedFollowUp: boolean
  abnormalPendingLabCount: number
  criticalPendingLab: boolean
  stockIssueCount: number
}): PatientAlert[] {
  const alerts: PatientAlert[] = []
  const allergies = input.allergies ?? []
  if (allergies.length > 0) {
    alerts.push({ code: 'critical_allergy', severity: 'critical', params: { count: allergies.length, list: allergies.join(', ') } })
  }
  if (input.abnormalPendingLabCount > 0) {
    alerts.push({
      code: 'abnormal_lab_review',
      severity: input.criticalPendingLab ? 'critical' : 'warning',
      params: { count: input.abnormalPendingLabCount },
    })
  }
  if (input.stockIssueCount > 0) {
    alerts.push({ code: 'stock_issue', severity: 'warning', params: { count: input.stockIssueCount } })
  }
  if (input.outstandingBalance > 0) {
    alerts.push({ code: 'outstanding_balance', severity: 'warning', params: { amount: input.outstandingBalance } })
  }
  if (input.missedFollowUp) {
    alerts.push({ code: 'missed_follow_up', severity: 'info' })
  }
  return alerts
}

// ── 4. Merged timeline ─────────────────────────────────────────────
export type PatientTimelineType =
  | 'consultation' | 'appointment' | 'prescription' | 'lab' | 'invoice' | 'dispensing'

export interface PatientTimelineItem {
  id: string
  type: PatientTimelineType
  date: string
  status?: string
}

export function mergePatientTimeline(sources: {
  consultations?: Consultation[]
  appointments?: Appointment[]
  prescriptions?: Prescription[]
  labOrders?: LabOrder[]
  invoices?: Invoice[]
  dispensings?: MedicationDispensing[]
}): PatientTimelineItem[] {
  const items: PatientTimelineItem[] = []
  for (const c of sources.consultations ?? []) items.push({ id: `c-${c.id}`, type: 'consultation', date: c.created_at, status: c.ended_at ? 'ended' : 'ongoing' })
  for (const a of sources.appointments ?? []) items.push({ id: `a-${a.id}`, type: 'appointment', date: a.scheduled_at, status: a.status })
  for (const p of sources.prescriptions ?? []) items.push({ id: `p-${p.id}`, type: 'prescription', date: p.created_at, status: p.status })
  for (const l of sources.labOrders ?? []) items.push({ id: `l-${l.id}`, type: 'lab', date: l.created_at, status: l.status })
  for (const i of sources.invoices ?? []) items.push({ id: `i-${i.id}`, type: 'invoice', date: i.created_at, status: i.status })
  for (const d of sources.dispensings ?? []) items.push({ id: `d-${d.id}`, type: 'dispensing', date: d.dispensed_at ?? d.created_at, status: d.status })
  return items.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())
}

// ── 5. Role capabilities ───────────────────────────────────────────
export type PatientQuickAction = 'consultation' | 'prescription' | 'lab' | 'appointment' | 'invoice' | 'dispense'

export interface PatientCapabilities {
  /** Clinical detail: brief, snapshot, vitals, consultations, medical alerts. */
  medical: boolean
  labs: boolean
  medications: boolean
  financial: boolean
  insurance: boolean
  appointments: boolean
  documents: boolean
  timeline: boolean
  quickActions: PatientQuickAction[]
  /** super_admin — no patient medical details at all. */
  restricted: boolean
}

const NONE: PatientCapabilities = {
  medical: false, labs: false, medications: false, financial: false, insurance: false,
  appointments: false, documents: false, timeline: false, quickActions: [], restricted: false,
}

export function patientCapabilities(role: Role): PatientCapabilities {
  switch (role) {
    case 'doctor':
    case 'admin':
      return {
        medical: true, labs: true, medications: true, financial: true, insurance: true,
        appointments: true, documents: true, timeline: true,
        quickActions: ['consultation', 'prescription', 'lab', 'appointment', 'invoice', 'dispense'],
        restricted: false,
      }
    case 'nurse':
      return {
        ...NONE, medical: true, labs: true, medications: true, insurance: true,
        appointments: true, documents: true, timeline: true,
        quickActions: ['consultation', 'lab', 'appointment'],
      }
    case 'receptionist':
      return { ...NONE, insurance: true, appointments: true, quickActions: ['appointment'] }
    case 'cashier':
      return { ...NONE, financial: true, insurance: true, quickActions: ['invoice'] }
    case 'lab_technician':
      return { ...NONE, labs: true, documents: true, quickActions: ['lab'] }
    case 'pharmacist':
      return { ...NONE, medications: true, quickActions: ['dispense'] }
    case 'super_admin':
    default:
      return { ...NONE, restricted: true }
  }
}

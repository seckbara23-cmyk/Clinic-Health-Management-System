// ── Urology Clinical Copilot — pure engine (Phase 35) ─────────────
//
// The EIGHTEENTH production Copilot, focused on UROLOGY WORKFLOW, CONTINUITY OF
// CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and every specialty extension
// since. It EXTENDS and REUSES the GP engine; it does NOT duplicate it. It is NOT a
// clinical decision system.
//
// It NEVER: diagnoses, interprets laboratory / ultrasound / CT / MRI / cystoscopy,
// classifies kidney stones / prostate / bladder disease / urinary infections,
// recommends a medication / antibiotic / surgery / procedure / catheterization /
// admission / discharge / dialysis, predicts renal outcome / cancer, or calculates
// risk scores. It only SURFACES that a urology event or an investigation exists and
// its workflow status (planned / scheduled / active / awaiting review / follow-up
// due). Emits only codes / counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const URO_COPILOT_PACK_ID = 'urology.core'
export const URO_SPECIALTIES = ['urology'] as const

/** Active for a doctor whose primary specialty is Urology. Strict — no specialty
 *  leakage; the UI additionally gates on the clinic AI toggle. */
export function isUrologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'urology'
}

// ── Urology event vocabulary ────────────────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const URO_EVENT_TYPES = [
  'urology_consultation', 'kidney_stone_followup', 'hematuria_followup', 'catheter_review', 'catheter_removal',
  'cystoscopy_followup', 'prostate_review', 'bladder_review', 'biopsy_followup', 'postoperative_review',
  'hospital_discharge_followup', 'urinary_retention_review', 'stent_review', 'nephrostomy_review', 'continence_review',
] as const
export type UroEventType = (typeof URO_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
export const URO_TEST_TYPES = [
  'urinalysis', 'urine_culture', 'psa', 'kidney_ultrasound', 'bladder_ultrasound', 'ct_kub', 'ct_urogram',
  'mri_prostate', 'cystoscopy', 'urodynamics', 'biopsy',
] as const
export type UroTestType = (typeof URO_TEST_TYPES)[number]

// Imaging subset (the remaining tests are laboratory / procedural).
const IMAGING_TESTS = new Set<string>(['kidney_ultrasound', 'bladder_ultrasound', 'ct_kub', 'ct_urogram', 'mri_prostate'])
const LAB_TESTS = new Set<string>(['urinalysis', 'urine_culture', 'psa'])

export const URO_ALL_TYPES = [...URO_EVENT_TYPES, ...URO_TEST_TYPES] as const
export type UroAllType = (typeof URO_ALL_TYPES)[number]

export const URO_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type UroEventStatus = (typeof URO_EVENT_STATUSES)[number]

export type UroCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(URO_EVENT_TYPES)
const TEST_SET = new Set<string>(URO_TEST_TYPES)

export function isUroEventType(v: unknown): v is UroAllType {
  return typeof v === 'string' && (URO_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): UroCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface UroEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Urology event tracker (counts only — NEVER interpret) ──────────
export interface UroTrackingRow {
  eventType: UroEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildUroTracker(events: UroEvent[] | null | undefined): UroTrackingRow[] {
  const list = events ?? []
  return URO_EVENT_TYPES.map(eventType => {
    const inType = list.filter(e => e.eventType === eventType)
    return {
      eventType,
      planned: inType.filter(e => e.status === 'planned').length,
      scheduled: inType.filter(e => e.status === 'scheduled').length,
      active: inType.filter(e => e.status === 'active').length,
      completed: inType.filter(e => e.status === 'completed').length,
      awaitingReview: inType.filter(e => e.status === 'awaiting_review').length,
      followUpDue: inType.filter(e => e.status === 'follow_up_due').length,
      total: inType.filter(e => EVENT_OPEN.has(e.status)).length,
    }
  })
}

// ── Investigation workflow (counts only — NEVER interpret / classify) ─
export interface TestTrackingRow {
  testType: UroTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: UroEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return URO_TEST_TYPES.map(testType => {
    const inType = list.filter(e => e.eventType === testType)
    return {
      testType,
      ordered: inType.filter(e => e.status === 'ordered').length,
      completed: inType.filter(e => e.status === 'completed').length,
      awaitingReview: inType.filter(e => e.status === 'awaiting_review').length,
      reviewed: inType.filter(e => e.status === 'reviewed').length,
      total: inType.filter(e => TEST_OPEN.has(e.status)).length,
    }
  })
}

// ── Follow-up reminders (surface only — never interpret) ───────────
export interface UroReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildUroFollowUp(events: UroEvent[] | null | undefined): { reminders: UroReminder[] } {
  const list = events ?? []
  const reminders: UroReminder[] = []

  const tracking = buildUroTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'uro_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'uro_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'uro_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'uro_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'uro_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that urology investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the finding — no diagnosis, no classification
// of stones / prostate / bladder / infection, no interpretation of lab / imaging /
// cystoscopy.
const URO_RE = /urinalysis|urine culture|\bpsa\b|prostate[- ]specific|kidney ultrasound|renal ultrasound|bladder ultrasound|ct kub|\bkub\b|ct urogram|urogram|mri prostate|prostate mri|cystoscop|urodynam|uroflow/i
export interface UroImagingSignals { pending: number; completed: number; investigations: number }
export function countUroImagingSignals(labOrders?: LabOrder[] | null): UroImagingSignals {
  const orders = labOrders ?? []
  const isUro = (o: LabOrder) => URO_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => URO_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isUro)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + urology prompts) ───────
export interface UroCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeUroCompleteness(doc: ConsultationDoc): UroCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'uro_doc_urinary_symptoms', 'uro_doc_voiding_history', 'uro_doc_stone_history', 'uro_doc_prostate_history',
    'uro_doc_hematuria', 'uro_doc_catheter_status', 'uro_doc_investigation_followup', 'uro_doc_procedure_history',
    'uro_doc_examination', 'uro_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with urology counts) ───────
export interface UroSummary {
  activeWorkflow: number
  pendingLabs: number
  pendingImaging: number
  pendingProcedures: number
  catheterCare: number
  discharge: number
  medications: number
}
export interface UroBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: UroTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: UroImagingSignals
  followUp: ReturnType<typeof buildUroFollowUp>
  followUps: FollowUpItem[]
  summary: UroSummary
}
export function buildUroBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: UroEvent[]
  imagingSignals: UroImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): UroBrief {
  const gp = buildGpBrief({
    activePrescriptions: input.activePrescriptions,
    pendingLabReviews: input.pendingLabReviews,
    outstandingBalance: input.outstandingBalance,
    allergyCount: input.allergyCount,
    upcomingAppointments: input.upcomingAppointments,
    lastConsultationAt: input.lastConsultationAt,
    reminders: [], followUps: input.followUps,
    loaded: input.loaded,
  })
  const tracker = buildUroTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: UroSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    pendingLabs: tests.filter(r => LAB_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    pendingImaging: tests.filter(r => IMAGING_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    pendingProcedures: openTest('cystoscopy') + openTest('urodynamics') + openTest('biopsy') + openEvent('cystoscopy_followup') + openEvent('biopsy_followup'),
    catheterCare: openEvent('catheter_review') + openEvent('catheter_removal') + openEvent('stent_review') + openEvent('nephrostomy_review'),
    discharge: openEvent('hospital_discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildUroFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type UroAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type UroConsultations = Consultation[]

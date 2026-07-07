// ── Endocrinology Clinical Copilot — pure engine (Phase 33) ───────
//
// The SIXTEENTH production Copilot, focused on ENDOCRINOLOGY WORKFLOW, CONTINUITY
// OF CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only, OPERATIONAL only
// — same guarantees as the GP reference (Phase 16) and every specialty extension
// since. It EXTENDS and REUSES the GP engine; it does NOT duplicate it. It is NOT a
// clinical decision system.
//
// It NEVER: diagnoses, classifies diabetes / thyroid / pituitary / adrenal disease,
// interprets HbA1c / thyroid hormones / cortisol / pituitary hormones / MRI /
// ultrasound, recommends insulin / a medication / a dosage / surgery / admission /
// discharge, predicts complications / mortality / cardiovascular risk, or
// calculates diabetes or fracture-risk scores. It only SURFACES that an
// endocrinology event or a laboratory / imaging test exists and its workflow status
// (planned / scheduled / active / awaiting review / follow-up due). Emits only codes
// / counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const ENDO_COPILOT_PACK_ID = 'endocrinology.core'
export const ENDO_SPECIALTIES = ['endocrinology'] as const

/** Active for a doctor whose primary specialty is Endocrinology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isEndocrinologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'endocrinology'
}

// ── Endocrinology event vocabulary ──────────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const ENDO_EVENT_TYPES = [
  'endocrinology_consultation', 'diabetes_clinic_followup', 'thyroid_clinic_followup', 'pituitary_clinic_followup',
  'adrenal_clinic_followup', 'osteoporosis_review', 'obesity_clinic_review', 'nutrition_referral',
  'diabetes_education_referral', 'laboratory_followup', 'imaging_followup', 'hormone_review',
  'foot_examination_followup', 'eye_screening_followup', 'hospital_discharge_followup',
] as const
export type EndoEventType = (typeof ENDO_EVENT_TYPES)[number]

// Laboratory & imaging tests — workflow: ordered → completed → awaiting_review → reviewed.
export const ENDO_TEST_TYPES = [
  'hba1c', 'tsh', 'free_t4', 'free_t3', 'cortisol', 'acth', 'prolactin', 'igf1', 'lh', 'fsh',
  'estradiol', 'testosterone', 'vitamin_d', 'calcium', 'dexa', 'thyroid_ultrasound', 'pituitary_mri',
] as const
export type EndoTestType = (typeof ENDO_TEST_TYPES)[number]

// Imaging subset (the remaining tests are laboratory / hormone assays).
const IMAGING_TESTS = new Set<string>(['dexa', 'thyroid_ultrasound', 'pituitary_mri'])

export const ENDO_ALL_TYPES = [...ENDO_EVENT_TYPES, ...ENDO_TEST_TYPES] as const
export type EndoAllType = (typeof ENDO_ALL_TYPES)[number]

export const ENDO_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type EndoEventStatus = (typeof ENDO_EVENT_STATUSES)[number]

export type EndoCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(ENDO_EVENT_TYPES)
const TEST_SET = new Set<string>(ENDO_TEST_TYPES)

export function isEndoEventType(v: unknown): v is EndoAllType {
  return typeof v === 'string' && (ENDO_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): EndoCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface EndoEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Endocrinology event tracker (counts only — NEVER interpret) ────
export interface EndoTrackingRow {
  eventType: EndoEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildEndoTracker(events: EndoEvent[] | null | undefined): EndoTrackingRow[] {
  const list = events ?? []
  return ENDO_EVENT_TYPES.map(eventType => {
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

// ── Laboratory / imaging workflow (counts only — NEVER interpret / classify) ─
export interface TestTrackingRow {
  testType: EndoTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: EndoEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return ENDO_TEST_TYPES.map(testType => {
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
export interface EndoReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildEndoFollowUp(events: EndoEvent[] | null | undefined): { reminders: EndoReminder[] } {
  const list = events ?? []
  const reminders: EndoReminder[] = []

  const tracking = buildEndoTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'endo_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'endo_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'endo_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'endo_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'endo_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary laboratory / imaging signals (counts only — NEVER interpret) ─
// Surfaces that endocrine investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the finding — no diagnosis, no classification
// of diabetes / thyroid / pituitary / adrenal disease, no interpretation of HbA1c /
// hormones / MRI / ultrasound.
const ENDO_RE = /hba1c|\ba1c\b|glycated|\btsh\b|free t[34]|\bft[34]\b|thyroxine|cortisol|\bacth\b|prolactin|igf-?1|\blh\b|\bfsh\b|estradiol|testosterone|vitamin d|25-?oh|\bcalcium\b|\bdexa\b|bone densitom|thyroid ultrasound|thyroid us|pituitary mri/i
export interface EndoImagingSignals { pending: number; completed: number; investigations: number }
export function countEndoImagingSignals(labOrders?: LabOrder[] | null): EndoImagingSignals {
  const orders = labOrders ?? []
  const isEndo = (o: LabOrder) => ENDO_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => ENDO_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isEndo)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + endocrinology prompts) ─
export interface EndoCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeEndoCompleteness(doc: ConsultationDoc): EndoCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'endo_doc_endocrine_history', 'endo_doc_diabetes_history', 'endo_doc_thyroid_history', 'endo_doc_medication_adherence',
    'endo_doc_lifestyle_review', 'endo_doc_nutrition_review', 'endo_doc_laboratory_followup', 'endo_doc_imaging_followup',
    'endo_doc_education_review', 'endo_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with endocrinology counts) ─
export interface EndoSummary {
  activeWorkflow: number
  diabetesFollowups: number
  thyroidFollowups: number
  pendingLabs: number
  pendingImaging: number
  nutrition: number
  discharge: number
  medications: number
}
export interface EndoBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: EndoTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: EndoImagingSignals
  followUp: ReturnType<typeof buildEndoFollowUp>
  followUps: FollowUpItem[]
  summary: EndoSummary
}
export function buildEndoBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: EndoEvent[]
  imagingSignals: EndoImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): EndoBrief {
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
  const tracker = buildEndoTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const summary: EndoSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    diabetesFollowups: openEvent('diabetes_clinic_followup'),
    thyroidFollowups: openEvent('thyroid_clinic_followup'),
    pendingLabs: tests.filter(r => !IMAGING_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    pendingImaging: tests.filter(r => IMAGING_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    nutrition: openEvent('nutrition_referral'),
    discharge: openEvent('hospital_discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildEndoFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type EndoAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type EndoConsultations = Consultation[]

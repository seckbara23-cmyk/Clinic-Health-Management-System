// ── Pulmonology Clinical Copilot — pure engine (Phase 28) ──────────
//
// The ELEVENTH production Copilot, focused on RESPIRATORY WORKFLOW and
// longitudinal follow-up. DETERMINISTIC, read-only, OPERATIONAL only — same
// guarantees as the GP reference (Phase 16) and every specialty extension since.
// It EXTENDS and REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses, interprets an investigation (spirometry / PFT / chest
// X-ray / CT / bronchoscopy / sleep study), classifies COPD / asthma / fibrosis /
// pneumonia, recommends a treatment or a medication, or predicts deterioration.
// It only SURFACES that a respiratory event or a test exists and its workflow
// status (planned / active / awaiting review / follow-up due). Emits only codes /
// counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const PULM_COPILOT_PACK_ID = 'pulmonology.core'
export const PULM_SPECIALTIES = ['pulmonology'] as const

/** Active for a doctor whose primary specialty is Pulmonology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isPulmonologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'pulmonology'
}

// ── Pulmonology event vocabulary ────────────────────────────────────
// Tracker events — workflow: planned → active → awaiting_review / follow_up_due → completed.
export const PULM_EVENT_TYPES = [
  'pulmonary_consultation', 'oxygen_assessment', 'pulmonary_rehab_referral', 'smoking_cessation', 'post_discharge_review',
] as const
export type PulmEventType = (typeof PULM_EVENT_TYPES)[number]

// Tests / imaging — workflow: ordered → completed → awaiting_review → reviewed.
export const PULM_TEST_TYPES = [
  'chest_xray', 'chest_ct', 'pulmonary_function_test', 'spirometry', 'bronchoscopy', 'sleep_study',
] as const
export type PulmTestType = (typeof PULM_TEST_TYPES)[number]

export const PULM_ALL_TYPES = [...PULM_EVENT_TYPES, ...PULM_TEST_TYPES] as const
export type PulmAllType = (typeof PULM_ALL_TYPES)[number]

export const PULM_EVENT_STATUSES = [
  'planned', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type PulmEventStatus = (typeof PULM_EVENT_STATUSES)[number]

export type PulmCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(PULM_EVENT_TYPES)
const TEST_SET = new Set<string>(PULM_TEST_TYPES)

export function isPulmEventType(v: unknown): v is PulmAllType {
  return typeof v === 'string' && (PULM_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): PulmCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface PulmEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Respiratory event tracker (counts only — NEVER interpret) ──────
export interface PulmTrackingRow {
  eventType: PulmEventType
  planned: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'active', 'awaiting_review', 'follow_up_due'])

export function buildPulmTracker(events: PulmEvent[] | null | undefined): PulmTrackingRow[] {
  const list = events ?? []
  return PULM_EVENT_TYPES.map(eventType => {
    const inType = list.filter(e => e.eventType === eventType)
    return {
      eventType,
      planned: inType.filter(e => e.status === 'planned').length,
      active: inType.filter(e => e.status === 'active').length,
      completed: inType.filter(e => e.status === 'completed').length,
      awaitingReview: inType.filter(e => e.status === 'awaiting_review').length,
      followUpDue: inType.filter(e => e.status === 'follow_up_due').length,
      total: inType.filter(e => EVENT_OPEN.has(e.status)).length,
    }
  })
}

// ── Imaging / test workflow (counts only — NEVER interpret) ────────
export interface TestTrackingRow {
  testType: PulmTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: PulmEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return PULM_TEST_TYPES.map(testType => {
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
export interface PulmReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildPulmFollowUp(events: PulmEvent[] | null | undefined): { reminders: PulmReminder[] } {
  const list = events ?? []
  const reminders: PulmReminder[] = []

  const tracking = buildPulmTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'pulm_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'pulm_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'pulm_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'pulm_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary imaging signals (counts only — NEVER interpret) ──
// Surfaces that respiratory investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the finding — no COPD / asthma / fibrosis /
// pneumonia call.
const IMAGING_RE = /chest x-?ray|chest ct|thorax|spirometr|pulmonary function|\bpft\b|bronchoscop|sleep study|polysomnograph|\bdlco\b|respiratory function/i
export interface PulmImagingSignals { pending: number; completed: number; imaging: number }
export function countPulmImagingSignals(labOrders?: LabOrder[] | null): PulmImagingSignals {
  const orders = labOrders ?? []
  const isImaging = (o: LabOrder) => IMAGING_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => IMAGING_RE.test(i.test_name ?? ''))
  const imaging = orders.filter(isImaging)
  return {
    pending: imaging.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: imaging.filter(o => o.status === 'completed').length,
    imaging: imaging.length,
  }
}

// ── Documentation completeness (reuses GP + pulmonology prompts) ───
export interface PulmCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computePulmCompleteness(doc: ConsultationDoc): PulmCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'pulm_doc_chief_complaint', 'pulm_doc_dyspnea', 'pulm_doc_cough', 'pulm_doc_smoking',
    'pulm_doc_occupational', 'pulm_doc_oxygen_use', 'pulm_doc_exercise_tolerance', 'pulm_doc_respiratory_exam',
    'pulm_doc_investigations', 'pulm_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with pulmonology counts) ───
export interface PulmSummary {
  recentEvents: number
  pendingTests: number
  awaitingTests: number
  bronchoscopy: number
  oxygenFollowUp: number
  rehabReferrals: number
  upcomingFollowUp: number
  medications: number
}
export interface PulmBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: PulmTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: PulmImagingSignals
  followUp: ReturnType<typeof buildPulmFollowUp>
  followUps: FollowUpItem[]
  summary: PulmSummary
}
export function buildPulmBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: PulmEvent[]
  imagingSignals: PulmImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): PulmBrief {
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
  const tracker = buildPulmTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: PulmSummary = {
    recentEvents: tracker.reduce((s, r) => s + r.total, 0),
    pendingTests: tests.reduce((s, r) => s + r.ordered, 0),
    awaitingTests: tests.reduce((s, r) => s + r.awaitingReview, 0),
    bronchoscopy: openTest('bronchoscopy'),
    oxygenFollowUp: openEvent('oxygen_assessment'),
    rehabReferrals: openEvent('pulmonary_rehab_referral'),
    upcomingFollowUp: tracker.reduce((s, r) => s + r.followUpDue, 0),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildPulmFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type PulmAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type PulmConsultations = Consultation[]

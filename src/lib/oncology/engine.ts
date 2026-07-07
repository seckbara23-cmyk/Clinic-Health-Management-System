// ── Oncology Clinical Copilot — pure engine (Phase 30) ─────────────
//
// The THIRTEENTH production Copilot, focused on CANCER-CARE WORKFLOW,
// CONTINUITY OF CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only,
// OPERATIONAL only — same guarantees as the GP reference (Phase 16) and every
// specialty extension since. It EXTENDS and REUSES the GP engine; it does NOT
// duplicate it. It is NOT a clinical decision system.
//
// It NEVER: diagnoses cancer, interprets pathology / biopsy / PET / CT / MRI,
// stages or grades a cancer or assigns TNM, recommends chemotherapy /
// radiotherapy / immunotherapy / surgery / a treatment / a medication, predicts
// survival / recurrence / prognosis, or recommends palliative care. It only
// SURFACES that an oncology event or a pathology/imaging test exists and its
// workflow status (planned / active / awaiting review / follow-up due). Emits
// only codes / counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const ONCO_COPILOT_PACK_ID = 'oncology.core'
export const ONCO_SPECIALTIES = ['oncology'] as const

/** Active for a doctor whose primary specialty is Oncology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isOncologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'oncology'
}

// ── Oncology event vocabulary ───────────────────────────────────────
// Tracker events — workflow: planned → active → awaiting_review / follow_up_due → completed.
export const ONCO_EVENT_TYPES = [
  'oncology_consultation', 'chemotherapy_cycle', 'immunotherapy_cycle', 'radiotherapy_session',
  'tumor_board_review', 'pathology_review', 'biopsy_followup', 'survivorship_visit',
  'palliative_support_review', 'nutrition_consultation',
] as const
export type OncoEventType = (typeof ONCO_EVENT_TYPES)[number]

// Pathology / imaging tests — workflow: ordered → completed → awaiting_review → reviewed.
export const ONCO_TEST_TYPES = [
  'pathology', 'biopsy', 'pet', 'ct', 'mri', 'ultrasound', 'bone_scan', 'laboratory_readiness',
] as const
export type OncoTestType = (typeof ONCO_TEST_TYPES)[number]

export const ONCO_ALL_TYPES = [...ONCO_EVENT_TYPES, ...ONCO_TEST_TYPES] as const
export type OncoAllType = (typeof ONCO_ALL_TYPES)[number]

export const ONCO_EVENT_STATUSES = [
  'planned', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type OncoEventStatus = (typeof ONCO_EVENT_STATUSES)[number]

export type OncoCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(ONCO_EVENT_TYPES)
const TEST_SET = new Set<string>(ONCO_TEST_TYPES)

export function isOncoEventType(v: unknown): v is OncoAllType {
  return typeof v === 'string' && (ONCO_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): OncoCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface OncoEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Oncology event tracker (counts only — NEVER interpret) ─────────
export interface OncoTrackingRow {
  eventType: OncoEventType
  planned: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'active', 'awaiting_review', 'follow_up_due'])

export function buildOncoTracker(events: OncoEvent[] | null | undefined): OncoTrackingRow[] {
  const list = events ?? []
  return ONCO_EVENT_TYPES.map(eventType => {
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

// ── Pathology / imaging workflow (counts only — NEVER interpret) ───
export interface TestTrackingRow {
  testType: OncoTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: OncoEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return ONCO_TEST_TYPES.map(testType => {
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
export interface OncoReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildOncoFollowUp(events: OncoEvent[] | null | undefined): { reminders: OncoReminder[] } {
  const list = events ?? []
  const reminders: OncoReminder[] = []

  const tracking = buildOncoTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'onco_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'onco_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'onco_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'onco_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary pathology / imaging signals (counts only — NEVER interpret) ─
// Surfaces that oncology investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the finding — no diagnosis, no staging, no
// grading, no TNM, no metastasis interpretation.
const ONCO_RE = /patholog|histolog|cytolog|biops|\bpet\b|pet-?ct|\bct\b|scanner|\bmri\b|\birm\b|ultrasound|echograph|bone scan|scintigraph|tumor mark|\bcea\b|\bca ?125\b|\bpsa\b|\bafp\b/i
export interface OncoImagingSignals { pending: number; completed: number; investigations: number }
export function countOncoImagingSignals(labOrders?: LabOrder[] | null): OncoImagingSignals {
  const orders = labOrders ?? []
  const isOnco = (o: LabOrder) => ONCO_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => ONCO_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isOnco)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + oncology prompts) ──────
export interface OncoCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeOncoCompleteness(doc: ConsultationDoc): OncoCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'onco_doc_history', 'onco_doc_previous_treatment', 'onco_doc_treatment_timeline', 'onco_doc_performance_status',
    'onco_doc_symptom_review', 'onco_doc_tolerance', 'onco_doc_pathology_followup', 'onco_doc_imaging_followup',
    'onco_doc_mdt', 'onco_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with oncology counts) ──────
export interface OncoSummary {
  activeWorkflow: number
  pendingPathology: number
  pendingBiopsy: number
  pendingImaging: number
  chemoWorkflow: number
  radiotherapy: number
  mdt: number
  survivorship: number
  medications: number
}
export interface OncoBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: OncoTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: OncoImagingSignals
  followUp: ReturnType<typeof buildOncoFollowUp>
  followUps: FollowUpItem[]
  summary: OncoSummary
}
export function buildOncoBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: OncoEvent[]
  imagingSignals: OncoImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): OncoBrief {
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
  const tracker = buildOncoTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: OncoSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    pendingPathology: openTest('pathology') + openEvent('pathology_review'),
    pendingBiopsy: openTest('biopsy') + openEvent('biopsy_followup'),
    pendingImaging: openTest('pet') + openTest('ct') + openTest('mri') + openTest('ultrasound') + openTest('bone_scan'),
    chemoWorkflow: openEvent('chemotherapy_cycle') + openEvent('immunotherapy_cycle'),
    radiotherapy: openEvent('radiotherapy_session'),
    mdt: openEvent('tumor_board_review'),
    survivorship: openEvent('survivorship_visit'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildOncoFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type OncoAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type OncoConsultations = Consultation[]

// ── Gastroenterology Clinical Copilot — pure engine (Phase 36) ────
//
// The NINETEENTH production Copilot, focused on GASTROENTEROLOGY (GI) WORKFLOW,
// CONTINUITY OF CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only,
// OPERATIONAL only — same guarantees as the GP reference (Phase 16) and every
// specialty extension since. It EXTENDS and REUSES the GP engine; it does NOT
// duplicate it. It is NOT a clinical decision system.
//
// It NEVER: diagnoses, interprets endoscopy / colonoscopy / gastroscopy /
// pathology / biopsy, classifies liver disease or IBD, recommends a treatment /
// medication / surgery, or predicts cancer / risk / prognosis. It only SURFACES
// that a GI event or an investigation exists and its workflow status (planned /
// scheduled / active / awaiting review / follow-up due). Emits only codes / counts
// / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const GI_COPILOT_PACK_ID = 'gastroenterology.core'
export const GI_SPECIALTIES = ['gastroenterology'] as const

/** Active for a doctor whose primary specialty is Gastroenterology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isGastroenterologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'gastroenterology'
}

// ── Gastroenterology event vocabulary ───────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const GI_EVENT_TYPES = [
  'gi_consultation', 'endoscopy_followup', 'colonoscopy_followup', 'gastroscopy_followup', 'biopsy_followup',
  'pathology_review', 'liver_clinic_followup', 'ibd_followup', 'nutrition_referral', 'postoperative_followup',
  'discharge_followup',
] as const
export type GiEventType = (typeof GI_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
export const GI_TEST_TYPES = [
  'endoscopy', 'colonoscopy', 'gastroscopy', 'abdominal_ultrasound', 'abdominal_ct', 'abdominal_mri',
  'liver_panel', 'stool_test', 'biopsy', 'pathology',
] as const
export type GiTestType = (typeof GI_TEST_TYPES)[number]

// Imaging subset (the remaining tests are endoscopic / laboratory / pathology).
const IMAGING_TESTS = new Set<string>(['abdominal_ultrasound', 'abdominal_ct', 'abdominal_mri'])
const ENDOSCOPY_TESTS = new Set<string>(['endoscopy', 'colonoscopy', 'gastroscopy'])
const PATHOLOGY_TESTS = new Set<string>(['biopsy', 'pathology'])

export const GI_ALL_TYPES = [...GI_EVENT_TYPES, ...GI_TEST_TYPES] as const
export type GiAllType = (typeof GI_ALL_TYPES)[number]

export const GI_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type GiEventStatus = (typeof GI_EVENT_STATUSES)[number]

export type GiCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(GI_EVENT_TYPES)
const TEST_SET = new Set<string>(GI_TEST_TYPES)

export function isGiEventType(v: unknown): v is GiAllType {
  return typeof v === 'string' && (GI_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): GiCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface GiEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── GI event tracker (counts only — NEVER interpret) ───────────────
export interface GiTrackingRow {
  eventType: GiEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildGiTracker(events: GiEvent[] | null | undefined): GiTrackingRow[] {
  const list = events ?? []
  return GI_EVENT_TYPES.map(eventType => {
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
  testType: GiTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: GiEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return GI_TEST_TYPES.map(testType => {
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
export interface GiReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildGiFollowUp(events: GiEvent[] | null | undefined): { reminders: GiReminder[] } {
  const list = events ?? []
  const reminders: GiReminder[] = []

  const tracking = buildGiTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'gi_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'gi_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'gi_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'gi_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'gi_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that GI investigations exist in the EXISTING lab_orders and whether they
// are completed. Never the finding — no diagnosis, no classification of liver / IBD,
// no interpretation of endoscopy / colonoscopy / gastroscopy / pathology / biopsy.
const GI_RE = /endoscop|colonoscop|gastroscop|\begd\b|abdominal ultrasound|abdominal us|abdominal ct|abdominal mri|liver panel|liver function|\blft\b|stool|fobt|faecal|fecal|calprotectin|\bbiopsy\b|histopatholog|patholog/i
export interface GiImagingSignals { pending: number; completed: number; investigations: number }
export function countGiImagingSignals(labOrders?: LabOrder[] | null): GiImagingSignals {
  const orders = labOrders ?? []
  const isGi = (o: LabOrder) => GI_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => GI_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isGi)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + gastroenterology prompts) ─
export interface GiCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeGiCompleteness(doc: ConsultationDoc): GiCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'gi_doc_gi_complaint', 'gi_doc_abdominal_symptoms', 'gi_doc_bowel_history', 'gi_doc_liver_history',
    'gi_doc_nutrition_review', 'gi_doc_procedure_history', 'gi_doc_pathology_followup', 'gi_doc_imaging_followup',
    'gi_doc_medication_review', 'gi_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with GI counts) ────────────
export interface GiSummary {
  activeWorkflow: number
  pendingEndoscopy: number
  pendingPathology: number
  pendingImaging: number
  liverIbd: number
  nutrition: number
  discharge: number
  medications: number
}
export interface GiBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: GiTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: GiImagingSignals
  followUp: ReturnType<typeof buildGiFollowUp>
  followUps: FollowUpItem[]
  summary: GiSummary
}
export function buildGiBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: GiEvent[]
  imagingSignals: GiImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): GiBrief {
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
  const tracker = buildGiTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const summary: GiSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    pendingEndoscopy: tests.filter(r => ENDOSCOPY_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0) + openEvent('endoscopy_followup') + openEvent('colonoscopy_followup') + openEvent('gastroscopy_followup'),
    pendingPathology: tests.filter(r => PATHOLOGY_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0) + openEvent('biopsy_followup') + openEvent('pathology_review'),
    pendingImaging: tests.filter(r => IMAGING_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    liverIbd: openEvent('liver_clinic_followup') + openEvent('ibd_followup'),
    nutrition: openEvent('nutrition_referral'),
    discharge: openEvent('discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildGiFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type GiAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type GiConsultations = Consultation[]

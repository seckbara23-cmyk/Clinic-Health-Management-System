// ── General Surgery Clinical Copilot — pure engine (Phase 31) ──────
//
// The FOURTEENTH production Copilot, focused on SURGICAL WORKFLOW, CONTINUITY OF
// CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and every specialty extension
// since. It EXTENDS and REUSES the GP engine; it does NOT duplicate it. It is NOT
// a clinical decision system.
//
// It NEVER: diagnoses, recommends surgery / conservative management / a
// medication / an antibiotic / admission / discharge / ICU / an operative
// technique / anaesthesia / a transfusion, interprets pathology / CT / MRI /
// X-ray / endoscopy, predicts complications / mortality / surgical success, or
// calculates ASA / POSSUM / APACHE. It only SURFACES that a surgical event or an
// investigation exists and its workflow status (planned / scheduled / active /
// awaiting review / follow-up due). Emits only codes / counts / labelKeys → it
// cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const SURGERY_COPILOT_PACK_ID = 'surgery.core'
export const SURGERY_SPECIALTIES = ['general_surgery'] as const

/** Active for a doctor whose primary specialty is (general) surgery. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. The
 *  'surgery' alias is accepted for forward-compatibility with the taxonomy. */
export function isSurgeryContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && (primarySpecialtyId === 'general_surgery' || primarySpecialtyId === 'surgery')
}

// ── Surgical event vocabulary ───────────────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const SURGERY_EVENT_TYPES = [
  'surgical_consultation', 'preop_assessment', 'preop_checklist', 'or_scheduling', 'surgery_scheduled',
  'surgery_completed', 'postop_review', 'wound_review', 'drain_review', 'suture_removal',
  'pathology_specimen_sent', 'pathology_review', 'icu_followup', 'ward_followup', 'discharge_followup',
] as const
export type SurgeryEventType = (typeof SURGERY_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
export const SURGERY_TEST_TYPES = [
  'ct', 'mri', 'ultrasound', 'xray', 'endoscopy', 'colonoscopy', 'gastroscopy', 'pathology', 'laboratory_readiness',
] as const
export type SurgeryTestType = (typeof SURGERY_TEST_TYPES)[number]

export const SURGERY_ALL_TYPES = [...SURGERY_EVENT_TYPES, ...SURGERY_TEST_TYPES] as const
export type SurgeryAllType = (typeof SURGERY_ALL_TYPES)[number]

export const SURGERY_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type SurgeryEventStatus = (typeof SURGERY_EVENT_STATUSES)[number]

export type SurgeryCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(SURGERY_EVENT_TYPES)
const TEST_SET = new Set<string>(SURGERY_TEST_TYPES)

export function isSurgeryEventType(v: unknown): v is SurgeryAllType {
  return typeof v === 'string' && (SURGERY_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): SurgeryCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface SurgeryEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Surgical event tracker (counts only — NEVER interpret) ─────────
export interface SurgeryTrackingRow {
  eventType: SurgeryEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildSurgeryTracker(events: SurgeryEvent[] | null | undefined): SurgeryTrackingRow[] {
  const list = events ?? []
  return SURGERY_EVENT_TYPES.map(eventType => {
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

// ── Investigation workflow (counts only — NEVER interpret) ─────────
export interface TestTrackingRow {
  testType: SurgeryTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: SurgeryEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return SURGERY_TEST_TYPES.map(testType => {
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
export interface SurgeryReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildSurgeryFollowUp(events: SurgeryEvent[] | null | undefined): { reminders: SurgeryReminder[] } {
  const list = events ?? []
  const reminders: SurgeryReminder[] = []

  const tracking = buildSurgeryTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'surg_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'surg_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'surg_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'surg_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'surg_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that surgery-relevant investigations exist in the EXISTING lab_orders
// and whether they are completed. Never the finding — no diagnosis, no
// interpretation of pathology / CT / MRI / X-ray / endoscopy.
const SURGERY_RE = /\bct\b|scanner|\bmri\b|\birm\b|ultrasound|echograph|\bx-?ray\b|radiograph|endoscop|colonoscop|gastroscop|patholog|histolog|cytolog|biops/i
export interface SurgeryImagingSignals { pending: number; completed: number; investigations: number }
export function countSurgeryImagingSignals(labOrders?: LabOrder[] | null): SurgeryImagingSignals {
  const orders = labOrders ?? []
  const isSurg = (o: LabOrder) => SURGERY_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => SURGERY_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isSurg)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + surgery prompts) ───────
export interface SurgeryCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeSurgeryCompleteness(doc: ConsultationDoc): SurgeryCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'surg_doc_indication', 'surg_doc_surgical_history', 'surg_doc_operative_findings', 'surg_doc_wound_status',
    'surg_doc_drain_status', 'surg_doc_pathology_followup', 'surg_doc_discharge_planning', 'surg_doc_complications',
    'surg_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with surgery counts) ───────
export interface SurgerySummary {
  activeWorkflow: number
  scheduledSurgery: number
  postopReviews: number
  woundDrain: number
  pendingPathology: number
  pendingInvestigations: number
  icuWard: number
  discharge: number
  medications: number
}
export interface SurgeryBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: SurgeryTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: SurgeryImagingSignals
  followUp: ReturnType<typeof buildSurgeryFollowUp>
  followUps: FollowUpItem[]
  summary: SurgerySummary
}
export function buildSurgeryBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: SurgeryEvent[]
  imagingSignals: SurgeryImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): SurgeryBrief {
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
  const tracker = buildSurgeryTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: SurgerySummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    scheduledSurgery: openEvent('surgery_scheduled') + openEvent('or_scheduling'),
    postopReviews: openEvent('postop_review'),
    woundDrain: openEvent('wound_review') + openEvent('drain_review') + openEvent('suture_removal'),
    pendingPathology: openTest('pathology') + openEvent('pathology_review') + openEvent('pathology_specimen_sent'),
    pendingInvestigations: openTest('ct') + openTest('mri') + openTest('ultrasound') + openTest('xray') + openTest('endoscopy') + openTest('colonoscopy') + openTest('gastroscopy'),
    icuWard: openEvent('icu_followup') + openEvent('ward_followup'),
    discharge: openEvent('discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildSurgeryFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type SurgeryAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type SurgeryConsultations = Consultation[]

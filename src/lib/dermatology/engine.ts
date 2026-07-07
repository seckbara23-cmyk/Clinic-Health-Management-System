// ── Dermatology Clinical Copilot — pure engine (Phase 34) ─────────
//
// The SEVENTEENTH production Copilot, focused on DERMATOLOGY WORKFLOW, CONTINUITY
// OF CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only, OPERATIONAL only
// — same guarantees as the GP reference (Phase 16) and every specialty extension
// since. It EXTENDS and REUSES the GP engine; it does NOT duplicate it. It is NOT a
// clinical decision system.
//
// It NEVER: diagnoses skin disease, classifies melanoma / eczema / psoriasis /
// dermatitis, interprets dermoscopy / pathology / biopsy, recommends a biopsy /
// surgery / a medication / a topical / an antibiotic / an antifungal, predicts
// malignancy / recurrence, or calculates melanoma scores. It only SURFACES that a
// dermatology event or an investigation exists and its workflow status (planned /
// scheduled / active / awaiting review / follow-up due). Emits only codes / counts /
// labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const DERM_COPILOT_PACK_ID = 'dermatology.core'
export const DERM_SPECIALTIES = ['dermatology'] as const

/** Active for a doctor whose primary specialty is Dermatology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isDermatologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'dermatology'
}

// ── Dermatology event vocabulary ────────────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const DERM_EVENT_TYPES = [
  'dermatology_consultation', 'skin_lesion_followup', 'mole_followup', 'skin_biopsy_followup',
  'histopathology_review', 'cryotherapy_followup', 'dermatologic_procedure_followup', 'wound_review',
  'dressing_review', 'suture_removal', 'patch_testing', 'phototherapy_review', 'skin_photography_review',
  'dermatologic_surgery_followup', 'hospital_discharge_followup',
] as const
export type DermEventType = (typeof DERM_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
// `patch_test` is the investigation; `patch_testing` (above) is the workflow event
// — distinct ids so the two tracks never collide.
export const DERM_TEST_TYPES = [
  'skin_biopsy', 'histopathology', 'dermoscopy', 'skin_photography', 'patch_test', 'fungal_microscopy', 'culture',
] as const
export type DermTestType = (typeof DERM_TEST_TYPES)[number]

export const DERM_ALL_TYPES = [...DERM_EVENT_TYPES, ...DERM_TEST_TYPES] as const
export type DermAllType = (typeof DERM_ALL_TYPES)[number]

export const DERM_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type DermEventStatus = (typeof DERM_EVENT_STATUSES)[number]

export type DermCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(DERM_EVENT_TYPES)
const TEST_SET = new Set<string>(DERM_TEST_TYPES)

export function isDermEventType(v: unknown): v is DermAllType {
  return typeof v === 'string' && (DERM_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): DermCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface DermEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Dermatology event tracker (counts only — NEVER interpret) ──────
export interface DermTrackingRow {
  eventType: DermEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildDermTracker(events: DermEvent[] | null | undefined): DermTrackingRow[] {
  const list = events ?? []
  return DERM_EVENT_TYPES.map(eventType => {
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
  testType: DermTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: DermEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return DERM_TEST_TYPES.map(testType => {
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
export interface DermReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildDermFollowUp(events: DermEvent[] | null | undefined): { reminders: DermReminder[] } {
  const list = events ?? []
  const reminders: DermReminder[] = []

  const tracking = buildDermTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'derm_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'derm_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'derm_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'derm_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'derm_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that dermatology investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the finding — no diagnosis, no classification
// of a lesion, no interpretation of dermoscopy / pathology / biopsy.
const DERM_RE = /skin biops|punch biops|shave biops|\bbiopsy\b|histopatholog|dermatopatholog|dermoscop|dermatoscop|skin photograph|patch test|fungal|mycolog|\bkoh\b|culture/i
export interface DermImagingSignals { pending: number; completed: number; investigations: number }
export function countDermImagingSignals(labOrders?: LabOrder[] | null): DermImagingSignals {
  const orders = labOrders ?? []
  const isDerm = (o: LabOrder) => DERM_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => DERM_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isDerm)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + dermatology prompts) ───
export interface DermCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeDermCompleteness(doc: ConsultationDoc): DermCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'derm_doc_skin_complaint', 'derm_doc_lesion_history', 'derm_doc_lesion_distribution', 'derm_doc_associated_symptoms',
    'derm_doc_previous_treatments', 'derm_doc_examination', 'derm_doc_procedure_performed', 'derm_doc_pathology_followup',
    'derm_doc_wound_care', 'derm_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with dermatology counts) ───
export interface DermSummary {
  activeWorkflow: number
  pendingPathology: number
  pendingProcedures: number
  woundCare: number
  phototherapy: number
  patchTesting: number
  discharge: number
  medications: number
}
export interface DermBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: DermTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: DermImagingSignals
  followUp: ReturnType<typeof buildDermFollowUp>
  followUps: FollowUpItem[]
  summary: DermSummary
}
export function buildDermBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: DermEvent[]
  imagingSignals: DermImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): DermBrief {
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
  const tracker = buildDermTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: DermSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    pendingPathology: openTest('histopathology') + openTest('skin_biopsy') + openEvent('histopathology_review') + openEvent('skin_biopsy_followup'),
    pendingProcedures: openEvent('dermatologic_procedure_followup') + openEvent('cryotherapy_followup') + openEvent('dermatologic_surgery_followup'),
    woundCare: openEvent('wound_review') + openEvent('dressing_review') + openEvent('suture_removal'),
    phototherapy: openEvent('phototherapy_review'),
    patchTesting: openTest('patch_test') + openEvent('patch_testing'),
    discharge: openEvent('hospital_discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildDermFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type DermAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type DermConsultations = Consultation[]

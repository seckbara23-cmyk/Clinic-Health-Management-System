// ── Nephrology Clinical Copilot — pure engine (Phase 29) ───────────
//
// The TWELFTH production Copilot, focused on KIDNEY-CARE WORKFLOW and
// longitudinal follow-up. DETERMINISTIC, read-only, OPERATIONAL only — same
// guarantees as the GP reference (Phase 16) and every specialty extension since.
// It EXTENDS and REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses, classifies a CKD stage, classifies AKI / nephrotic
// syndrome, interprets a laboratory value (creatinine / eGFR / urinalysis /
// protein …), recommends dialysis / a treatment / a medication, or predicts
// renal failure. It only SURFACES that a nephrology event or a lab/imaging test
// exists and its workflow status (planned / active / awaiting review / follow-up
// due). Emits only codes / counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const NEPHRO_COPILOT_PACK_ID = 'nephrology.core'
export const NEPHRO_SPECIALTIES = ['nephrology'] as const

/** Active for a doctor whose primary specialty is Nephrology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isNephrologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'nephrology'
}

// ── Nephrology event vocabulary ─────────────────────────────────────
// Tracker events — workflow: planned → active → awaiting_review / follow_up_due → completed.
export const NEPHRO_EVENT_TYPES = [
  'nephrology_consultation', 'dialysis_session', 'dialysis_review', 'transplant_review',
  'nutrition_referral', 'ckd_clinic_followup', 'hypertension_review', 'post_discharge_review',
] as const
export type NephroEventType = (typeof NEPHRO_EVENT_TYPES)[number]

// Laboratory / imaging tests — workflow: ordered → completed → awaiting_review → reviewed.
export const NEPHRO_TEST_TYPES = [
  'creatinine', 'egfr', 'urinalysis', 'urine_protein', 'albumin', 'electrolytes',
  'renal_ultrasound', 'kidney_ct', 'kidney_mri', 'kidney_biopsy',
] as const
export type NephroTestType = (typeof NEPHRO_TEST_TYPES)[number]

export const NEPHRO_ALL_TYPES = [...NEPHRO_EVENT_TYPES, ...NEPHRO_TEST_TYPES] as const
export type NephroAllType = (typeof NEPHRO_ALL_TYPES)[number]

export const NEPHRO_EVENT_STATUSES = [
  'planned', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type NephroEventStatus = (typeof NEPHRO_EVENT_STATUSES)[number]

export type NephroCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(NEPHRO_EVENT_TYPES)
const TEST_SET = new Set<string>(NEPHRO_TEST_TYPES)

export function isNephroEventType(v: unknown): v is NephroAllType {
  return typeof v === 'string' && (NEPHRO_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): NephroCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface NephroEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Nephrology event tracker (counts only — NEVER interpret) ───────
export interface NephroTrackingRow {
  eventType: NephroEventType
  planned: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'active', 'awaiting_review', 'follow_up_due'])

export function buildNephroTracker(events: NephroEvent[] | null | undefined): NephroTrackingRow[] {
  const list = events ?? []
  return NEPHRO_EVENT_TYPES.map(eventType => {
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

// ── Laboratory / imaging workflow (counts only — NEVER interpret) ──
export interface TestTrackingRow {
  testType: NephroTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: NephroEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return NEPHRO_TEST_TYPES.map(testType => {
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
export interface NephroReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildNephroFollowUp(events: NephroEvent[] | null | undefined): { reminders: NephroReminder[] } {
  const list = events ?? []
  const reminders: NephroReminder[] = []

  const tracking = buildNephroTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'nephro_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'nephro_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'nephro_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'nephro_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary lab / imaging signals (counts only — NEVER interpret) ─
// Surfaces that renal investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the value or its meaning — no CKD / AKI /
// nephrotic-syndrome call.
const RENAL_RE = /creatinin|\begfr\b|\bgfr\b|urinalysis|urine (protein|albumin)|proteinuria|albuminuria|\bacr\b|microalbumin|electrolyt|renal (ultrasound|function)|kidney (ct|mri|biops|ultrasound|scan)|\bbun\b|urea/i
export interface NephroLabSignals { pending: number; completed: number; renal: number }
export function countNephroLabSignals(labOrders?: LabOrder[] | null): NephroLabSignals {
  const orders = labOrders ?? []
  const isRenal = (o: LabOrder) => RENAL_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => RENAL_RE.test(i.test_name ?? ''))
  const renal = orders.filter(isRenal)
  return {
    pending: renal.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: renal.filter(o => o.status === 'completed').length,
    renal: renal.length,
  }
}

// ── Documentation completeness (reuses GP + nephrology prompts) ────
export interface NephroCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeNephroCompleteness(doc: ConsultationDoc): NephroCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'nephro_doc_renal_history', 'nephro_doc_dialysis_history', 'nephro_doc_transplant_history',
    'nephro_doc_urinary_symptoms', 'nephro_doc_blood_pressure', 'nephro_doc_fluid_status',
    'nephro_doc_nutrition', 'nephro_doc_lab_followup', 'nephro_doc_imaging', 'nephro_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with nephrology counts) ────
export interface NephroSummary {
  recentEvents: number
  dialysis: number
  biopsy: number
  renalImaging: number
  pendingLabs: number
  transplant: number
  nutritionReferral: number
  upcomingFollowUp: number
  medications: number
}
export interface NephroBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: NephroTrackingRow[]
  tests: TestTrackingRow[]
  labSignals: NephroLabSignals
  followUp: ReturnType<typeof buildNephroFollowUp>
  followUps: FollowUpItem[]
  summary: NephroSummary
}
export function buildNephroBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: NephroEvent[]
  labSignals: NephroLabSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): NephroBrief {
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
  const tracker = buildNephroTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: NephroSummary = {
    recentEvents: tracker.reduce((s, r) => s + r.total, 0),
    dialysis: openEvent('dialysis_session') + openEvent('dialysis_review'),
    biopsy: openTest('kidney_biopsy'),
    renalImaging: openTest('renal_ultrasound') + openTest('kidney_ct') + openTest('kidney_mri'),
    pendingLabs: tests.filter(r => (['creatinine', 'egfr', 'urinalysis', 'urine_protein', 'albumin', 'electrolytes'] as string[]).includes(r.testType)).reduce((s, r) => s + r.ordered + r.awaitingReview, 0),
    transplant: openEvent('transplant_review'),
    nutritionReferral: openEvent('nutrition_referral'),
    upcomingFollowUp: tracker.reduce((s, r) => s + r.followUpDue, 0),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, labSignals: input.labSignals, followUp: buildNephroFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type NephroAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type NephroConsultations = Consultation[]

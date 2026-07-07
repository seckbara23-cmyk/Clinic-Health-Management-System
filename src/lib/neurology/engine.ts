// ── Neurology Clinical Copilot — pure engine (Phase 32) ───────────
//
// The FIFTEENTH production Copilot, focused on NEUROLOGY WORKFLOW, CONTINUITY OF
// CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and every specialty extension
// since. It EXTENDS and REUSES the GP engine; it does NOT duplicate it. It is NOT
// a clinical decision system.
//
// It NEVER: diagnoses, classifies stroke / seizure / headache, interprets EEG /
// EMG / MRI / CT / lumbar puncture, recommends thrombolysis / thrombectomy /
// surgery / a medication / admission / discharge / rehabilitation, predicts
// recovery / disability / mortality, or calculates NIHSS / Modified Rankin /
// Glasgow Coma Scale / seizure risk. It only SURFACES that a neurology event or an
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

export const NEURO_COPILOT_PACK_ID = 'neurology.core'
export const NEURO_SPECIALTIES = ['neurology'] as const

/** Active for a doctor whose primary specialty is Neurology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isNeurologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'neurology'
}

// ── Neurology event vocabulary ──────────────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const NEURO_EVENT_TYPES = [
  'neurology_consultation', 'stroke_clinic_followup', 'epilepsy_clinic_followup', 'headache_clinic_followup',
  'neurodegenerative_review', 'eeg_ordered', 'eeg_review', 'emg_ncs_ordered', 'emg_ncs_review',
  'lumbar_puncture_followup', 'rehabilitation_referral', 'rehabilitation_followup', 'neuropsychology_referral',
  'neuropsychology_review', 'hospital_discharge_followup',
] as const
export type NeuroEventType = (typeof NEURO_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
export const NEURO_TEST_TYPES = [
  'brain_ct', 'brain_mri', 'spine_mri', 'eeg', 'emg', 'nerve_conduction', 'lumbar_puncture',
  'neuropsychology_assessment', 'laboratory_readiness',
] as const
export type NeuroTestType = (typeof NEURO_TEST_TYPES)[number]

export const NEURO_ALL_TYPES = [...NEURO_EVENT_TYPES, ...NEURO_TEST_TYPES] as const
export type NeuroAllType = (typeof NEURO_ALL_TYPES)[number]

export const NEURO_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type NeuroEventStatus = (typeof NEURO_EVENT_STATUSES)[number]

export type NeuroCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(NEURO_EVENT_TYPES)
const TEST_SET = new Set<string>(NEURO_TEST_TYPES)

export function isNeuroEventType(v: unknown): v is NeuroAllType {
  return typeof v === 'string' && (NEURO_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): NeuroCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface NeuroEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Neurology event tracker (counts only — NEVER interpret) ────────
export interface NeuroTrackingRow {
  eventType: NeuroEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildNeuroTracker(events: NeuroEvent[] | null | undefined): NeuroTrackingRow[] {
  const list = events ?? []
  return NEURO_EVENT_TYPES.map(eventType => {
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
  testType: NeuroTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: NeuroEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return NEURO_TEST_TYPES.map(testType => {
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
export interface NeuroReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildNeuroFollowUp(events: NeuroEvent[] | null | undefined): { reminders: NeuroReminder[] } {
  const list = events ?? []
  const reminders: NeuroReminder[] = []

  const tracking = buildNeuroTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'neuro_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'neuro_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'neuro_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'neuro_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'neuro_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that neurology-relevant investigations exist in the EXISTING lab_orders
// and whether they are completed. Never the finding — no diagnosis, no
// classification of stroke / seizure / headache, no interpretation of EEG / EMG /
// MRI / CT / lumbar puncture.
const NEURO_RE = /\bbrain ct\b|\bhead ct\b|\bct\b|scanner|\bmri\b|\birm\b|\beeg\b|electroencephalogr|\bemg\b|electromyogr|nerve conduction|\bncs\b|lumbar puncture|neuropsycholog/i
export interface NeuroImagingSignals { pending: number; completed: number; investigations: number }
export function countNeuroImagingSignals(labOrders?: LabOrder[] | null): NeuroImagingSignals {
  const orders = labOrders ?? []
  const isNeuro = (o: LabOrder) => NEURO_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => NEURO_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isNeuro)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + neurology prompts) ─────
export interface NeuroCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeNeuroCompleteness(doc: ConsultationDoc): NeuroCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'neuro_doc_presenting_complaint', 'neuro_doc_symptom_onset', 'neuro_doc_history', 'neuro_doc_seizure_history',
    'neuro_doc_headache_history', 'neuro_doc_examination', 'neuro_doc_imaging_followup', 'neuro_doc_neurophysiology_followup',
    'neuro_doc_rehab_plan', 'neuro_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with neurology counts) ─────
export interface NeuroSummary {
  activeWorkflow: number
  strokeFollowups: number
  pendingImaging: number
  pendingNeurophysiology: number
  rehabilitation: number
  neuropsychology: number
  discharge: number
  medications: number
}
export interface NeuroBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: NeuroTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: NeuroImagingSignals
  followUp: ReturnType<typeof buildNeuroFollowUp>
  followUps: FollowUpItem[]
  summary: NeuroSummary
}
export function buildNeuroBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: NeuroEvent[]
  imagingSignals: NeuroImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): NeuroBrief {
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
  const tracker = buildNeuroTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const openTest = (t: string) => tests.find(r => r.testType === t)?.total ?? 0
  const summary: NeuroSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    strokeFollowups: openEvent('stroke_clinic_followup'),
    pendingImaging: openTest('brain_ct') + openTest('brain_mri') + openTest('spine_mri'),
    pendingNeurophysiology: openTest('eeg') + openTest('emg') + openTest('nerve_conduction') + openEvent('eeg_review') + openEvent('emg_ncs_review'),
    rehabilitation: openEvent('rehabilitation_referral') + openEvent('rehabilitation_followup'),
    neuropsychology: openTest('neuropsychology_assessment') + openEvent('neuropsychology_referral') + openEvent('neuropsychology_review'),
    discharge: openEvent('hospital_discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildNeuroFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type NeuroAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type NeuroConsultations = Consultation[]

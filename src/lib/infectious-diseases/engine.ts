// ── Infectious Diseases Clinical Copilot — pure engine (Phase 37) ──
//
// The TWENTIETH production Copilot, focused on INFECTIOUS-DISEASES & TROPICAL-
// MEDICINE WORKFLOW, CONTINUITY OF CARE and OPERATIONAL COORDINATION.
// DETERMINISTIC, read-only, OPERATIONAL only — same guarantees as the GP reference
// (Phase 16) and every specialty extension since. It EXTENDS and REUSES the GP
// engine; it does NOT duplicate it. It is NOT a clinical decision system.
//
// It NEVER: diagnoses infections (malaria / tuberculosis / HIV / hepatitis /
// meningitis / sepsis), interprets laboratory / blood or microbiology cultures /
// PCR / rapid diagnostic tests / chest X-ray / CT / MRI, recommends antibiotics /
// antivirals / antifungals / antiparasitics / admission / isolation / discharge /
// vaccination / public-health reporting, predicts outbreaks, or calculates severity
// scores. It only SURFACES that an infectious-diseases event or an investigation
// exists and its workflow status (planned / scheduled / active / awaiting review /
// follow-up due). Emits only codes / counts / labelKeys → it cannot hallucinate a
// finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const INFX_COPILOT_PACK_ID = 'infectious_diseases.core'
export const INFX_SPECIALTIES = ['infectious_diseases'] as const

/** Active for a doctor whose primary specialty is Infectious Diseases. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isInfectiousDiseasesContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'infectious_diseases'
}

// ── Infectious-diseases event vocabulary ────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const INFX_EVENT_TYPES = [
  'id_consultation', 'fever_followup', 'malaria_followup', 'tuberculosis_clinic_followup', 'hiv_clinic_followup',
  'hepatitis_followup', 'culture_review', 'microbiology_review', 'isolation_review', 'travel_medicine_review',
  'vaccination_followup', 'hospital_discharge_followup', 'contact_followup', 'public_health_followup', 'nutrition_review',
] as const
export type InfxEventType = (typeof INFX_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
export const INFX_TEST_TYPES = [
  'blood_culture', 'urine_culture', 'stool_culture', 'sputum_culture', 'pcr', 'rapid_diagnostic_test', 'afb_smear',
  'genexpert', 'hiv_test', 'hepatitis_panel', 'malaria_smear', 'malaria_rapid_test', 'chest_xray', 'ct', 'mri', 'laboratory_panel',
] as const
export type InfxTestType = (typeof INFX_TEST_TYPES)[number]

// Test groupings for the brief (imaging / cultures / molecular & serology).
const IMAGING_TESTS = new Set<string>(['chest_xray', 'ct', 'mri'])
const CULTURE_TESTS = new Set<string>(['blood_culture', 'urine_culture', 'stool_culture', 'sputum_culture'])
const MOLECULAR_TESTS = new Set<string>(['pcr', 'rapid_diagnostic_test', 'afb_smear', 'genexpert', 'hiv_test', 'hepatitis_panel', 'malaria_smear', 'malaria_rapid_test', 'laboratory_panel'])

export const INFX_ALL_TYPES = [...INFX_EVENT_TYPES, ...INFX_TEST_TYPES] as const
export type InfxAllType = (typeof INFX_ALL_TYPES)[number]

export const INFX_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type InfxEventStatus = (typeof INFX_EVENT_STATUSES)[number]

export type InfxCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(INFX_EVENT_TYPES)
const TEST_SET = new Set<string>(INFX_TEST_TYPES)

export function isInfxEventType(v: unknown): v is InfxAllType {
  return typeof v === 'string' && (INFX_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): InfxCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface InfxEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── ID event tracker (counts only — NEVER interpret) ───────────────
export interface InfxTrackingRow {
  eventType: InfxEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildInfxTracker(events: InfxEvent[] | null | undefined): InfxTrackingRow[] {
  const list = events ?? []
  return INFX_EVENT_TYPES.map(eventType => {
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
  testType: InfxTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: InfxEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return INFX_TEST_TYPES.map(testType => {
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
export interface InfxReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildInfxFollowUp(events: InfxEvent[] | null | undefined): { reminders: InfxReminder[] } {
  const list = events ?? []
  const reminders: InfxReminder[] = []

  const tracking = buildInfxTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'infx_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'infx_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'infx_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'infx_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'infx_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that infectious-diseases investigations exist in the EXISTING lab_orders
// and whether they are completed. Never the finding — no diagnosis, no result
// interpretation of culture / PCR / rapid test / imaging.
const INFX_RE = /blood culture|urine culture|stool culture|sputum culture|\bculture\b|\bpcr\b|rapid diagnostic|\brdt\b|\bafb\b|acid.?fast|genexpert|gene.?xpert|\bhiv\b|hepatitis|malaria|chest x-?ray|chest radiograph|microbiolog/i
export interface InfxImagingSignals { pending: number; completed: number; investigations: number }
export function countInfxImagingSignals(labOrders?: LabOrder[] | null): InfxImagingSignals {
  const orders = labOrders ?? []
  const isInfx = (o: LabOrder) => INFX_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => INFX_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isInfx)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + infectious-diseases prompts) ─
export interface InfxCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeInfxCompleteness(doc: ConsultationDoc): InfxCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'infx_doc_presentation', 'infx_doc_travel_history', 'infx_doc_exposure_history', 'infx_doc_vaccination_history',
    'infx_doc_contact_history', 'infx_doc_previous_infections', 'infx_doc_microbiology_followup', 'infx_doc_isolation_documentation',
    'infx_doc_public_health_documentation', 'infx_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with infectious-diseases counts) ─
export interface InfxSummary {
  activeWorkflow: number
  pendingCultures: number
  pendingMolecular: number
  pendingImaging: number
  chronicClinics: number
  isolationContact: number
  discharge: number
  medications: number
}
export interface InfxBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: InfxTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: InfxImagingSignals
  followUp: ReturnType<typeof buildInfxFollowUp>
  followUps: FollowUpItem[]
  summary: InfxSummary
}
export function buildInfxBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: InfxEvent[]
  imagingSignals: InfxImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): InfxBrief {
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
  const tracker = buildInfxTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const summary: InfxSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    pendingCultures: tests.filter(r => CULTURE_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0) + openEvent('culture_review') + openEvent('microbiology_review'),
    pendingMolecular: tests.filter(r => MOLECULAR_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    pendingImaging: tests.filter(r => IMAGING_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    chronicClinics: openEvent('tuberculosis_clinic_followup') + openEvent('hiv_clinic_followup') + openEvent('hepatitis_followup'),
    isolationContact: openEvent('isolation_review') + openEvent('contact_followup') + openEvent('public_health_followup'),
    discharge: openEvent('hospital_discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildInfxFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type InfxAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type InfxConsultations = Consultation[]

// ── Rheumatology Clinical Copilot — pure engine (Phase 38) ────────
//
// The TWENTY-FIRST production Copilot, focused on RHEUMATOLOGY WORKFLOW,
// CONTINUITY OF CARE and OPERATIONAL COORDINATION. DETERMINISTIC, read-only,
// OPERATIONAL only — same guarantees as the GP reference (Phase 16) and every
// specialty extension since. It EXTENDS and REUSES the GP engine; it does NOT
// duplicate it. It is NOT a clinical decision system.
//
// It NEVER: diagnoses rheumatologic conditions (rheumatoid arthritis / lupus /
// gout / vasculitis / ankylosing spondylitis / connective-tissue conditions),
// interprets laboratory values (ANA / RF / anti-CCP / ESR / CRP / HLA-B27) / joint
// aspiration / X-ray / ultrasound / MRI, recommends DMARDs / biologics / steroids /
// NSAIDs / surgery / injections / admission / discharge, predicts disability /
// progression, or calculates DAS28 / SLEDAI / BASDAI / CDAI. It only SURFACES that
// a rheumatology event or an investigation exists and its workflow status (planned
// / scheduled / active / awaiting review / follow-up due). Emits only codes /
// counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const RHEUM_COPILOT_PACK_ID = 'rheumatology.core'
export const RHEUM_SPECIALTIES = ['rheumatology'] as const

/** Active for a doctor whose primary specialty is Rheumatology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isRheumatologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'rheumatology'
}

// ── Rheumatology event vocabulary ───────────────────────────────────
// Tracker events — workflow: planned → scheduled → active → awaiting_review /
// follow_up_due → completed.
export const RHEUM_EVENT_TYPES = [
  'rheumatology_consultation', 'joint_followup', 'autoimmune_clinic_followup', 'infusion_followup', 'medication_monitoring_visit',
  'joint_aspiration_followup', 'injection_followup', 'physiotherapy_referral', 'occupational_therapy_referral', 'bone_health_review',
  'hospital_discharge_followup',
] as const
export type RheumEventType = (typeof RHEUM_EVENT_TYPES)[number]

// Investigations — workflow: ordered → completed → awaiting_review → reviewed.
export const RHEUM_TEST_TYPES = [
  'ana', 'anti_ccp', 'rheumatoid_factor', 'esr', 'crp', 'hla_b27', 'joint_aspiration', 'synovial_fluid_analysis',
  'msk_ultrasound', 'joint_xray', 'mri_joints', 'bone_density',
] as const
export type RheumTestType = (typeof RHEUM_TEST_TYPES)[number]

// Test groupings for the brief (serology / imaging / aspiration).
const LAB_TESTS = new Set<string>(['ana', 'anti_ccp', 'rheumatoid_factor', 'esr', 'crp', 'hla_b27'])
const IMAGING_TESTS = new Set<string>(['msk_ultrasound', 'joint_xray', 'mri_joints', 'bone_density'])
const ASPIRATION_TESTS = new Set<string>(['joint_aspiration', 'synovial_fluid_analysis'])

export const RHEUM_ALL_TYPES = [...RHEUM_EVENT_TYPES, ...RHEUM_TEST_TYPES] as const
export type RheumAllType = (typeof RHEUM_ALL_TYPES)[number]

export const RHEUM_EVENT_STATUSES = [
  'planned', 'scheduled', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type RheumEventStatus = (typeof RHEUM_EVENT_STATUSES)[number]

export type RheumCategory = 'event' | 'test'

const EVENT_SET = new Set<string>(RHEUM_EVENT_TYPES)
const TEST_SET = new Set<string>(RHEUM_TEST_TYPES)

export function isRheumEventType(v: unknown): v is RheumAllType {
  return typeof v === 'string' && (RHEUM_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): RheumCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (TEST_SET.has(eventType)) return 'test'
  return null
}

export interface RheumEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Rheumatology event tracker (counts only — NEVER interpret) ─────
export interface RheumTrackingRow {
  eventType: RheumEventType
  planned: number
  scheduled: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / scheduled / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'scheduled', 'active', 'awaiting_review', 'follow_up_due'])

export function buildRheumTracker(events: RheumEvent[] | null | undefined): RheumTrackingRow[] {
  const list = events ?? []
  return RHEUM_EVENT_TYPES.map(eventType => {
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
  testType: RheumTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildTestTracker(events: RheumEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return RHEUM_TEST_TYPES.map(testType => {
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
export interface RheumReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  refType?: string   // panel resolves the display name (event or test)
}

export function buildRheumFollowUp(events: RheumEvent[] | null | undefined): { reminders: RheumReminder[] } {
  const list = events ?? []
  const reminders: RheumReminder[] = []

  const tracking = buildRheumTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'rheum_rem_event_awaiting', params: { count: t.awaitingReview }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'rheum_rem_event_due', params: { count: t.followUpDue }, refType: t.eventType })
  }
  for (const t of tracking) {
    if (t.scheduled > 0) reminders.push({ code: `${t.eventType}_scheduled`, severity: 'info', labelKey: 'rheum_rem_event_scheduled', params: { count: t.scheduled }, refType: t.eventType })
  }

  const tests = buildTestTracker(list)
  for (const te of tests) {
    if (te.awaitingReview > 0) reminders.push({ code: `${te.testType}_awaiting`, severity: 'warning', labelKey: 'rheum_rem_test_awaiting', params: { count: te.awaitingReview }, refType: te.testType })
  }
  for (const te of tests) {
    if (te.ordered > 0) reminders.push({ code: `${te.testType}_pending`, severity: 'info', labelKey: 'rheum_rem_test_pending', params: { count: te.ordered }, refType: te.testType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary investigation signals (counts only — NEVER interpret) ─
// Surfaces that rheumatology investigations exist in the EXISTING lab_orders and
// whether they are completed. Never the finding — no diagnosis, no classification,
// no interpretation of serology / joint aspiration / imaging.
const RHEUM_RE = /\bana\b|anti.?ccp|rheumatoid factor|\besr\b|\bcrp\b|hla.?b27|joint aspiration|arthrocentesis|synovial|musculoskeletal ultrasound|msk ultrasound|joint x-?ray|joint radiograph|mri joint|\bdexa\b|bone densitom|bone density/i
export interface RheumImagingSignals { pending: number; completed: number; investigations: number }
export function countRheumImagingSignals(labOrders?: LabOrder[] | null): RheumImagingSignals {
  const orders = labOrders ?? []
  const isRheum = (o: LabOrder) => RHEUM_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => RHEUM_RE.test(i.test_name ?? ''))
  const invs = orders.filter(isRheum)
  return {
    pending: invs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: invs.filter(o => o.status === 'completed').length,
    investigations: invs.length,
  }
}

// ── Documentation completeness (reuses GP + rheumatology prompts) ──
export interface RheumCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeRheumCompleteness(doc: ConsultationDoc): RheumCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'rheum_doc_joint_symptoms', 'rheum_doc_morning_stiffness', 'rheum_doc_functional_status', 'rheum_doc_autoimmune_history',
    'rheum_doc_medication_monitoring', 'rheum_doc_joint_examination', 'rheum_doc_imaging_followup', 'rheum_doc_laboratory_followup',
    'rheum_doc_rehabilitation_review', 'rheum_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with rheumatology counts) ──
export interface RheumSummary {
  activeWorkflow: number
  pendingSerology: number
  pendingImaging: number
  pendingAspiration: number
  infusionMonitoring: number
  rehab: number
  discharge: number
  medications: number
}
export interface RheumBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: RheumTrackingRow[]
  tests: TestTrackingRow[]
  imagingSignals: RheumImagingSignals
  followUp: ReturnType<typeof buildRheumFollowUp>
  followUps: FollowUpItem[]
  summary: RheumSummary
}
export function buildRheumBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: RheumEvent[]
  imagingSignals: RheumImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): RheumBrief {
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
  const tracker = buildRheumTracker(input.events)
  const tests = buildTestTracker(input.events)
  const openEvent = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const summary: RheumSummary = {
    activeWorkflow: tracker.reduce((s, r) => s + r.total, 0),
    pendingSerology: tests.filter(r => LAB_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    pendingImaging: tests.filter(r => IMAGING_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0),
    pendingAspiration: tests.filter(r => ASPIRATION_TESTS.has(r.testType)).reduce((s, r) => s + r.total, 0) + openEvent('joint_aspiration_followup'),
    infusionMonitoring: openEvent('infusion_followup') + openEvent('medication_monitoring_visit'),
    rehab: openEvent('physiotherapy_referral') + openEvent('occupational_therapy_referral') + openEvent('bone_health_review'),
    discharge: openEvent('hospital_discharge_followup'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, tests, imagingSignals: input.imagingSignals, followUp: buildRheumFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type RheumAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type RheumConsultations = Consultation[]

// ── Emergency Medicine Clinical Copilot — pure engine (Phase 23) ───
//
// The SIXTH production Copilot. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and the Peds/OB-GYN/ORL/
// Cardiology extensions (17/18/19/22). It EXTENDS and REUSES the GP engine; it
// does NOT duplicate it.
//
// It NEVER: diagnoses, determines a triage level, recommends a treatment /
// medication / admission / discharge / procedure / airway intervention, predicts
// deterioration or mortality, or applies a clinical scoring system. It only
// SURFACES that an event exists and its workflow status (ordered / awaiting
// review / observation due / procedure follow-up). Emits only codes / counts /
// labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const EMERGENCY_COPILOT_PACK_ID = 'emergency.core'
export const EMERGENCY_SPECIALTIES = ['emergency_medicine'] as const

/** Active for a doctor whose primary specialty is Emergency Medicine (or a future
 *  "emergency_physician" id). Strict — no specialty leakage; the UI additionally
 *  gates on the clinic AI toggle. */
export function isEmergencyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor'
    && (primarySpecialtyId === 'emergency_medicine' || primarySpecialtyId === 'emergency_physician')
}

// ── Emergency event vocabulary ──────────────────────────────────────
// Pending results — workflow: ordered → completed → awaiting_review → reviewed.
export const EMERGENCY_RESULT_TYPES = [
  'lab', 'imaging', 'ecg', 'ultrasound', 'ct', 'mri', 'consult',
] as const
export type EmergencyResultType = (typeof EMERGENCY_RESULT_TYPES)[number]

// ED procedures — workflow: planned → performed → follow_up.
export const EMERGENCY_PROCEDURE_TYPES = [
  'suturing', 'casting', 'incision_drainage', 'chest_tube', 'central_line', 'intubation', 'cpr', 'wound_care',
] as const
export type EmergencyProcedureType = (typeof EMERGENCY_PROCEDURE_TYPES)[number]

// Observation + disposition + flow.
export const EMERGENCY_DISPOSITION_TYPES = ['admission', 'discharge', 'transfer', 'referral_request'] as const
export const EMERGENCY_FLOW_TYPES = ['arrival', 'consultation_started', 'medication_dispensed'] as const

export const EMERGENCY_EVENT_TYPES = [
  ...EMERGENCY_RESULT_TYPES, ...EMERGENCY_PROCEDURE_TYPES, 'observation',
  ...EMERGENCY_DISPOSITION_TYPES, ...EMERGENCY_FLOW_TYPES,
] as const
export type EmergencyEventType = (typeof EMERGENCY_EVENT_TYPES)[number]

export const EMERGENCY_EVENT_STATUSES = [
  'ordered', 'completed', 'awaiting_review', 'reviewed',
  'planned', 'performed', 'follow_up', 'started', 'ongoing', 'done', 'cancelled',
] as const
export type EmergencyEventStatus = (typeof EMERGENCY_EVENT_STATUSES)[number]

export type EmergencyCategory = 'result' | 'procedure' | 'observation' | 'disposition' | 'flow'

const RESULT_SET = new Set<string>(EMERGENCY_RESULT_TYPES)
const PROC_SET = new Set<string>(EMERGENCY_PROCEDURE_TYPES)
const DISPO_SET = new Set<string>(EMERGENCY_DISPOSITION_TYPES)
const FLOW_SET = new Set<string>(EMERGENCY_FLOW_TYPES)

export function isEmergencyEventType(v: unknown): v is EmergencyEventType {
  return typeof v === 'string' && (EMERGENCY_EVENT_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): EmergencyCategory | null {
  if (!eventType) return null
  if (RESULT_SET.has(eventType)) return 'result'
  if (PROC_SET.has(eventType)) return 'procedure'
  if (eventType === 'observation') return 'observation'
  if (DISPO_SET.has(eventType)) return 'disposition'
  if (FLOW_SET.has(eventType)) return 'flow'
  return null
}

export interface EmergencyEvent {
  eventType: string
  status: string
  eventDate?: string | null
}

// ── Pending results tracker (counts only — NEVER interpret) ────────
export interface ResultTrackingRow {
  resultType: EmergencyResultType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (not reviewed / cancelled)
}
const RESULT_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildPendingResults(events: EmergencyEvent[] | null | undefined): ResultTrackingRow[] {
  const list = events ?? []
  return EMERGENCY_RESULT_TYPES.map(resultType => {
    const inType = list.filter(e => e.eventType === resultType)
    return {
      resultType,
      ordered: inType.filter(e => e.status === 'ordered').length,
      completed: inType.filter(e => e.status === 'completed').length,
      awaitingReview: inType.filter(e => e.status === 'awaiting_review').length,
      reviewed: inType.filter(e => e.status === 'reviewed').length,
      total: inType.filter(e => RESULT_OPEN.has(e.status)).length,
    }
  })
}

// ── Observation tracker (registry only — NEVER recommend) ──────────
export interface ObservationSummary {
  started: number
  ongoing: number
  completed: number
  admissions: number
  discharges: number
  transfers: number
}
export function buildObservationTracker(events: EmergencyEvent[] | null | undefined): ObservationSummary {
  const list = events ?? []
  const obs = list.filter(e => e.eventType === 'observation')
  return {
    started: obs.filter(e => e.status === 'started').length,
    ongoing: obs.filter(e => e.status === 'ongoing').length,
    completed: obs.filter(e => e.status === 'completed' || e.status === 'done').length,
    admissions: list.filter(e => e.eventType === 'admission').length,
    discharges: list.filter(e => e.eventType === 'discharge').length,
    transfers: list.filter(e => e.eventType === 'transfer').length,
  }
}

// ── Procedure tracker (registry only — NEVER recommend) ────────────
export interface ProcedureRow {
  procedureType: EmergencyProcedureType
  planned: number
  performed: number
  followUp: number
  total: number
}
const PROC_OPEN = new Set(['planned', 'performed', 'follow_up'])

export function buildProcedureTracker(events: EmergencyEvent[] | null | undefined): ProcedureRow[] {
  const list = events ?? []
  return EMERGENCY_PROCEDURE_TYPES.map(procedureType => {
    const inType = list.filter(e => e.eventType === procedureType)
    return {
      procedureType,
      planned: inType.filter(e => e.status === 'planned').length,
      performed: inType.filter(e => e.status === 'performed').length,
      followUp: inType.filter(e => e.status === 'follow_up').length,
      total: inType.filter(e => PROC_OPEN.has(e.status)).length,
    }
  })
}

// ── Follow-up reminders (surface only — never interpret) ───────────
export interface EmergencyReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  resultType?: string   // panel resolves the display name for a result reminder
}

export function buildEmergencyFollowUp(events: EmergencyEvent[] | null | undefined): { reminders: EmergencyReminder[] } {
  const list = events ?? []
  const reminders: EmergencyReminder[] = []

  const results = buildPendingResults(list)
  for (const r of results) {
    if (r.resultType === 'consult') continue
    if (r.awaitingReview > 0) reminders.push({ code: `${r.resultType}_awaiting`, severity: 'warning', labelKey: 'em_rem_result_awaiting', params: { count: r.awaitingReview }, resultType: r.resultType })
  }
  for (const r of results) {
    if (r.resultType === 'consult') continue
    if (r.ordered > 0) reminders.push({ code: `${r.resultType}_outstanding`, severity: 'info', labelKey: 'em_rem_result_outstanding', params: { count: r.ordered }, resultType: r.resultType })
  }

  const consult = results.find(r => r.resultType === 'consult')!
  const consultPending = consult.ordered + consult.awaitingReview + consult.completed
  if (consultPending > 0) reminders.push({ code: 'consult_pending', severity: 'warning', labelKey: 'em_rem_consult_pending', params: { count: consultPending } })

  const ongoingObs = list.filter(e => e.eventType === 'observation' && e.status === 'ongoing').length
  if (ongoingObs > 0) reminders.push({ code: 'observation_due', severity: 'warning', labelKey: 'em_rem_observation_due', params: { count: ongoingObs } })

  const procFollowUp = buildProcedureTracker(list).reduce((s, p) => s + p.followUp, 0)
  if (procFollowUp > 0) reminders.push({ code: 'procedure_followup', severity: 'warning', labelKey: 'em_rem_procedure_followup', params: { count: procFollowUp } })

  const arrivals = list.filter(e => e.eventType === 'arrival').length
  if (arrivals > 1) reminders.push({ code: 'return_visit', severity: 'info', labelKey: 'em_rem_return_visit', params: { count: arrivals } })

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary lab signals (counts only — NEVER interpret) ──────
// Surfaces that emergency labs / imaging exist in the EXISTING lab_orders and
// whether they are completed. Never the value or its meaning.
const IMAGING_RE = /\bct\b|scanner|tomograph|\bmri\b|\birm\b|x-?ray|radiograph|ultrasound|echograph|imaging|imagerie/i
export interface EmergencyLabSignals { pending: number; completed: number; imaging: number }
export function countEmergencyLabSignals(labOrders?: LabOrder[] | null): EmergencyLabSignals {
  const orders = labOrders ?? []
  const isImaging = (o: LabOrder) => IMAGING_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => IMAGING_RE.test(i.test_name ?? ''))
  return {
    pending: orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: orders.filter(o => o.status === 'completed').length,
    imaging: orders.filter(isImaging).length,
  }
}

// ── Documentation completeness (reuses GP + emergency prompts) ─────
export interface EmergencyCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeEmergencyCompleteness(doc: ConsultationDoc): EmergencyCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'em_doc_chief_complaint', 'em_doc_mechanism', 'em_doc_onset', 'em_doc_associated',
    'em_doc_pmh', 'em_doc_meds', 'em_doc_allergies', 'em_doc_focused_exam',
    'em_doc_interventions', 'em_doc_disposition',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with emergency counts) ─────
export interface EmergencySummary {
  pendingLabs: number
  pendingImaging: number
  pendingEcg: number
  pendingProcedures: number
  consultRequests: number
  admissions: number
  medications: number
  returnVisits: number
}
export interface EmergencyBrief {
  gp: ReturnType<typeof buildGpBrief>
  pendingResults: ResultTrackingRow[]
  observation: ObservationSummary
  procedures: ProcedureRow[]
  labSignals: EmergencyLabSignals
  followUp: ReturnType<typeof buildEmergencyFollowUp>
  followUps: FollowUpItem[]
  emergency: EmergencySummary
}
export function buildEmergencyBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: EmergencyEvent[]
  labSignals: EmergencyLabSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): EmergencyBrief {
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
  const pendingResults = buildPendingResults(input.events)
  const observation = buildObservationTracker(input.events)
  const procedures = buildProcedureTracker(input.events)
  const byType = (t: string) => pendingResults.find(r => r.resultType === t)?.total ?? 0
  const emergency: EmergencySummary = {
    pendingLabs: byType('lab'),
    pendingImaging: byType('imaging') + byType('ct') + byType('mri') + byType('ultrasound'),
    pendingEcg: byType('ecg'),
    pendingProcedures: procedures.reduce((s, p) => s + p.total, 0),
    consultRequests: byType('consult'),
    admissions: observation.admissions,
    medications: input.activePrescriptions,
    returnVisits: (input.events ?? []).filter(e => e.eventType === 'arrival').length,
  }
  return {
    gp, pendingResults, observation, procedures, labSignals: input.labSignals,
    followUp: buildEmergencyFollowUp(input.events), followUps: input.followUps, emergency,
  }
}

export { buildFollowUps, buildMedicationReview }

export type EmergencyAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type EmergencyConsultations = Consultation[]

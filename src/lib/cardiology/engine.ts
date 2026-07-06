// ── Cardiology Clinical Copilot — pure engine (Phase 22) ───────────
//
// The FIFTH production Copilot. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and the Peds/OB-GYN/ORL
// extensions (17/18/19). It EXTENDS and REUSES the GP engine; it does NOT
// duplicate it.
//
// It NEVER: diagnoses (ACS, MI, arrhythmia…), interprets an ECG / Echo / stress
// test / Holter / CT / MRI / catheterisation, recommends a medication or a
// procedure (PCI / CABG…), predicts risk or mortality, or applies a clinical
// scoring system. It only SURFACES that an event exists and its workflow status
// (ordered / awaiting review / follow-up due). Emits only codes / counts /
// labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const CARDIO_COPILOT_PACK_ID = 'cardiology.core'
export const CARDIO_SPECIALTIES = ['cardiology'] as const

/** Active for a doctor whose primary specialty is Cardiology (or the future
 *  interventional-cardiology sub-specialty). Strict — no specialty leakage; the
 *  UI additionally gates on the clinic AI toggle. */
export function isCardiologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor'
    && (primarySpecialtyId === 'cardiology' || primarySpecialtyId === 'interventional_cardiology')
}

// ── Cardiology event vocabulary ─────────────────────────────────────
// Tests — workflow: ordered → completed → awaiting_review → reviewed.
export const CARDIO_TEST_TYPES = [
  'ecg', 'echo', 'stress_test', 'holter', 'cardiac_ct', 'cardiac_mri', 'cath_lab',
] as const
export type CardioTestType = (typeof CARDIO_TEST_TYPES)[number]

// Procedures — workflow: planned → scheduled → completed → follow_up.
export const CARDIO_PROCEDURE_TYPES = [
  'pci', 'cabg', 'pacemaker', 'icd', 'valve_surgery', 'cardiac_catheterization',
] as const
export type CardioProcedureType = (typeof CARDIO_PROCEDURE_TYPES)[number]

export const CARDIO_OTHER_TYPES = ['admission', 'medication_change', 'review'] as const

export const CARDIO_EVENT_TYPES = [
  ...CARDIO_TEST_TYPES, ...CARDIO_PROCEDURE_TYPES, ...CARDIO_OTHER_TYPES,
] as const
export type CardioEventType = (typeof CARDIO_EVENT_TYPES)[number]

export const CARDIO_EVENT_STATUSES = [
  'ordered', 'scheduled', 'planned', 'completed', 'awaiting_review', 'reviewed', 'follow_up', 'due', 'cancelled',
] as const
export type CardioEventStatus = (typeof CARDIO_EVENT_STATUSES)[number]

export type CardioCategory = 'test' | 'procedure' | 'admission' | 'medication' | 'review'

const TEST_SET = new Set<string>(CARDIO_TEST_TYPES)
const PROC_SET = new Set<string>(CARDIO_PROCEDURE_TYPES)

export function isCardioEventType(v: unknown): v is CardioEventType {
  return typeof v === 'string' && (CARDIO_EVENT_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): CardioCategory | null {
  if (!eventType) return null
  if (TEST_SET.has(eventType)) return 'test'
  if (PROC_SET.has(eventType)) return 'procedure'
  if (eventType === 'admission') return 'admission'
  if (eventType === 'medication_change') return 'medication'
  if (eventType === 'review') return 'review'
  return null
}

export interface CardioEvent {
  eventType: string
  status: string
  eventDate?: string | null
}

// ── Cardiac test tracking (counts only — NEVER interpret) ──────────
export interface TestTrackingRow {
  testType: CardioTestType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number       // open (not reviewed / cancelled)
}
const TEST_OPEN = new Set(['ordered', 'completed', 'awaiting_review', 'due'])

export function buildTestTracking(events: CardioEvent[] | null | undefined): TestTrackingRow[] {
  const list = events ?? []
  return CARDIO_TEST_TYPES.map(testType => {
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

// ── Procedure tracker (registry only — NEVER recommend) ────────────
export interface ProcedureRow {
  procedureType: CardioProcedureType
  planned: number
  scheduled: number
  completed: number
  followUp: number
  total: number
}
const PROC_OPEN = new Set(['planned', 'scheduled', 'completed', 'follow_up', 'due'])

export function buildProcedureTracker(events: CardioEvent[] | null | undefined): ProcedureRow[] {
  const list = events ?? []
  return CARDIO_PROCEDURE_TYPES.map(procedureType => {
    const inType = list.filter(e => e.eventType === procedureType)
    return {
      procedureType,
      planned: inType.filter(e => e.status === 'planned').length,
      scheduled: inType.filter(e => e.status === 'scheduled').length,
      completed: inType.filter(e => e.status === 'completed').length,
      followUp: inType.filter(e => e.status === 'follow_up').length,
      total: inType.filter(e => PROC_OPEN.has(e.status)).length,
    }
  })
}

// ── Follow-up reminders (surface only — never interpret) ───────────
export interface CardioReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  testType?: string   // panel resolves the display name for a test reminder
}

export function buildCardiacFollowUp(events: CardioEvent[] | null | undefined): { reminders: CardioReminder[] } {
  const list = events ?? []
  const reminders: CardioReminder[] = []

  const tracking = buildTestTracking(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.testType}_awaiting`, severity: 'warning', labelKey: 'cardio_rem_test_awaiting', params: { count: t.awaitingReview }, testType: t.testType })
  }
  for (const t of tracking) {
    if (t.ordered > 0) reminders.push({ code: `${t.testType}_outstanding`, severity: 'info', labelKey: 'cardio_rem_test_outstanding', params: { count: t.ordered }, testType: t.testType })
  }

  const procedures = buildProcedureTracker(list)
  const followUpProc = procedures.reduce((s, p) => s + p.followUp, 0)
  if (followUpProc > 0) reminders.push({ code: 'procedure_followup', severity: 'warning', labelKey: 'cardio_rem_procedure_followup', params: { count: followUpProc } })

  const openAdmissions = list.filter(e => e.eventType === 'admission' && e.status !== 'reviewed' && e.status !== 'cancelled').length
  if (openAdmissions > 0) reminders.push({ code: 'recent_admission', severity: 'info', labelKey: 'cardio_rem_recent_admission', params: { count: openAdmissions } })

  // warnings first (deterministic, stable order)
  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Cardiac laboratory follow-up (counts only — NEVER classify) ────
// Heuristic name/notes matching over EXISTING lab_orders. Surfaces that a
// cardiac lab was ordered and whether it is completed — never the VALUE or its
// meaning.
const LAB_PATTERNS: { key: keyof CardiacLabCounts; re: RegExp }[] = [
  { key: 'troponin', re: /troponin|tropo/i },
  { key: 'bnp', re: /\bbnp\b|nt-?probnp|natriuretic/i },
  { key: 'lipid', re: /lipid|cholesterol|\bldl\b|\bhdl\b|triglycerid/i },
  { key: 'hba1c', re: /hba1c|glycated|\ba1c\b/i },
  { key: 'electrolytes', re: /electrolyt|sodium|potassium|natr[eé]m|kali[eé]m|ionogram/i },
  { key: 'creatinine', re: /creatinin|\begfr\b|renal function|clairance/i },
]
export interface CardiacLabCounts {
  troponin: number; bnp: number; lipid: number; hba1c: number; electrolytes: number; creatinine: number
  ordered: number; completed: number; awaitingReview: number
}
export function countCardiacLabSignals(labOrders?: LabOrder[] | null): CardiacLabCounts {
  const orders = labOrders ?? []
  const match = (o: LabOrder, re: RegExp) => re.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => re.test(i.test_name ?? ''))
  const counts: CardiacLabCounts = { troponin: 0, bnp: 0, lipid: 0, hba1c: 0, electrolytes: 0, creatinine: 0, ordered: 0, completed: 0, awaitingReview: 0 }
  for (const o of orders) {
    let isCardiac = false
    for (const p of LAB_PATTERNS) if (match(o, p.re)) { counts[p.key]++; isCardiac = true }
    if (!isCardiac) continue
    if (o.status === 'completed') { counts.completed++; counts.awaitingReview++ }
    else counts.ordered++
  }
  return counts
}

// ── Documentation completeness (reuses GP + cardiology prompts) ────
export interface CardiologyCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeCardiologyCompleteness(doc: ConsultationDoc): CardiologyCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'cardio_doc_chest_pain', 'cardio_doc_dyspnea', 'cardio_doc_palpitations', 'cardio_doc_syncope',
    'cardio_doc_cv_history', 'cardio_doc_risk_factors', 'cardio_doc_family_history',
    'cardio_doc_cardiac_exam', 'cardio_doc_extremities',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with cardiac counts) ───────
export interface CardiacSummary {
  ecg: number; echo: number; cardiacLabs: number; procedures: number
  upcomingAppointments: number; medications: number; admissions: number
}
export interface CardiologyBrief {
  gp: ReturnType<typeof buildGpBrief>
  testTracking: TestTrackingRow[]
  procedures: ProcedureRow[]
  labSignals: CardiacLabCounts
  followUp: ReturnType<typeof buildCardiacFollowUp>
  followUps: FollowUpItem[]
  cardiac: CardiacSummary
}
export function buildCardiologyBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: CardioEvent[]
  labSignals: CardiacLabCounts
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): CardiologyBrief {
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
  const testTracking = buildTestTracking(input.events)
  const procedures = buildProcedureTracker(input.events)
  const followUp = buildCardiacFollowUp(input.events)
  const openProcedures = procedures.reduce((s, p) => s + p.total, 0)
  const admissions = (input.events ?? []).filter(e => e.eventType === 'admission' && e.status !== 'reviewed' && e.status !== 'cancelled').length
  const cardiac: CardiacSummary = {
    ecg: testTracking.find(t => t.testType === 'ecg')?.total ?? 0,
    echo: testTracking.find(t => t.testType === 'echo')?.total ?? 0,
    cardiacLabs: input.labSignals.ordered + input.labSignals.completed,
    procedures: openProcedures,
    upcomingAppointments: input.upcomingAppointments,
    medications: input.activePrescriptions,
    admissions,
  }
  return { gp, testTracking, procedures, labSignals: input.labSignals, followUp, followUps: input.followUps, cardiac }
}

export { buildFollowUps, buildMedicationReview }

export type CardioAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type CardioConsultations = Consultation[]

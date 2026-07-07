// ── Internal Medicine Clinical Copilot — pure engine (Phase 24) ────
//
// The SEVENTH production Copilot, focused on CHRONIC-DISEASE WORKFLOW and
// operational follow-up. DETERMINISTIC, read-only, OPERATIONAL only — same
// guarantees as the GP reference (Phase 16) and the Peds/OB-GYN/ORL/Cardiology/
// Emergency extensions (17/18/19/22/23). It EXTENDS and REUSES the GP engine; it
// does NOT duplicate it.
//
// It NEVER: diagnoses, classifies disease severity, interprets a lab value (no
// "controlled/uncontrolled", no CKD/diabetes/anemia call), recommends a
// medication or treatment, or predicts risk / mortality. It only SURFACES that a
// chronic-care review or a lab exists and its workflow status (due / overdue /
// awaiting review). Emits only codes / counts / labelKeys → it cannot
// hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const IM_COPILOT_PACK_ID = 'internal_medicine.core'
export const IM_SPECIALTIES = ['internal_medicine'] as const

/** Active for a doctor whose primary specialty is Internal Medicine. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isInternalMedicineContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'internal_medicine'
}

// ── Chronic-disease vocabulary ──────────────────────────────────────
export const CHRONIC_CONDITIONS = [
  'diabetes', 'hypertension', 'ckd', 'asthma_copd', 'dyslipidemia', 'thyroid', 'anemia',
] as const
export type ChronicCondition = (typeof CHRONIC_CONDITIONS)[number]

export const IM_OTHER_TYPES = ['discharge_followup', 'medication_review', 'polypharmacy_review'] as const

export const IM_EVENT_TYPES = [...CHRONIC_CONDITIONS, ...IM_OTHER_TYPES] as const
export type ImEventType = (typeof IM_EVENT_TYPES)[number]

export const IM_EVENT_STATUSES = ['due', 'overdue', 'completed', 'awaiting_review', 'scheduled', 'cancelled'] as const
export type ImEventStatus = (typeof IM_EVENT_STATUSES)[number]

export type ImCategory = 'chronic' | 'discharge' | 'medication'

const CHRONIC_SET = new Set<string>(CHRONIC_CONDITIONS)

export function isImEventType(v: unknown): v is ImEventType {
  return typeof v === 'string' && (IM_EVENT_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): ImCategory | null {
  if (!eventType) return null
  if (CHRONIC_SET.has(eventType)) return 'chronic'
  if (eventType === 'discharge_followup') return 'discharge'
  if (eventType === 'medication_review' || eventType === 'polypharmacy_review') return 'medication'
  return null
}

export interface ImEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Chronic-disease tracker (counts only — NEVER interpret) ────────
export interface ChronicTrackingRow {
  condition: ChronicCondition
  due: number
  overdue: number
  completed: number
  awaitingReview: number
  total: number       // open (due / overdue / awaiting_review / scheduled)
}
const CHRONIC_OPEN = new Set(['due', 'overdue', 'awaiting_review', 'scheduled'])

export function buildChronicTracker(events: ImEvent[] | null | undefined): ChronicTrackingRow[] {
  const list = events ?? []
  return CHRONIC_CONDITIONS.map(condition => {
    const inType = list.filter(e => e.eventType === condition)
    return {
      condition,
      due: inType.filter(e => e.status === 'due').length,
      overdue: inType.filter(e => e.status === 'overdue').length,
      completed: inType.filter(e => e.status === 'completed').length,
      awaitingReview: inType.filter(e => e.status === 'awaiting_review').length,
      total: inType.filter(e => CHRONIC_OPEN.has(e.status)).length,
    }
  })
}

// ── Follow-up reminders (surface only — never interpret) ───────────
export interface ImReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  condition?: string   // panel resolves the display name for a chronic reminder
}

export function buildImFollowUp(events: ImEvent[] | null | undefined): { reminders: ImReminder[] } {
  const list = events ?? []
  const reminders: ImReminder[] = []

  const tracking = buildChronicTracker(list)
  for (const c of tracking) {
    if (c.overdue > 0) reminders.push({ code: `${c.condition}_overdue`, severity: 'warning', labelKey: 'im_rem_chronic_overdue', params: { count: c.overdue }, condition: c.condition })
  }
  for (const c of tracking) {
    if (c.awaitingReview > 0) reminders.push({ code: `${c.condition}_awaiting`, severity: 'warning', labelKey: 'im_rem_chronic_awaiting', params: { count: c.awaitingReview }, condition: c.condition })
  }
  for (const c of tracking) {
    if (c.due > 0) reminders.push({ code: `${c.condition}_due`, severity: 'info', labelKey: 'im_rem_chronic_due', params: { count: c.due }, condition: c.condition })
  }

  const discharge = list.filter(e => e.eventType === 'discharge_followup' && (e.status === 'due' || e.status === 'overdue' || e.status === 'scheduled')).length
  if (discharge > 0) reminders.push({ code: 'discharge_due', severity: 'warning', labelKey: 'im_rem_discharge_due', params: { count: discharge } })

  const medReview = list.filter(e => (e.eventType === 'medication_review' || e.eventType === 'polypharmacy_review') && (e.status === 'due' || e.status === 'overdue')).length
  if (medReview > 0) reminders.push({ code: 'medication_review_due', severity: 'info', labelKey: 'im_rem_medication_review_due', params: { count: medReview } })

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Laboratory follow-up (counts only — NEVER classify a value) ────
// Heuristic name/notes matching over EXISTING lab_orders. Surfaces that a
// chronic-care lab was ordered and whether it is completed — NEVER the value,
// NEVER "controlled/uncontrolled", NEVER a CKD/diabetes/anemia call.
const LAB_PATTERNS: { key: keyof ImLabCounts; re: RegExp }[] = [
  { key: 'hba1c', re: /hba1c|glycated|\ba1c\b/i },
  { key: 'creatinine', re: /creatinin|\begfr\b|\bgfr\b|renal function|clairance/i },
  { key: 'lipid', re: /lipid|cholesterol|\bldl\b|\bhdl\b|triglycerid/i },
  { key: 'tsh', re: /\btsh\b|thyroid stimulating|thyr[eé]ostim|thyroid function|\bt3\b|\bt4\b/i },
  { key: 'cbc', re: /\bcbc\b|\bfbc\b|\bnfs\b|complete blood|h[ae]mogram|numeration|h[ae]moglobin/i },
  { key: 'electrolytes', re: /electrolyt|sodium|potassium|natr[eé]m|kali[eé]m|ionogram/i },
  { key: 'urine_albumin', re: /microalbumin|albuminuria|proteinuria|\bacr\b|urine (albumin|protein)|(albumin|protein).{0,6}urin/i },
]
export interface ImLabCounts {
  hba1c: number; creatinine: number; lipid: number; tsh: number; cbc: number; electrolytes: number; urine_albumin: number
  ordered: number; completed: number; awaitingReview: number
}
export function countImLabSignals(labOrders?: LabOrder[] | null): ImLabCounts {
  const orders = labOrders ?? []
  const match = (o: LabOrder, re: RegExp) => re.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => re.test(i.test_name ?? ''))
  const counts: ImLabCounts = { hba1c: 0, creatinine: 0, lipid: 0, tsh: 0, cbc: 0, electrolytes: 0, urine_albumin: 0, ordered: 0, completed: 0, awaitingReview: 0 }
  for (const o of orders) {
    let isChronic = false
    for (const p of LAB_PATTERNS) if (match(o, p.re)) { counts[p.key]++; isChronic = true }
    if (!isChronic) continue
    if (o.status === 'completed') { counts.completed++; counts.awaitingReview++ }
    else counts.ordered++
  }
  return counts
}

// ── Documentation completeness (reuses GP + IM prompts) ────────────
export interface ImCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeImCompleteness(doc: ConsultationDoc): ImCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'im_doc_chronic_history', 'im_doc_medication_review', 'im_doc_adherence', 'im_doc_lifestyle',
    'im_doc_complications', 'im_doc_ros', 'im_doc_physical_exam', 'im_doc_follow_up_plan',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with IM counts) ────────────
export interface ImSummary {
  chronicFollowUps: number
  recentLabs: number
  medications: number
  dischargeFollowUps: number
  pendingReview: number
  upcomingAppointments: number
}
export interface ImBrief {
  gp: ReturnType<typeof buildGpBrief>
  chronic: ChronicTrackingRow[]
  labSignals: ImLabCounts
  followUp: ReturnType<typeof buildImFollowUp>
  followUps: FollowUpItem[]
  summary: ImSummary
}
export function buildImBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: ImEvent[]
  labSignals: ImLabCounts
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): ImBrief {
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
  const chronic = buildChronicTracker(input.events)
  const list = input.events ?? []
  const summary: ImSummary = {
    chronicFollowUps: chronic.reduce((s, c) => s + c.total, 0),
    recentLabs: input.labSignals.ordered + input.labSignals.completed,
    medications: input.activePrescriptions,
    dischargeFollowUps: list.filter(e => e.eventType === 'discharge_followup' && e.status !== 'completed' && e.status !== 'cancelled').length,
    pendingReview: chronic.reduce((s, c) => s + c.awaitingReview, 0) + input.labSignals.awaitingReview,
    upcomingAppointments: input.upcomingAppointments,
  }
  return { gp, chronic, labSignals: input.labSignals, followUp: buildImFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type ImAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type ImConsultations = Consultation[]

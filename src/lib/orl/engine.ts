// ── ORL / ENT Clinical Copilot — pure engine (Phase 19) ────────────
//
// The FOURTH production Copilot. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and the Peds/OB-GYN extensions
// (17/18). It EXTENDS and REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses, recommends treatment or surgery, prescribes, or
// interprets audiometry / endoscopy / CT / MRI / pathology. It only SURFACES
// that an event exists and its workflow status (ordered / awaiting review /
// due). Emits only codes / counts / labelKeys → cannot hallucinate.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const ORL_COPILOT_PACK_ID = 'ent.core'
export const ORL_SPECIALTIES = ['ent'] as const

/** Active for a doctor whose primary specialty is ORL/ENT. Strict — no
 *  specialty leakage; the UI additionally gates on the AI toggle. */
export function isOrlContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'ent'
}

// ── ORL event vocabulary ────────────────────────────────────────────
export const ORL_EVENT_TYPES = [
  'audiometry', 'hearing_aid', 'nasal_endoscopy', 'laryngoscopy',
  'ct_sinus', 'mri_neck', 'ct_neck', 'biopsy', 'pathology',
  'post_op_visit', 'wound_review', 'packing_removal',
] as const
export type OrlEventType = (typeof ORL_EVENT_TYPES)[number]

export const ORL_EVENT_STATUSES = ['ordered', 'completed', 'awaiting_review', 'reviewed', 'due', 'done', 'cancelled'] as const
export type OrlEventStatus = (typeof ORL_EVENT_STATUSES)[number]

export type OrlCategory = 'audiology' | 'endoscopy' | 'imaging' | 'pathology' | 'post_op'

const CATEGORY_OF: Record<OrlEventType, OrlCategory> = {
  audiometry: 'audiology', hearing_aid: 'audiology',
  nasal_endoscopy: 'endoscopy', laryngoscopy: 'endoscopy',
  ct_sinus: 'imaging', mri_neck: 'imaging', ct_neck: 'imaging',
  biopsy: 'pathology', pathology: 'pathology',
  post_op_visit: 'post_op', wound_review: 'post_op', packing_removal: 'post_op',
}

export function isOrlEventType(v: unknown): v is OrlEventType {
  return typeof v === 'string' && (ORL_EVENT_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): OrlCategory | null {
  return eventType && eventType in CATEGORY_OF ? CATEGORY_OF[eventType as OrlEventType] : null
}

export interface OrlEvent {
  eventType: string
  status: string
  eventDate?: string | null
}

// ── Follow-up summary (surface only — never interpret) ─────────────
export interface OrlCategorySummary {
  category: OrlCategory
  ordered: number
  awaitingReview: number
  due: number
  completed: number
  total: number
}
export interface OrlReminder { code: string; severity: 'info' | 'warning'; labelKey: string; params?: Record<string, string | number> }
export interface OrlFollowUp {
  categories: OrlCategorySummary[]
  reminders: OrlReminder[]
}

const CATEGORIES: OrlCategory[] = ['audiology', 'endoscopy', 'imaging', 'pathology', 'post_op']
const OPEN_STATUSES = new Set(['ordered', 'completed', 'awaiting_review', 'due']) // not reviewed/done/cancelled

export function buildOrlFollowUp(events: OrlEvent[] | null | undefined): OrlFollowUp {
  const list = (events ?? []).filter(e => categoryOf(e.eventType))
  const categories: OrlCategorySummary[] = CATEGORIES.map(cat => {
    const inCat = list.filter(e => categoryOf(e.eventType) === cat)
    return {
      category: cat,
      ordered: inCat.filter(e => e.status === 'ordered').length,
      awaitingReview: inCat.filter(e => e.status === 'awaiting_review').length,
      due: inCat.filter(e => e.status === 'due').length,
      completed: inCat.filter(e => e.status === 'completed').length,
      total: inCat.filter(e => OPEN_STATUSES.has(e.status)).length,
    }
  })

  const reminders: OrlReminder[] = []
  for (const c of categories) {
    if (c.awaitingReview > 0) reminders.push({ code: `${c.category}_awaiting`, severity: 'warning', labelKey: `orl_rem_${c.category}_awaiting`, params: { count: c.awaitingReview } })
  }
  const postOp = categories.find(c => c.category === 'post_op')
  if (postOp && postOp.due > 0) reminders.push({ code: 'post_op_due', severity: 'warning', labelKey: 'orl_rem_post_op_due', params: { count: postOp.due } })
  for (const c of categories) {
    if (c.ordered > 0) reminders.push({ code: `${c.category}_ordered`, severity: 'info', labelKey: `orl_rem_${c.category}_ordered`, params: { count: c.ordered } })
  }
  return { categories, reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

/** Supplementary signal from EXISTING lab_orders (imaging / pathology / audiology
 *  by test-name heuristic) — counts only, NEVER interpretation. */
const IMAGING_RE = /\bct\b|scanner|tomograph|\bmri\b|\birm\b|imaging|imagerie|sinus scan/i
const PATHOLOGY_RE = /biops|patholog|anatomo|histolog|cytolog/i
const AUDIOLOGY_RE = /audiomet|audiogram|tympanomet|hearing test|test auditif/i

export interface OrlLabSignals { imaging: number; pathology: number; audiology: number; awaitingReview: number }
export function countOrlLabSignals(labOrders?: LabOrder[] | null): OrlLabSignals {
  const orders = labOrders ?? []
  const match = (o: LabOrder, re: RegExp) => re.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => re.test(i.test_name ?? ''))
  return {
    imaging: orders.filter(o => match(o, IMAGING_RE)).length,
    pathology: orders.filter(o => match(o, PATHOLOGY_RE)).length,
    audiology: orders.filter(o => match(o, AUDIOLOGY_RE)).length,
    awaitingReview: orders.filter(o => o.status === 'completed').length,
  }
}

// ── Documentation completeness (reuses GP + ORL prompts) ───────────
export interface OrlCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeOrlCompleteness(doc: ConsultationDoc): OrlCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'orl_doc_ear_history', 'orl_doc_nose_history', 'orl_doc_throat_history',
    'orl_doc_otoscopy', 'orl_doc_nasal_exam', 'orl_doc_throat_exam', 'orl_doc_neck_exam',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief) ────────────────────────────────────
export interface OrlBrief {
  gp: ReturnType<typeof buildGpBrief>
  followUp: OrlFollowUp
  labSignals: OrlLabSignals
  followUps: FollowUpItem[]
}
export function buildOrlBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  followUp: OrlFollowUp
  labSignals: OrlLabSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): OrlBrief {
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
  return { gp, followUp: input.followUp, labSignals: input.labSignals, followUps: input.followUps }
}

export { buildFollowUps, buildMedicationReview }

// buildFollowUps signature helper for the panel.
export type OrlAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type OrlConsultations = Consultation[]

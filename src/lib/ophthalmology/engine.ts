// ── Ophthalmology Clinical Copilot — pure engine (Phase 26) ────────
//
// The NINTH production Copilot, focused on EYE-CARE WORKFLOW and operational
// follow-up. DETERMINISTIC, read-only, OPERATIONAL only — same guarantees as the
// GP reference (Phase 16) and the Peds/OB-GYN/ORL/Cardiology/Emergency/
// Internal-Medicine/Orthopedics extensions (17/18/19/22/23/24/25). It EXTENDS and
// REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses, interprets a fundus image / OCT / visual field, classifies
// glaucoma / cataract / retinopathy, recommends surgery / a treatment / a
// medication, or predicts vision loss. It only SURFACES that an eye event or an
// image exists and its workflow status (planned / active / awaiting review /
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

export const OPHTH_COPILOT_PACK_ID = 'ophthalmology.core'
export const OPHTH_SPECIALTIES = ['ophthalmology'] as const

/** Active for a doctor whose primary specialty is Ophthalmology. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isOphthalmologyContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'ophthalmology'
}

// ── Ophthalmology event vocabulary ──────────────────────────────────
// Tracker events — workflow: planned → active → awaiting_review / follow_up_due → completed.
export const OPHTH_EVENT_TYPES = [
  'visual_acuity', 'refraction', 'cataract_review', 'glaucoma_followup',
  'diabetic_eye_screening', 'eye_procedure_followup', 'post_op_review',
] as const
export type OphthEventType = (typeof OPHTH_EVENT_TYPES)[number]

// Imaging / tests — workflow: ordered → completed → awaiting_review → reviewed.
export const OPHTH_IMAGING_TYPES = ['fundus_imaging', 'oct_imaging', 'visual_field', 'eye_ultrasound'] as const
export type OphthImagingType = (typeof OPHTH_IMAGING_TYPES)[number]

export const OPHTH_ALL_TYPES = [...OPHTH_EVENT_TYPES, ...OPHTH_IMAGING_TYPES] as const
export type OphthAllType = (typeof OPHTH_ALL_TYPES)[number]

export const OPHTH_EVENT_STATUSES = [
  'planned', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type OphthEventStatus = (typeof OPHTH_EVENT_STATUSES)[number]

export type OphthCategory = 'event' | 'imaging'

const EVENT_SET = new Set<string>(OPHTH_EVENT_TYPES)
const IMAGING_SET = new Set<string>(OPHTH_IMAGING_TYPES)

export function isOphthEventType(v: unknown): v is OphthAllType {
  return typeof v === 'string' && (OPHTH_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): OphthCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (IMAGING_SET.has(eventType)) return 'imaging'
  return null
}

export interface OphthEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Ophthalmology event tracker (counts only — NEVER interpret) ────
export interface OphthTrackingRow {
  eventType: OphthEventType
  planned: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'active', 'awaiting_review', 'follow_up_due'])

export function buildOphthTracker(events: OphthEvent[] | null | undefined): OphthTrackingRow[] {
  const list = events ?? []
  return OPHTH_EVENT_TYPES.map(eventType => {
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

// ── Imaging / test follow-up (counts only — NEVER interpret) ───────
export interface ImagingTrackingRow {
  imagingType: OphthImagingType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const IMAGING_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildImagingTracker(events: OphthEvent[] | null | undefined): ImagingTrackingRow[] {
  const list = events ?? []
  return OPHTH_IMAGING_TYPES.map(imagingType => {
    const inType = list.filter(e => e.eventType === imagingType)
    return {
      imagingType,
      ordered: inType.filter(e => e.status === 'ordered').length,
      completed: inType.filter(e => e.status === 'completed').length,
      awaitingReview: inType.filter(e => e.status === 'awaiting_review').length,
      reviewed: inType.filter(e => e.status === 'reviewed').length,
      total: inType.filter(e => IMAGING_OPEN.has(e.status)).length,
    }
  })
}

// ── Follow-up reminders (surface only — never interpret) ───────────
export interface OphthReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  eventType?: string   // panel resolves the display name
}

export function buildOphthFollowUp(events: OphthEvent[] | null | undefined): { reminders: OphthReminder[] } {
  const list = events ?? []
  const reminders: OphthReminder[] = []

  const tracking = buildOphthTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'ophth_rem_event_awaiting', params: { count: t.awaitingReview }, eventType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'ophth_rem_event_due', params: { count: t.followUpDue }, eventType: t.eventType })
  }

  const imaging = buildImagingTracker(list)
  for (const im of imaging) {
    if (im.awaitingReview > 0) reminders.push({ code: `${im.imagingType}_awaiting`, severity: 'warning', labelKey: 'ophth_rem_imaging_awaiting', params: { count: im.awaitingReview }, eventType: im.imagingType })
  }
  for (const im of imaging) {
    if (im.ordered > 0) reminders.push({ code: `${im.imagingType}_pending`, severity: 'info', labelKey: 'ophth_rem_imaging_pending', params: { count: im.ordered }, eventType: im.imagingType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary imaging signals (counts only — NEVER interpret) ──
// Surfaces that eye imaging / tests exist in the EXISTING lab_orders and whether
// they are completed. Never the finding — no glaucoma / cataract / retinopathy.
const IMAGING_RE = /fundus|oct\b|optical coherence|visual field|perimetr|retina|ocular|ophthalmic|eye (ultrasound|scan)|angiograph|topograph|pachymetr|biometr/i
export interface OphthImagingSignals { pending: number; completed: number; imaging: number }
export function countOphthImagingSignals(labOrders?: LabOrder[] | null): OphthImagingSignals {
  const orders = labOrders ?? []
  const isImaging = (o: LabOrder) => IMAGING_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => IMAGING_RE.test(i.test_name ?? ''))
  const imaging = orders.filter(isImaging)
  return {
    pending: imaging.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: imaging.filter(o => o.status === 'completed').length,
    imaging: imaging.length,
  }
}

// ── Documentation completeness (reuses GP + ophthalmology prompts) ─
export interface OphthCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeOphthCompleteness(doc: ConsultationDoc): OphthCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'ophth_doc_vision_complaint', 'ophth_doc_visual_acuity', 'ophth_doc_refraction', 'ophth_doc_ocular_history',
    'ophth_doc_eye_meds', 'ophth_doc_anterior_segment', 'ophth_doc_posterior_segment', 'ophth_doc_iop',
    'ophth_doc_imaging_requested', 'ophth_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with ophth counts) ─────────
export interface OphthSummary {
  recentEvents: number
  pendingImaging: number
  awaitingImaging: number
  visualAcuityFollowUp: number
  cataractGlaucoma: number
  diabeticScreening: number
  upcomingFollowUp: number
  recentProcedures: number
  medications: number
}
export interface OphthBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: OphthTrackingRow[]
  imaging: ImagingTrackingRow[]
  imagingSignals: OphthImagingSignals
  followUp: ReturnType<typeof buildOphthFollowUp>
  followUps: FollowUpItem[]
  summary: OphthSummary
}
export function buildOphthBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: OphthEvent[]
  imagingSignals: OphthImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): OphthBrief {
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
  const tracker = buildOphthTracker(input.events)
  const imaging = buildImagingTracker(input.events)
  const openBy = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const summary: OphthSummary = {
    recentEvents: tracker.reduce((s, r) => s + r.total, 0),
    pendingImaging: imaging.reduce((s, r) => s + r.ordered, 0),
    awaitingImaging: imaging.reduce((s, r) => s + r.awaitingReview, 0),
    visualAcuityFollowUp: openBy('visual_acuity'),
    cataractGlaucoma: openBy('cataract_review') + openBy('glaucoma_followup'),
    diabeticScreening: openBy('diabetic_eye_screening'),
    upcomingFollowUp: tracker.reduce((s, r) => s + r.followUpDue, 0),
    recentProcedures: openBy('eye_procedure_followup') + openBy('post_op_review'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, imaging, imagingSignals: input.imagingSignals, followUp: buildOphthFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type OphthAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type OphthConsultations = Consultation[]

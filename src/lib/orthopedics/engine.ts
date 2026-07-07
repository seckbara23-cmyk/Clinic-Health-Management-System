// ── Orthopedics Clinical Copilot — pure engine (Phase 25) ──────────
//
// The EIGHTH production Copilot, focused on MUSCULOSKELETAL WORKFLOW and
// operational follow-up. DETERMINISTIC, read-only, OPERATIONAL only — same
// guarantees as the GP reference (Phase 16) and the Peds/OB-GYN/ORL/Cardiology/
// Emergency/Internal-Medicine extensions (17/18/19/22/23/24). It EXTENDS and
// REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses, classifies a fracture, interprets an X-ray / CT / MRI (no
// "fracture/dislocation/arthritis" call), recommends surgery / a treatment / a
// medication, or predicts healing or disability. It only SURFACES that an
// orthopedic event or an image exists and its workflow status (planned / active
// / awaiting review / follow-up due). Emits only codes / counts / labelKeys → it
// cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const ORTHO_COPILOT_PACK_ID = 'orthopedics.core'
export const ORTHO_SPECIALTIES = ['orthopedics'] as const

/** Active for a doctor whose primary specialty is Orthopedics. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isOrthopedicsContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'orthopedics'
}

// ── Orthopedic event vocabulary ─────────────────────────────────────
// Tracker events — workflow: planned → active → awaiting_review / follow_up_due → completed.
export const ORTHO_EVENT_TYPES = [
  'fracture_followup', 'cast_applied', 'cast_review', 'splint_review', 'wound_review',
  'post_op_review', 'physiotherapy_referral', 'implant_followup', 'joint_injection_followup',
] as const
export type OrthoEventType = (typeof ORTHO_EVENT_TYPES)[number]

// Imaging — workflow: ordered → completed → awaiting_review → reviewed.
export const ORTHO_IMAGING_TYPES = ['xray', 'ct', 'mri'] as const
export type OrthoImagingType = (typeof ORTHO_IMAGING_TYPES)[number]

export const ORTHO_ALL_TYPES = [...ORTHO_EVENT_TYPES, ...ORTHO_IMAGING_TYPES] as const
export type OrthoAllType = (typeof ORTHO_ALL_TYPES)[number]

export const ORTHO_EVENT_STATUSES = [
  'planned', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'ordered', 'reviewed', 'cancelled',
] as const
export type OrthoEventStatus = (typeof ORTHO_EVENT_STATUSES)[number]

export type OrthoCategory = 'event' | 'imaging'

const EVENT_SET = new Set<string>(ORTHO_EVENT_TYPES)
const IMAGING_SET = new Set<string>(ORTHO_IMAGING_TYPES)

export function isOrthoEventType(v: unknown): v is OrthoAllType {
  return typeof v === 'string' && (ORTHO_ALL_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): OrthoCategory | null {
  if (!eventType) return null
  if (EVENT_SET.has(eventType)) return 'event'
  if (IMAGING_SET.has(eventType)) return 'imaging'
  return null
}

export interface OrthoEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Orthopedic event tracker (counts only — NEVER interpret) ───────
export interface OrthoTrackingRow {
  eventType: OrthoEventType
  planned: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'active', 'awaiting_review', 'follow_up_due'])

export function buildOrthoTracker(events: OrthoEvent[] | null | undefined): OrthoTrackingRow[] {
  const list = events ?? []
  return ORTHO_EVENT_TYPES.map(eventType => {
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

// ── Imaging follow-up (counts only — NEVER interpret an image) ─────
export interface ImagingTrackingRow {
  imagingType: OrthoImagingType
  ordered: number
  completed: number
  awaitingReview: number
  reviewed: number
  total: number     // open (ordered / completed / awaiting_review)
}
const IMAGING_OPEN = new Set(['ordered', 'completed', 'awaiting_review'])

export function buildImagingTracker(events: OrthoEvent[] | null | undefined): ImagingTrackingRow[] {
  const list = events ?? []
  return ORTHO_IMAGING_TYPES.map(imagingType => {
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
export interface OrthoReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  eventType?: string   // panel resolves the display name
}

export function buildOrthoFollowUp(events: OrthoEvent[] | null | undefined): { reminders: OrthoReminder[] } {
  const list = events ?? []
  const reminders: OrthoReminder[] = []

  const tracking = buildOrthoTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'ortho_rem_event_awaiting', params: { count: t.awaitingReview }, eventType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'ortho_rem_event_due', params: { count: t.followUpDue }, eventType: t.eventType })
  }

  const imaging = buildImagingTracker(list)
  for (const im of imaging) {
    if (im.awaitingReview > 0) reminders.push({ code: `${im.imagingType}_awaiting`, severity: 'warning', labelKey: 'ortho_rem_imaging_awaiting', params: { count: im.awaitingReview }, eventType: im.imagingType })
  }
  for (const im of imaging) {
    if (im.ordered > 0) reminders.push({ code: `${im.imagingType}_pending`, severity: 'info', labelKey: 'ortho_rem_imaging_pending', params: { count: im.ordered }, eventType: im.imagingType })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Supplementary imaging signals (counts only — NEVER interpret) ──
// Surfaces that orthopedic imaging exists in the EXISTING lab_orders and whether
// it is completed. Never the finding — no fracture / dislocation / arthritis.
const IMAGING_RE = /x-?ray|radiograph|\bct\b|scanner|tomograph|\bmri\b|\birm\b|ultrasound|echograph|imaging|imagerie|radio(?:graphie)?/i
export interface OrthoImagingSignals { pending: number; completed: number; imaging: number }
export function countOrthoImagingSignals(labOrders?: LabOrder[] | null): OrthoImagingSignals {
  const orders = labOrders ?? []
  const isImaging = (o: LabOrder) => IMAGING_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => IMAGING_RE.test(i.test_name ?? ''))
  const imaging = orders.filter(isImaging)
  return {
    pending: imaging.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed: imaging.filter(o => o.status === 'completed').length,
    imaging: imaging.length,
  }
}

// ── Documentation completeness (reuses GP + ortho prompts) ─────────
export interface OrthoCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeOrthoCompleteness(doc: ConsultationDoc): OrthoCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'ortho_doc_mechanism', 'ortho_doc_pain_location', 'ortho_doc_mobility', 'ortho_doc_neurovascular',
    'ortho_doc_limb', 'ortho_doc_imaging_requested', 'ortho_doc_procedure', 'ortho_doc_immobilization',
    'ortho_doc_physiotherapy', 'ortho_doc_follow_up',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with ortho counts) ─────────
export interface OrthoSummary {
  recentEvents: number
  pendingImaging: number
  awaitingImaging: number
  activeCasts: number
  upcomingFollowUp: number
  recentProcedures: number
  physiotherapyReferrals: number
  medications: number
}
export interface OrthoBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: OrthoTrackingRow[]
  imaging: ImagingTrackingRow[]
  imagingSignals: OrthoImagingSignals
  followUp: ReturnType<typeof buildOrthoFollowUp>
  followUps: FollowUpItem[]
  summary: OrthoSummary
}
export function buildOrthoBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: OrthoEvent[]
  imagingSignals: OrthoImagingSignals
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): OrthoBrief {
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
  const tracker = buildOrthoTracker(input.events)
  const imaging = buildImagingTracker(input.events)
  const openBy = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const summary: OrthoSummary = {
    recentEvents: tracker.reduce((s, r) => s + r.total, 0),
    pendingImaging: imaging.reduce((s, r) => s + r.ordered, 0),
    awaitingImaging: imaging.reduce((s, r) => s + r.awaitingReview, 0),
    activeCasts: (input.events ?? []).filter(e => (e.eventType === 'cast_applied' || e.eventType === 'splint_review') && (e.status === 'active' || e.status === 'planned')).length,
    upcomingFollowUp: tracker.reduce((s, r) => s + r.followUpDue, 0),
    recentProcedures: openBy('post_op_review') + openBy('implant_followup') + openBy('joint_injection_followup'),
    physiotherapyReferrals: openBy('physiotherapy_referral'),
    medications: input.activePrescriptions,
  }
  return { gp, tracker, imaging, imagingSignals: input.imagingSignals, followUp: buildOrthoFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type OrthoAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type OrthoConsultations = Consultation[]

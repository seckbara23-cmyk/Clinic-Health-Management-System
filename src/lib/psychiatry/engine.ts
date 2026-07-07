// ── Psychiatry / Mental Health Clinical Copilot — pure engine (Phase 27) ─
//
// The TENTH production Copilot, focused on WORKFLOW, CONTINUITY, DOCUMENTATION
// COMPLETENESS and FOLLOW-UP. DETERMINISTIC, read-only, OPERATIONAL only — same
// guarantees as the GP reference (Phase 16) and every specialty extension since.
// It EXTENDS and REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses, classifies a psychiatric condition, predicts suicide /
// self-harm / any risk, classifies a risk level, recommends treatment /
// medication / involuntary admission, or generates any sensitive psychiatric
// conclusion. It only SURFACES that a mental-health workflow event exists and its
// status (planned / active / awaiting review / follow-up due) and whether a
// safety-plan review is DOCUMENTED (presence only, never its content). Emits only
// codes / counts / labelKeys → it cannot hallucinate a finding.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief (gp-copilot.ts).

import type { Consultation } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  type ConsultationDoc, type FollowUpItem,
} from '@/lib/gp-copilot'

export const MH_COPILOT_PACK_ID = 'psychiatry.core'
export const MH_SPECIALTIES = ['psychiatry'] as const

/** Active for a doctor whose primary specialty is Psychiatry. Strict — no
 *  specialty leakage; the UI additionally gates on the clinic AI toggle. */
export function isPsychiatryContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'psychiatry'
}

// ── Mental-health event vocabulary ──────────────────────────────────
// Workflow events — planned → active → awaiting_review / follow_up_due → completed.
export const MH_EVENT_TYPES = [
  'initial_assessment', 'therapy_session', 'medication_review', 'crisis_followup',
  'safety_plan_review', 'family_meeting', 'referral_followup', 'social_support_review', 'return_visit',
] as const
export type MhEventType = (typeof MH_EVENT_TYPES)[number]

export const MH_EVENT_STATUSES = ['planned', 'active', 'completed', 'awaiting_review', 'follow_up_due', 'cancelled'] as const
export type MhEventStatus = (typeof MH_EVENT_STATUSES)[number]

// Events that indicate active clinical engagement (used to gate the
// "safety-plan documentation missing" nudge — presence only, never a risk call).
const CLINICAL_ENGAGEMENT = new Set(['initial_assessment', 'therapy_session', 'crisis_followup'])

const EVENT_SET = new Set<string>(MH_EVENT_TYPES)

export function isMhEventType(v: unknown): v is MhEventType {
  return typeof v === 'string' && (MH_EVENT_TYPES as readonly string[]).includes(v)
}
export function categoryOf(eventType?: string | null): 'event' | null {
  return eventType && EVENT_SET.has(eventType) ? 'event' : null
}

export interface MhEvent {
  eventType: string
  status: string
  scheduledAt?: string | null
}

// ── Event tracker (counts only — NEVER interpret) ──────────────────
export interface MhTrackingRow {
  eventType: MhEventType
  planned: number
  active: number
  completed: number
  awaitingReview: number
  followUpDue: number
  total: number       // open (planned / active / awaiting_review / follow_up_due)
}
const EVENT_OPEN = new Set(['planned', 'active', 'awaiting_review', 'follow_up_due'])

export function buildMhTracker(events: MhEvent[] | null | undefined): MhTrackingRow[] {
  const list = events ?? []
  return MH_EVENT_TYPES.map(eventType => {
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

/** Is a safety-plan review DOCUMENTED (any status)? Presence only — never its
 *  content, never a risk assessment. */
export function safetyPlanDocumented(events: MhEvent[] | null | undefined): boolean {
  return (events ?? []).some(e => e.eventType === 'safety_plan_review')
}

// ── Follow-up reminders (surface only — never interpret) ───────────
export interface MhReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
  eventType?: string   // panel resolves the display name
}

export function buildMhFollowUp(events: MhEvent[] | null | undefined): { reminders: MhReminder[] } {
  const list = events ?? []
  const reminders: MhReminder[] = []

  const tracking = buildMhTracker(list)
  for (const t of tracking) {
    if (t.awaitingReview > 0) reminders.push({ code: `${t.eventType}_awaiting`, severity: 'warning', labelKey: 'mh_rem_event_awaiting', params: { count: t.awaitingReview }, eventType: t.eventType })
  }
  for (const t of tracking) {
    if (t.followUpDue > 0) reminders.push({ code: `${t.eventType}_due`, severity: 'warning', labelKey: 'mh_rem_event_due', params: { count: t.followUpDue }, eventType: t.eventType })
  }

  // Safety-plan documentation PRESENCE nudge — operational only. Fires when the
  // patient is in active MH care but no safety-plan review has been documented.
  const inCare = list.some(e => CLINICAL_ENGAGEMENT.has(e.eventType) && e.status !== 'cancelled')
  if (inCare && !safetyPlanDocumented(list)) {
    reminders.push({ code: 'safety_plan_missing', severity: 'info', labelKey: 'mh_rem_safety_plan_missing' })
  }

  return { reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)) }
}

// ── Documentation completeness (reuses GP + mental-health prompts) ─
export interface MhCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeMhCompleteness(doc: ConsultationDoc): MhCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = [
    'mh_doc_presenting_concern', 'mh_doc_psychosocial', 'mh_doc_supports', 'mh_doc_medication_review',
    'mh_doc_sleep_appetite', 'mh_doc_functioning', 'mh_doc_safety_plan', 'mh_doc_follow_up', 'mh_doc_referral',
  ]
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Brief (reuses buildGpBrief; extends with MH counts) ────────────
export interface MhSummary {
  recentEvents: number
  sessions: number
  referralFollowUps: number
  safetyPlanDocumented: boolean
  medicationReviewDue: number
  crisisFollowUps: number
  upcomingFollowUp: number
}
export interface MhBrief {
  gp: ReturnType<typeof buildGpBrief>
  tracker: MhTrackingRow[]
  followUp: ReturnType<typeof buildMhFollowUp>
  followUps: FollowUpItem[]
  summary: MhSummary
}
export function buildMhBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  events: MhEvent[]
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): MhBrief {
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
  const tracker = buildMhTracker(input.events)
  const openBy = (t: string) => tracker.find(r => r.eventType === t)?.total ?? 0
  const medReviewRow = tracker.find(r => r.eventType === 'medication_review')
  const summary: MhSummary = {
    recentEvents: tracker.reduce((s, r) => s + r.total, 0),
    sessions: openBy('therapy_session'),
    referralFollowUps: openBy('referral_followup'),
    safetyPlanDocumented: safetyPlanDocumented(input.events),
    medicationReviewDue: (medReviewRow?.followUpDue ?? 0) + (medReviewRow?.awaitingReview ?? 0),
    crisisFollowUps: openBy('crisis_followup'),
    upcomingFollowUp: tracker.reduce((s, r) => s + r.followUpDue, 0),
  }
  return { gp, tracker, followUp: buildMhFollowUp(input.events), followUps: input.followUps, summary }
}

export { buildFollowUps, buildMedicationReview }

export type MhAppointments = Parameters<typeof buildFollowUps>[0]['appointments']
export type MhConsultations = Consultation[]

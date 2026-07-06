// ── General Practice Clinical Copilot — pure engine (Phase 16) ─────
//
// The FIRST production Clinical Copilot and the reference implementation for
// every future specialty. DETERMINISTIC, read-only, OPERATIONAL only.
//
// It NEVER: diagnoses, prescribes, recommends treatment, interprets lab values,
// invents findings, or modifies records. It only: summarises, organises,
// highlights, reminds, and checks documentation completeness. Every output is a
// structured CODE / COUNT / labelKey — this module generates no clinical prose,
// so it cannot hallucinate. Human-facing text lives in i18n (asserted free of
// diagnosis/treatment wording by the test suite).
//
// Reuses existing engines — no duplication:
//   • buildPatientBrief / mergePatientTimeline (patient-intel.ts, Phase 10)
//   • SafetyWarning from medication-safety.ts (Phase 8)

import type { Appointment, Consultation, LabOrder, Prescription } from '@/types/database'
import { buildPatientBrief, mergePatientTimeline, type PatientTimelineItem } from '@/lib/patient-intel'
import type { SafetyWarning } from '@/lib/medication-safety'

// The pack this engine backs, and the contexts it activates for.
export const GP_COPILOT_PACK_ID = 'general_practice.core'
export const GP_SPECIALTIES = ['general_practice', 'family_medicine'] as const

/** Strict match against the pack's supportedSpecialties (doctor + GP/family). */
export function isGeneralPracticeContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && !!primarySpecialtyId && (GP_SPECIALTIES as readonly string[]).includes(primarySpecialtyId)
}

/** Panel-activation rule: a doctor whose primary specialty is GP/family OR is
 *  UNSET (general_practice is the platform's default specialty, Phase 14.1, so an
 *  un-specialised doctor is effectively a generalist). The UI additionally gates
 *  on the clinic AI toggle. */
export function isGeneralPracticeDefault(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && (!primarySpecialtyId || (GP_SPECIALTIES as readonly string[]).includes(primarySpecialtyId))
}

// ── Documentation completeness (Consultation Assistant / Doc Quality) ─
// Measures whether each SOAP section is DOCUMENTED (presence + length) — never
// whether it is clinically correct. It flags empty/thin sections; it never
// judges, fills, or generates content.
export type SoapKey = 'chief_complaint' | 'history' | 'examination' | 'assessment' | 'plan'

export interface CompletenessSection {
  key: SoapKey
  score: number          // 0–100 documentation-presence score
  present: boolean
}
export interface ConsultationCompleteness {
  overall: number        // 0–100
  sections: CompletenessSection[]
  missing: SoapKey[]     // sections with no content
}

// Column each SOAP section is stored in, and a target length that counts as
// "adequately documented" (presence heuristic only — not a quality judgement).
const SOAP_MAP: { key: SoapKey; column: keyof ConsultationDoc; target: number }[] = [
  { key: 'chief_complaint', column: 'chief_complaint', target: 12 },
  { key: 'history', column: 'symptoms', target: 40 },
  { key: 'examination', column: 'notes', target: 40 },
  { key: 'assessment', column: 'diagnosis', target: 12 },
  { key: 'plan', column: 'treatment_plan', target: 25 },
]

export interface ConsultationDoc {
  chief_complaint?: string | null
  symptoms?: string | null
  notes?: string | null
  diagnosis?: string | null
  treatment_plan?: string | null
}

export function computeConsultationCompleteness(doc: ConsultationDoc | null | undefined): ConsultationCompleteness {
  const sections: CompletenessSection[] = SOAP_MAP.map(({ key, column, target }) => {
    const len = String(doc?.[column] ?? '').trim().length
    const score = Math.max(0, Math.min(100, Math.round((len / target) * 100)))
    return { key, score, present: len > 0 }
  })
  const overall = Math.round(sections.reduce((s, x) => s + x.score, 0) / sections.length)
  const missing = sections.filter(s => !s.present).map(s => s.key)
  return { overall, sections, missing }
}

// ── Preventive care reminders (deterministic, clinic-configurable) ──
export type ReminderCategory =
  | 'annual_check' | 'vaccination' | 'cancer_screening' | 'metabolic_check'
  | 'bp_followup' | 'glucose_followup' | 'lifestyle'

export interface PreventiveReminder {
  code: string
  category: ReminderCategory
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
}

export interface PreventiveConfig {
  annualCheckMonths: number
  influenzaAgeMin: number
  cervicalAgeMin: number; cervicalAgeMax: number
  breastAgeMin: number; breastAgeMax: number
  colorectalAgeMin: number; colorectalAgeMax: number
  metabolicAgeMin: number
  bpSystolicThreshold: number; bpDiastolicThreshold: number
  glucoseThreshold: number
  enableVaccination: boolean
  enableScreening: boolean
  enableVitalsFollowup: boolean
  enableLifestyle: boolean
}

// Age bands follow common public-health reminder conventions; every value is
// clinic-configurable (this is the default set, not medical advice).
export const DEFAULT_PREVENTIVE_CONFIG: PreventiveConfig = {
  annualCheckMonths: 12,
  influenzaAgeMin: 65,
  cervicalAgeMin: 30, cervicalAgeMax: 65,
  breastAgeMin: 50, breastAgeMax: 69,
  colorectalAgeMin: 50, colorectalAgeMax: 75,
  metabolicAgeMin: 40,
  bpSystolicThreshold: 140, bpDiastolicThreshold: 90,
  glucoseThreshold: 1.26,
  enableVaccination: true, enableScreening: true, enableVitalsFollowup: true, enableLifestyle: true,
}

export interface PreventiveInput {
  dateOfBirth?: string | null
  gender?: string | null
  lastConsultationAt?: string | null
  latestVitals?: { systolic_bp?: number | null; diastolic_bp?: number | null; blood_glucose?: number | null } | null
  now: Date
  config?: Partial<PreventiveConfig>
}

export function ageFrom(dateOfBirth?: string | null, now: Date = new Date()): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const m = now.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--
  return age >= 0 && age < 150 ? age : null
}

function monthsSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return (now.getTime() - d.getTime()) / (30 * 86_400_000)
}

export function buildPreventiveReminders(input: PreventiveInput): PreventiveReminder[] {
  const cfg = { ...DEFAULT_PREVENTIVE_CONFIG, ...(input.config ?? {}) }
  const age = ageFrom(input.dateOfBirth, input.now)
  const sex = (input.gender ?? '').toLowerCase()
  const monthsSinceVisit = monthsSince(input.lastConsultationAt, input.now)
  const overdueVisit = monthsSinceVisit === null || monthsSinceVisit >= cfg.annualCheckMonths
  const out: PreventiveReminder[] = []

  if (overdueVisit) out.push({ code: 'annual_check', category: 'annual_check', severity: 'info', labelKey: 'rem_annual_check' })

  if (age !== null && cfg.enableScreening) {
    if (sex === 'female' && age >= cfg.cervicalAgeMin && age <= cfg.cervicalAgeMax)
      out.push({ code: 'screening_cervical', category: 'cancer_screening', severity: 'info', labelKey: 'rem_screening_cervical' })
    if (sex === 'female' && age >= cfg.breastAgeMin && age <= cfg.breastAgeMax)
      out.push({ code: 'screening_breast', category: 'cancer_screening', severity: 'info', labelKey: 'rem_screening_breast' })
    if (age >= cfg.colorectalAgeMin && age <= cfg.colorectalAgeMax)
      out.push({ code: 'screening_colorectal', category: 'cancer_screening', severity: 'info', labelKey: 'rem_screening_colorectal' })
  }

  if (age !== null && cfg.enableVaccination && age >= cfg.influenzaAgeMin) {
    out.push({ code: 'vaccination_influenza', category: 'vaccination', severity: 'info', labelKey: 'rem_vaccination_influenza' })
    out.push({ code: 'vaccination_pneumococcal', category: 'vaccination', severity: 'info', labelKey: 'rem_vaccination_pneumococcal' })
  }

  if (age !== null && age >= cfg.metabolicAgeMin && overdueVisit)
    out.push({ code: 'metabolic_check', category: 'metabolic_check', severity: 'info', labelKey: 'rem_metabolic_check' })

  // Vitals-based reminders SURFACE a recorded measurement + a routine reminder.
  // They report the value as-is and never interpret it into a diagnosis.
  if (cfg.enableVitalsFollowup && input.latestVitals) {
    const { systolic_bp, diastolic_bp, blood_glucose } = input.latestVitals
    if ((systolic_bp ?? 0) >= cfg.bpSystolicThreshold || (diastolic_bp ?? 0) >= cfg.bpDiastolicThreshold) {
      out.push({
        code: 'bp_followup', category: 'bp_followup', severity: 'warning', labelKey: 'rem_bp_followup',
        params: { systolic: systolic_bp ?? 0, diastolic: diastolic_bp ?? 0 },
      })
    }
    if ((blood_glucose ?? 0) >= cfg.glucoseThreshold) {
      out.push({ code: 'glucose_followup', category: 'glucose_followup', severity: 'warning', labelKey: 'rem_glucose_followup', params: { value: blood_glucose ?? 0 } })
    }
  }

  if (cfg.enableLifestyle && (age === null || age >= 18))
    out.push({ code: 'lifestyle', category: 'lifestyle', severity: 'info', labelKey: 'rem_lifestyle' })

  // Warnings before informational reminders.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1))
}

// ── Follow-up assistant (highlight only) ────────────────────────────
export type FollowUpCode =
  | 'missed_appointment' | 'outstanding_lab' | 'result_awaiting_review'
  | 'unclosed_consultation' | 'missed_followup' | 'upcoming_followup'

export interface FollowUpItem {
  code: FollowUpCode
  severity: 'info' | 'warning'
  count: number
  labelKey: string
  params?: Record<string, string | number>
}

const OUTSTANDING_LAB = new Set(['ordered', 'sample_collected', 'in_progress'])

function dayKey(iso: string, now: Date): 'past' | 'today' | 'future' {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'past'
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())
  const a = day(d); const b = day(now)
  return a < b ? 'past' : a > b ? 'future' : 'today'
}

export function buildFollowUps(input: {
  appointments?: Appointment[]
  labOrders?: LabOrder[]
  consultations?: Consultation[]
  now: Date
}): FollowUpItem[] {
  const appts = input.appointments ?? []
  const labs = input.labOrders ?? []
  const consults = input.consultations ?? []
  const items: FollowUpItem[] = []

  const missedAppts = appts.filter(a => a.status === 'no_show').length
  if (missedAppts) items.push({ code: 'missed_appointment', severity: 'warning', count: missedAppts, labelKey: 'fu_missed_appointment' })

  const outstandingLabs = labs.filter(l => OUTSTANDING_LAB.has(l.status)).length
  if (outstandingLabs) items.push({ code: 'outstanding_lab', severity: 'info', count: outstandingLabs, labelKey: 'fu_outstanding_lab' })

  // Results are ready but not yet marked reviewed by a physician — operational.
  const awaitingReview = labs.filter(l => l.status === 'completed').length
  if (awaitingReview) items.push({ code: 'result_awaiting_review', severity: 'warning', count: awaitingReview, labelKey: 'fu_result_awaiting_review' })

  const unclosed = consults.filter(c => !c.ended_at).length
  if (unclosed) items.push({ code: 'unclosed_consultation', severity: 'info', count: unclosed, labelKey: 'fu_unclosed_consultation' })

  // Follow-up dates from consultations: missed (past, no later consult) vs upcoming.
  const followDates = consults.filter(c => !!c.follow_up_date)
  const latestConsultDate = consults.reduce<number>((m, c) => Math.max(m, new Date(c.created_at).getTime()), 0)
  let missedFollowUp = 0
  let upcomingFollowUp = 0
  for (const c of followDates) {
    const when = dayKey(c.follow_up_date as string, input.now)
    if (when === 'future' || when === 'today') upcomingFollowUp++
    else if (new Date(c.follow_up_date as string).getTime() > 0 && new Date(c.created_at).getTime() >= latestConsultDate) {
      // The most recent consultation's follow-up date is in the past with no
      // newer visit → a genuinely missed follow-up.
      missedFollowUp++
    }
  }
  if (missedFollowUp) items.push({ code: 'missed_followup', severity: 'warning', count: missedFollowUp, labelKey: 'fu_missed_followup' })
  if (upcomingFollowUp) items.push({ code: 'upcoming_followup', severity: 'info', count: upcomingFollowUp, labelKey: 'fu_upcoming_followup' })

  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1))
}

// ── Medication review (reuses medication-safety warnings) ───────────
export interface MedicationReview {
  activeCount: number
  recentChangeCount: number
  warnings: SafetyWarning[]
  hasAllergyConflict: boolean
  hasDuplicate: boolean
  hasStockIssue: boolean
  hasExpiryIssue: boolean
}

export function buildMedicationReview(input: {
  activeMedNames: string[]
  warnings: SafetyWarning[]
  prescriptions?: Prescription[]
  now: Date
  recentDays?: number
}): MedicationReview {
  const recentMs = (input.recentDays ?? 30) * 86_400_000
  const recentChangeCount = (input.prescriptions ?? []).filter(p => {
    const t = new Date(p.created_at).getTime()
    return Number.isFinite(t) && input.now.getTime() - t <= recentMs
  }).length
  const codes = new Set(input.warnings.map(w => w.code))
  return {
    activeCount: input.activeMedNames.length,
    recentChangeCount,
    warnings: input.warnings,
    hasAllergyConflict: codes.has('allergy'),
    hasDuplicate: codes.has('duplicate_exact') || codes.has('duplicate_ingredient') || codes.has('duplicate_class'),
    hasStockIssue: codes.has('out_of_stock') || codes.has('low_stock'),
    hasExpiryIssue: codes.has('near_expiry'),
  }
}

// ── Operational timeline highlighting (reuses mergePatientTimeline) ──
export type TimelineHighlight = 'today' | 'recent' | 'outstanding' | null
export interface HighlightedTimelineItem extends PatientTimelineItem { highlight: TimelineHighlight }

const OUTSTANDING_TIMELINE_STATUS = new Set(['ongoing', 'ordered', 'sample_collected', 'in_progress', 'draft', 'sent', 'partial', 'overdue'])

export function highlightTimeline(
  items: PatientTimelineItem[],
  opts: { now: Date; currentConsultationId?: string | null; recentDays?: number },
): HighlightedTimelineItem[] {
  const recentMs = (opts.recentDays ?? 7) * 86_400_000
  return items.map(item => {
    let highlight: TimelineHighlight = null
    const isToday = dayKey(item.date, opts.now) === 'today'
    if (item.type === 'consultation' && (isToday || (opts.currentConsultationId && item.id === `c-${opts.currentConsultationId}`))) {
      highlight = 'today'
    } else if (item.status && OUTSTANDING_TIMELINE_STATUS.has(item.status)) {
      highlight = 'outstanding'
    } else if (opts.now.getTime() - new Date(item.date).getTime() <= recentMs) {
      highlight = 'recent'
    }
    return { ...item, highlight }
  })
}

/** Convenience: merge patient sources then highlight (one call for the panel). */
export function buildOperationalTimeline(
  sources: Parameters<typeof mergePatientTimeline>[0],
  opts: { now: Date; currentConsultationId?: string | null; recentDays?: number },
): HighlightedTimelineItem[] {
  return highlightTimeline(mergePatientTimeline(sources), opts)
}

// ── Clinical brief (reuses buildPatientBrief for confidence + sources) ─
export interface GpBriefLine {
  code: string
  labelKey: string
  value: number | string
  severity: 'info' | 'warning' | 'critical'
}
export interface GpBrief {
  lines: GpBriefLine[]
  confidence: 'high' | 'medium' | 'low'
  sources: string[]
  reminderCount: number
  followUpCount: number
  hasIssues: boolean
}

export function buildGpBrief(input: {
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  reminders: PreventiveReminder[]
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): GpBrief {
  // Reuse the Phase-10 brief for the confidence/sources derivation (no dup).
  const base = buildPatientBrief({
    activePrescriptions: input.activePrescriptions,
    pendingLabReviews: input.pendingLabReviews,
    outstandingBalance: input.outstandingBalance,
    loaded: input.loaded,
  })

  const followUpCount = input.followUps.reduce((s, f) => s + f.count, 0)
  const lines: GpBriefLine[] = [
    { code: 'active_medications', labelKey: 'brief_active_medications', value: input.activePrescriptions, severity: 'info' },
    { code: 'allergies', labelKey: 'brief_allergies', value: input.allergyCount, severity: input.allergyCount > 0 ? 'warning' : 'info' },
    { code: 'pending_lab_reviews', labelKey: 'brief_pending_lab_reviews', value: input.pendingLabReviews, severity: input.pendingLabReviews > 0 ? 'warning' : 'info' },
    { code: 'upcoming_appointments', labelKey: 'brief_upcoming_appointments', value: input.upcomingAppointments, severity: 'info' },
    { code: 'outstanding_balance', labelKey: 'brief_outstanding_balance', value: input.outstandingBalance, severity: input.outstandingBalance > 0 ? 'warning' : 'info' },
    { code: 'pending_follow_ups', labelKey: 'brief_pending_follow_ups', value: followUpCount, severity: followUpCount > 0 ? 'warning' : 'info' },
    { code: 'preventive_reminders', labelKey: 'brief_preventive_reminders', value: input.reminders.length, severity: 'info' },
  ]

  return {
    lines,
    confidence: base.confidence,
    sources: base.sources,
    reminderCount: input.reminders.length,
    followUpCount,
    hasIssues: base.hasIssues || followUpCount > 0 || input.allergyCount > 0,
  }
}

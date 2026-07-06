// ── Obstetrics & Gynecology Clinical Copilot — pure engine (Phase 18) ─
//
// The THIRD production Copilot. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16) and the Pediatrics extension
// (Phase 17). It EXTENDS and REUSES the GP engine; it does NOT duplicate it.
//
// It NEVER: diagnoses (incl. pregnancy complications / preeclampsia), recommends
// treatment or a delivery method, prescribes, interprets fetal monitoring / CTG
// or ultrasound, or classifies pregnancy risk (no validated ruleset here — any
// such feature is a labelled placeholder). Gestational age / EDD are simple
// calendar arithmetic (Naegele), never a risk assessment. Emits only codes /
// counts / labelKeys → cannot hallucinate.
//
// Reuses (no re-implementation): computeConsultationCompleteness, buildFollowUps,
// buildMedicationReview, buildGpBrief, ageFrom (gp-copilot.ts).

import type { Consultation, LabOrder } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  ageFrom, type ConsultationDoc, type FollowUpItem, type MedicationReview,
} from '@/lib/gp-copilot'
import type { SafetyWarning } from '@/lib/medication-safety'

export const OBGYN_COPILOT_PACK_ID = 'obstetrics.core'
export const OBGYN_SPECIALTIES = ['obgyn', 'midwifery'] as const
export const OBGYN_PROFESSIONS = ['doctor', 'midwife'] as const

/** Active for an OB/GYN or midwife whose primary specialty is obgyn/midwifery.
 *  Strict — no specialty leakage; the UI also gates on the AI toggle. */
export function isObgynContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return (OBGYN_PROFESSIONS as readonly string[]).includes(professionId ?? '')
    && (OBGYN_SPECIALTIES as readonly string[]).includes(primarySpecialtyId ?? '')
}

// ── Gestational age & estimated due date (Naegele — pure calendar math) ─
export const GESTATION_DAYS = 280 // 40 weeks from LMP (Naegele's rule)

/** EDD = LMP + 280 days. Pure date arithmetic — NOT a clinical assessment. */
export function estimateDueDate(lmpDate?: string | null): string | null {
  const lmp = parseDate(lmpDate)
  if (!lmp) return null
  const edd = new Date(lmp.getTime() + GESTATION_DAYS * 86_400_000)
  return edd.toISOString().slice(0, 10)
}

export interface GestationalAge { totalDays: number; weeks: number; days: number }

/** Gestational age from LMP as completed weeks + days. Null if no/invalid LMP
 *  or a future date. Pure arithmetic — never a viability/risk judgement. */
export function computeGestationalAge(lmpDate?: string | null, now: Date = new Date()): GestationalAge | null {
  const lmp = parseDate(lmpDate)
  if (!lmp) return null
  const totalDays = Math.floor((startOfDay(now).getTime() - startOfDay(lmp).getTime()) / 86_400_000)
  if (totalDays < 0 || totalDays > 320) return null // outside a plausible pregnancy window
  return { totalDays, weeks: Math.floor(totalDays / 7), days: totalDays % 7 }
}

export function trimesterOf(ga: GestationalAge | null): 1 | 2 | 3 | null {
  if (!ga) return null
  if (ga.weeks < 14) return 1
  if (ga.weeks < 28) return 2
  return 3
}

// ── Pregnancy / ANC tracking ────────────────────────────────────────
export type PregnancyStatus = 'ongoing' | 'postpartum' | 'completed' | 'ended'

export interface PregnancyRecord {
  lmp_date?: string | null
  estimated_due_date?: string | null
  pregnancy_status?: string | null
  gravida?: number | null
  para?: number | null
}

export interface AncReminder {
  code: string
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
}

export interface PregnancyTracking {
  hasPregnancy: boolean          // neutral empty state when false
  status: PregnancyStatus | null
  gestationalAge: GestationalAge | null
  trimester: 1 | 2 | 3 | null
  estimatedDueDate: string | null
  gravida: number | null
  para: number | null
  ancVisitCount: number
  reminders: AncReminder[]
}

const ANC_STALE_WEEKS = 6 // configurable operational threshold for "no recent ANC"

export function buildPregnancyTracking(input: {
  pregnancy: PregnancyRecord | null | undefined
  consultations?: Consultation[]
  hasRecentVitals?: boolean
  hasPregnancyLabs?: boolean
  now: Date
}): PregnancyTracking {
  const p = input.pregnancy
  if (!p) {
    return { hasPregnancy: false, status: null, gestationalAge: null, trimester: null, estimatedDueDate: null, gravida: null, para: null, ancVisitCount: 0, reminders: [] }
  }

  const status = normalizeStatus(p.pregnancy_status)
  const ga = computeGestationalAge(p.lmp_date, input.now)
  const edd = p.estimated_due_date ?? estimateDueDate(p.lmp_date)
  const lmp = parseDate(p.lmp_date)

  // ANC visit count = consultations on/after the LMP (a labelled proxy — there is
  // no dedicated ANC-visit marker; this never claims clinical precision).
  const ancVisitCount = lmp
    ? (input.consultations ?? []).filter(c => new Date(c.created_at).getTime() >= startOfDay(lmp).getTime()).length
    : 0

  const lastAnc = lmp
    ? (input.consultations ?? [])
        .filter(c => new Date(c.created_at).getTime() >= startOfDay(lmp).getTime())
        .reduce<number>((m, c) => Math.max(m, new Date(c.created_at).getTime()), 0)
    : 0

  const reminders: AncReminder[] = []
  const overduePostpartum = status === 'postpartum' || (!!edd && startOfDay(input.now).getTime() > new Date(edd).getTime())

  if (status === 'ongoing') {
    const weeksSinceAnc = lastAnc ? (input.now.getTime() - lastAnc) / (7 * 86_400_000) : Infinity
    if (!lastAnc) reminders.push({ code: 'anc_no_recent', severity: 'warning', labelKey: 'obg_rem_anc_no_recent' })
    else if (weeksSinceAnc >= ANC_STALE_WEEKS) reminders.push({ code: 'anc_overdue', severity: 'warning', labelKey: 'obg_rem_anc_overdue' })
    if (input.hasRecentVitals === false) reminders.push({ code: 'anc_missing_vitals', severity: 'info', labelKey: 'obg_rem_missing_vitals' })
    if (input.hasPregnancyLabs === false) reminders.push({ code: 'anc_missing_labs', severity: 'info', labelKey: 'obg_rem_missing_labs' })
  }
  if (overduePostpartum) reminders.push({ code: 'postpartum_followup', severity: 'warning', labelKey: 'obg_rem_postpartum_followup' })

  return {
    hasPregnancy: true, status, gestationalAge: ga, trimester: trimesterOf(ga),
    estimatedDueDate: edd, gravida: p.gravida ?? null, para: p.para ?? null,
    ancVisitCount, reminders: reminders.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)),
  }
}

// ── Women's health reminders (deterministic, config-driven) ────────
export interface WomensHealthConfig {
  cervicalAgeMin: number; cervicalAgeMax: number
  breastAgeMin: number; breastAgeMax: number
  familyPlanningAgeMin: number; familyPlanningAgeMax: number
  annualReviewAgeMin: number
}
export const DEFAULT_WOMENS_HEALTH_CONFIG: WomensHealthConfig = {
  cervicalAgeMin: 30, cervicalAgeMax: 65,
  breastAgeMin: 50, breastAgeMax: 69,
  familyPlanningAgeMin: 15, familyPlanningAgeMax: 49,
  annualReviewAgeMin: 18,
}

export interface WomensHealthReminder { code: string; severity: 'info' | 'warning'; labelKey: string }

export function buildWomensHealthReminders(input: {
  dateOfBirth?: string | null
  gender?: string | null
  pregnancyStatus?: PregnancyStatus | null
  now: Date
  config?: Partial<WomensHealthConfig>
}): WomensHealthReminder[] {
  const cfg = { ...DEFAULT_WOMENS_HEALTH_CONFIG, ...(input.config ?? {}) }
  const out: WomensHealthReminder[] = []
  if ((input.gender ?? '').toLowerCase() !== 'female') return out
  const age = ageFrom(input.dateOfBirth, input.now)
  const pregnant = input.pregnancyStatus === 'ongoing'

  if (input.pregnancyStatus === 'postpartum')
    out.push({ code: 'postpartum_review', severity: 'info', labelKey: 'obg_wh_postpartum_review' })

  if (age !== null) {
    if (age >= cfg.cervicalAgeMin && age <= cfg.cervicalAgeMax)
      out.push({ code: 'cervical_screening', severity: 'info', labelKey: 'obg_wh_cervical_screening' })
    if (age >= cfg.breastAgeMin && age <= cfg.breastAgeMax)
      out.push({ code: 'breast_screening', severity: 'info', labelKey: 'obg_wh_breast_screening' })
    if (!pregnant && age >= cfg.familyPlanningAgeMin && age <= cfg.familyPlanningAgeMax) {
      out.push({ code: 'family_planning', severity: 'info', labelKey: 'obg_wh_family_planning' })
      out.push({ code: 'contraception_followup', severity: 'info', labelKey: 'obg_wh_contraception_followup' })
    }
    if (age >= cfg.annualReviewAgeMin)
      out.push({ code: 'annual_gyne_review', severity: 'info', labelKey: 'obg_wh_annual_review' })
  }
  return out
}

// ── Documentation completeness (reuses GP + OB/GYN prompts) ────────
export interface ObgynCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  prompts: string[]
}
export function computeObgynCompleteness(doc: ConsultationDoc, opts?: { pregnancy?: boolean }): ObgynCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts = ['obg_doc_obstetric_history', 'obg_doc_gynecologic_history', 'obg_doc_vitals']
  if (opts?.pregnancy) prompts.push('obg_doc_anc_followup')
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Medication review (reuses GP; pregnancy-safety is a PLACEHOLDER) ─
export interface ObgynMedicationReview extends MedicationReview {
  /** Pregnancy-specific medication classification is NOT implemented (no
   *  validated ruleset) — the UI shows a placeholder, never a classification. */
  pregnancyMedSafetySupported: false
  isPregnant: boolean
}
export function buildObgynMedicationReview(input: {
  activeMedNames: string[]; warnings: SafetyWarning[]; now: Date; isPregnant: boolean
}): ObgynMedicationReview {
  const base = buildMedicationReview({ activeMedNames: input.activeMedNames, warnings: input.warnings, now: input.now })
  return { ...base, pregnancyMedSafetySupported: false, isPregnant: input.isPregnant }
}

// ── Lab & ultrasound follow-up (surface only — never interpret) ────
const ULTRASOUND_RE = /ultrasound|ultrason|échograph|echograph|sonograph|obstetric scan/i

export function countUltrasoundOrders(labOrders?: LabOrder[] | null): number {
  return (labOrders ?? []).filter(o =>
    ULTRASOUND_RE.test(o.clinical_notes ?? '') || (o.items ?? []).some(i => ULTRASOUND_RE.test(i.test_name ?? '')),
  ).length
}

export interface LabUltrasoundFollowUp {
  followUps: FollowUpItem[]
  ultrasoundOrders: number
  awaitingReview: number
}
export function buildLabUltrasoundFollowUp(input: {
  labOrders?: LabOrder[]; consultations?: Consultation[]; appointments?: Parameters<typeof buildFollowUps>[0]['appointments']; now: Date
}): LabUltrasoundFollowUp {
  const followUps = buildFollowUps({ appointments: input.appointments, labOrders: input.labOrders, consultations: input.consultations, now: input.now })
  return {
    followUps,
    ultrasoundOrders: countUltrasoundOrders(input.labOrders),
    awaitingReview: (input.labOrders ?? []).filter(l => l.status === 'completed').length,
  }
}

// ── OB/GYN clinical brief (reuses buildGpBrief) ────────────────────
export interface ObgynBrief {
  gp: ReturnType<typeof buildGpBrief>
  pregnancy: PregnancyTracking
  ultrasoundOrders: number
  followUps: FollowUpItem[]
}
export function buildObgynBrief(input: {
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  pregnancy: PregnancyTracking
  ultrasoundOrders: number
  followUps: FollowUpItem[]
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): ObgynBrief {
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
  return { gp, pregnancy: input.pregnancy, ultrasoundOrders: input.ultrasoundOrders, followUps: input.followUps }
}

export { buildFollowUps }

// ── helpers ─────────────────────────────────────────────────────────
function parseDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function normalizeStatus(v?: string | null): PregnancyStatus {
  return v === 'postpartum' || v === 'completed' || v === 'ended' ? v : 'ongoing'
}

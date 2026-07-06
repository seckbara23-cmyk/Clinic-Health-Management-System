// ── Pediatrics Clinical Copilot — pure engine (Phase 17) ───────────
//
// The SECOND production Copilot. DETERMINISTIC, read-only, OPERATIONAL only —
// same guarantees as the GP reference (Phase 16): NEVER diagnoses, prescribes,
// recommends treatment, interprets lab values, invents growth percentiles, or
// presents the vaccination schedule as definitive. It EXTENDS the GP engine
// additively and reuses it — no duplication.
//
// Reuses (no re-implementation):
//   • computeConsultationCompleteness, buildFollowUps, buildMedicationReview,
//     buildGpBrief, ageFrom (gp-copilot.ts, Phase 16)
//   • the vaccination-schedule / milestone registries (schedule.ts)

import type { ConsultationVitals } from '@/types/database'
import {
  computeConsultationCompleteness, buildFollowUps, buildMedicationReview, buildGpBrief,
  ageFrom, type ConsultationDoc, type FollowUpItem, type MedicationReview,
} from '@/lib/gp-copilot'
import type { SafetyWarning } from '@/lib/medication-safety'
import {
  VACCINATION_SCHEDULE, VACCINATION_SCHEDULE_VERSION, DEVELOPMENTAL_MILESTONES,
  getVaccineDose, type VaccineDose,
} from './schedule'

export const PEDS_COPILOT_PACK_ID = 'pediatrics.core'
export const PEDS_SPECIALTIES = ['pediatrics'] as const

/** A Pediatrics Copilot is active for a doctor whose primary specialty is
 *  pediatrics. Strict — no specialty leakage. UI also gates on the AI toggle. */
export function isPediatricContext(professionId?: string | null, primarySpecialtyId?: string | null): boolean {
  return professionId === 'doctor' && primarySpecialtyId === 'pediatrics'
}

// ── Age (years / months / days) ─────────────────────────────────────
export interface PediatricAge {
  years: number
  months: number
  days: number
  totalDays: number
  totalWeeks: number
  totalMonths: number
  /** Which unit best describes this child, for display. */
  displayUnit: 'days' | 'weeks' | 'months' | 'years'
}

export function formatPediatricAge(dateOfBirth?: string | null, now: Date = new Date()): PediatricAge | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime()) || dob.getTime() > now.getTime()) return null

  const totalDays = Math.floor((now.getTime() - dob.getTime()) / 86_400_000)
  const totalWeeks = Math.floor(totalDays / 7)
  const years = ageFrom(dateOfBirth, now) ?? 0

  // Calendar-accurate years/months/days breakdown.
  let y = now.getUTCFullYear() - dob.getUTCFullYear()
  let m = now.getUTCMonth() - dob.getUTCMonth()
  let d = now.getUTCDate() - dob.getUTCDate()
  if (d < 0) { m -= 1; d += daysInMonth(now.getUTCFullYear(), now.getUTCMonth()) }
  if (m < 0) { y -= 1; m += 12 }
  const totalMonths = y * 12 + m

  const displayUnit: PediatricAge['displayUnit'] =
    totalDays < 14 ? 'days' : totalMonths < 2 ? 'weeks' : years < 2 ? 'months' : 'years'

  return { years: y, months: m, days: d, totalDays, totalWeeks, totalMonths, displayUnit }
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0, 0)).getUTCDate()
}

// ── Growth monitoring (from EXISTING consultation_vitals) ──────────
export type GrowthTrend = 'up' | 'down' | 'stable' | null
export interface GrowthPoint { date: string; weightKg: number | null; heightCm: number | null; bmi: number | null }
export interface GrowthMonitoring {
  points: GrowthPoint[]
  latest: GrowthPoint | null
  trend: { weight: GrowthTrend; height: GrowthTrend; bmi: GrowthTrend }
  missing: ('weight' | 'height')[]
  // Honestly-labelled: not implemented, never invented.
  headCircumferenceSupported: false
  percentilesSupported: false
}

export function buildGrowthMonitoring(vitalsHistory: ConsultationVitals[] | null | undefined): GrowthMonitoring {
  const points: GrowthPoint[] = (vitalsHistory ?? [])
    .map(v => ({ date: v.created_at, weightKg: numOrNull(v.weight_kg), heightCm: numOrNull(v.height_cm), bmi: numOrNull(v.bmi) }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) // oldest → newest

  const latest = points.length ? points[points.length - 1] : null
  const missing: ('weight' | 'height')[] = []
  if (!latest || latest.weightKg == null) missing.push('weight')
  if (!latest || latest.heightCm == null) missing.push('height')

  return {
    points,
    latest,
    trend: { weight: trendOf(points, p => p.weightKg), height: trendOf(points, p => p.heightCm), bmi: trendOf(points, p => p.bmi) },
    missing,
    headCircumferenceSupported: false,
    percentilesSupported: false,
  }
}

function trendOf(points: GrowthPoint[], pick: (p: GrowthPoint) => number | null): GrowthTrend {
  const vals = points.map(pick).filter((x): x is number => x != null)
  if (vals.length < 2) return null
  const prev = vals[vals.length - 2]; const last = vals[vals.length - 1]
  return last > prev ? 'up' : last < prev ? 'down' : 'stable'
}

// ── Vaccination status (schedule registry vs received records) ─────
export type VaxState = 'received' | 'due' | 'overdue'
export interface VaxEntry { dose: VaccineDose; state: VaxState; administeredAt?: string | null }
export interface VaccinationStatus {
  entries: VaxEntry[]
  received: VaxEntry[]
  due: VaxEntry[]
  overdue: VaxEntry[]
  catchUp: VaxEntry[]
  receivedCount: number
  dueCount: number
  overdueCount: number
  scheduleVersion: string
  isPlaceholder: true       // callers MUST show the "verify locally" label
}

export interface ReceivedVaccination { vaccine_code: string; administered_at?: string | null }

export function buildVaccinationStatus(
  dateOfBirth: string | null | undefined,
  received: ReceivedVaccination[] | null | undefined,
  now: Date = new Date(),
  graceWeeks = 4,
): VaccinationStatus {
  const receivedByCode = new Map((received ?? []).map(r => [r.vaccine_code, r]))
  const age = formatPediatricAge(dateOfBirth, now)
  const ageWeeks = age?.totalWeeks ?? null
  const entries: VaxEntry[] = []

  for (const dose of VACCINATION_SCHEDULE) {
    const got = receivedByCode.get(dose.code)
    if (got) { entries.push({ dose, state: 'received', administeredAt: got.administered_at ?? null }); continue }
    if (ageWeeks == null) continue // no DOB → cannot compute due/overdue (only 'received' shown)
    if (ageWeeks >= dose.dueWeeks + graceWeeks) entries.push({ dose, state: 'overdue' })
    else if (ageWeeks >= dose.dueWeeks) entries.push({ dose, state: 'due' })
    // else upcoming → not surfaced as an action item
  }

  const receivedE = entries.filter(e => e.state === 'received')
  const dueE = entries.filter(e => e.state === 'due')
  const overdueE = entries.filter(e => e.state === 'overdue')

  return {
    entries, received: receivedE, due: dueE, overdue: overdueE, catchUp: overdueE,
    receivedCount: receivedE.length, dueCount: dueE.length, overdueCount: overdueE.length,
    scheduleVersion: VACCINATION_SCHEDULE_VERSION, isPlaceholder: true,
  }
}

// ── Pediatric reminders (deterministic; extends the GP idea) ───────
export type PedReminderCategory = 'vaccination' | 'growth' | 'nutrition' | 'milestone' | 'medication'
export interface PediatricReminder {
  code: string
  category: PedReminderCategory
  severity: 'info' | 'warning'
  labelKey: string
  params?: Record<string, string | number>
}

export function buildPediatricReminders(input: {
  dateOfBirth?: string | null
  vaccination: VaccinationStatus
  growth: GrowthMonitoring
  now: Date
}): PediatricReminder[] {
  const out: PediatricReminder[] = []
  const age = formatPediatricAge(input.dateOfBirth, input.now)
  const months = age?.totalMonths ?? null

  if (input.vaccination.overdueCount > 0)
    out.push({ code: 'vax_overdue', category: 'vaccination', severity: 'warning', labelKey: 'ped_rem_vax_overdue', params: { count: input.vaccination.overdueCount } })
  if (input.vaccination.dueCount > 0)
    out.push({ code: 'vax_due', category: 'vaccination', severity: 'info', labelKey: 'ped_rem_vax_due', params: { count: input.vaccination.dueCount } })

  if (input.growth.missing.includes('weight'))
    out.push({ code: 'growth_weight_missing', category: 'growth', severity: 'warning', labelKey: 'ped_rem_weight_missing' })
  if (input.growth.missing.includes('height'))
    out.push({ code: 'growth_height_missing', category: 'growth', severity: 'info', labelKey: 'ped_rem_height_missing' })

  if (months != null) {
    if (months < 6) out.push({ code: 'nutrition_breastfeeding', category: 'nutrition', severity: 'info', labelKey: 'ped_rem_breastfeeding' })
    else if (months < 24) out.push({ code: 'nutrition_complementary', category: 'nutrition', severity: 'info', labelKey: 'ped_rem_complementary_feeding' })
    out.push({ code: 'nutrition_review', category: 'nutrition', severity: 'info', labelKey: 'ped_rem_nutrition_review' })

    // Milestone review when the child is near a registered review age (±1 month).
    if (DEVELOPMENTAL_MILESTONES.some(m => Math.abs(m.ageMonths - months) <= 1))
      out.push({ code: 'milestone_review', category: 'milestone', severity: 'info', labelKey: 'ped_rem_milestone_review' })
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1))
}

// ── Pediatric documentation completeness (reuses GP + pediatric prompts) ─
export interface PediatricCompleteness {
  overall: number
  sections: ReturnType<typeof computeConsultationCompleteness>['sections']
  missing: ReturnType<typeof computeConsultationCompleteness>['missing']
  /** Pediatric-specific documentation PROMPTS (reminders, not content-scored —
   *  no dedicated columns exist to measure feeding/sleep/parent-concern). */
  prompts: string[]
}

export function computePediatricCompleteness(
  doc: ConsultationDoc,
  opts?: { weightRecordedThisVisit?: boolean },
): PediatricCompleteness {
  const base = computeConsultationCompleteness(doc)
  const prompts: string[] = ['ped_doc_parent_concern', 'ped_doc_feeding', 'ped_doc_sleep', 'ped_doc_vaccination_review']
  if (!opts?.weightRecordedThisVisit) prompts.push('ped_doc_growth')
  return { overall: base.overall, sections: base.sections, missing: base.missing, prompts }
}

// ── Pediatric medication review (reuses GP; adds deterministic peds flags) ─
export interface PediatricMedicationReview extends MedicationReview {
  weightMissing: boolean   // needed for a safe pediatric review — NOT for dosing
  ageMissing: boolean
}

export function buildPediatricMedicationReview(input: {
  activeMedNames: string[]
  warnings: SafetyWarning[]
  now: Date
  hasWeight: boolean
  hasAge: boolean
}): PediatricMedicationReview {
  const base = buildMedicationReview({ activeMedNames: input.activeMedNames, warnings: input.warnings, now: input.now })
  return { ...base, weightMissing: !input.hasWeight, ageMissing: !input.hasAge }
}

// ── Pediatric clinical brief (reuses buildGpBrief, adds peds lines) ─
export interface PediatricBrief {
  ageLabel: PediatricAge | null
  guardian: string | null
  gp: ReturnType<typeof buildGpBrief>
  vaccinationSummary: { received: number; due: number; overdue: number }
  growthSummary: { latest: GrowthPoint | null; missing: ('weight' | 'height')[] }
  followUps: FollowUpItem[]
}

export function buildPediatricBrief(input: {
  dateOfBirth?: string | null
  guardian?: string | null
  now: Date
  activePrescriptions: number
  pendingLabReviews: number
  outstandingBalance: number
  allergyCount: number
  upcomingAppointments: number
  lastConsultationAt: string | null
  vaccination: VaccinationStatus
  growth: GrowthMonitoring
  followUps: FollowUpItem[]
  reminders: { length: number }
  loaded: { prescriptions: boolean; labs: boolean; invoices: boolean }
}): PediatricBrief {
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
  return {
    ageLabel: formatPediatricAge(input.dateOfBirth, input.now),
    guardian: nonEmpty(input.guardian),
    gp,
    vaccinationSummary: { received: input.vaccination.receivedCount, due: input.vaccination.dueCount, overdue: input.vaccination.overdueCount },
    growthSummary: { latest: input.growth.latest, missing: input.growth.missing },
    followUps: input.followUps,
  }
}

// Re-export the reused GP helpers so the panel has one import site.
export { buildFollowUps, getVaccineDose }

// ── helpers ─────────────────────────────────────────────────────────
function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
function nonEmpty(v?: string | null): string | null {
  const t = (v ?? '').trim()
  return t.length ? t : null
}

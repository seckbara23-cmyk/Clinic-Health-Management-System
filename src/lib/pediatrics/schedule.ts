// ── Pediatrics — vaccination schedule & milestone registries (Phase 17) ─
//
// PLACEHOLDER, registry-driven reference data. These are configurable defaults
// modelled on the Senegal PEV / WHO EPI infant schedule — they are NOT a
// validated local schedule and MUST be verified against the clinic's national
// programme before clinical use. Everything derived from them is presented as a
// REMINDER, never a medical order. No schema, no AI, pure data.

export interface VaccineDose {
  code: string
  labelKey: string
  /** Recommended age in WEEKS from birth (placeholder). */
  dueWeeks: number
  /** Grouping label for display (e.g. 'birth', '6_weeks'). */
  series: string
}

// Marked clearly so the UI can label it "placeholder — verify locally".
export const VACCINATION_SCHEDULE_VERSION = '2025.0-placeholder'
export const VACCINATION_SCHEDULE_IS_PLACEHOLDER = true

const MONTH_W = 4.345 // ≈ weeks per month, for the older doses

export const VACCINATION_SCHEDULE: VaccineDose[] = [
  { code: 'bcg', labelKey: 'vx_bcg', dueWeeks: 0, series: 'birth' },
  { code: 'opv0', labelKey: 'vx_opv0', dueWeeks: 0, series: 'birth' },
  { code: 'hepb0', labelKey: 'vx_hepb0', dueWeeks: 0, series: 'birth' },
  { code: 'penta1', labelKey: 'vx_penta1', dueWeeks: 6, series: '6_weeks' },
  { code: 'opv1', labelKey: 'vx_opv1', dueWeeks: 6, series: '6_weeks' },
  { code: 'pcv1', labelKey: 'vx_pcv1', dueWeeks: 6, series: '6_weeks' },
  { code: 'rota1', labelKey: 'vx_rota1', dueWeeks: 6, series: '6_weeks' },
  { code: 'penta2', labelKey: 'vx_penta2', dueWeeks: 10, series: '10_weeks' },
  { code: 'opv2', labelKey: 'vx_opv2', dueWeeks: 10, series: '10_weeks' },
  { code: 'pcv2', labelKey: 'vx_pcv2', dueWeeks: 10, series: '10_weeks' },
  { code: 'rota2', labelKey: 'vx_rota2', dueWeeks: 10, series: '10_weeks' },
  { code: 'penta3', labelKey: 'vx_penta3', dueWeeks: 14, series: '14_weeks' },
  { code: 'opv3', labelKey: 'vx_opv3', dueWeeks: 14, series: '14_weeks' },
  { code: 'pcv3', labelKey: 'vx_pcv3', dueWeeks: 14, series: '14_weeks' },
  { code: 'ipv', labelKey: 'vx_ipv', dueWeeks: 14, series: '14_weeks' },
  { code: 'measles1', labelKey: 'vx_measles1', dueWeeks: Math.round(9 * MONTH_W), series: '9_months' },
  { code: 'yellowfever', labelKey: 'vx_yellowfever', dueWeeks: Math.round(9 * MONTH_W), series: '9_months' },
  { code: 'mena', labelKey: 'vx_mena', dueWeeks: Math.round(9 * MONTH_W), series: '9_months' },
  { code: 'measles2', labelKey: 'vx_measles2', dueWeeks: Math.round(15 * MONTH_W), series: '15_months' },
]

export function getVaccineDose(code: string): VaccineDose | undefined {
  return VACCINATION_SCHEDULE.find(v => v.code === code)
}

// ── Developmental milestone review points (placeholder, age in MONTHS) ─
// These prompt the clinician to REVIEW milestones for the child's age. They do
// NOT assert a child has met/failed any milestone (no per-child tracking).
export interface MilestoneReview {
  code: string
  labelKey: string
  ageMonths: number
}
export const DEVELOPMENTAL_MILESTONES: MilestoneReview[] = [
  { code: 'm_2m', labelKey: 'ms_2m', ageMonths: 2 },
  { code: 'm_4m', labelKey: 'ms_4m', ageMonths: 4 },
  { code: 'm_6m', labelKey: 'ms_6m', ageMonths: 6 },
  { code: 'm_9m', labelKey: 'ms_9m', ageMonths: 9 },
  { code: 'm_12m', labelKey: 'ms_12m', ageMonths: 12 },
  { code: 'm_18m', labelKey: 'ms_18m', ageMonths: 18 },
  { code: 'm_24m', labelKey: 'ms_24m', ageMonths: 24 },
]

// ── Parent / guardian communication templates (future-safe, no sending) ─
// Text scaffolds a clinician can use manually. No automatic dispatch — the
// existing SMS framework is not wired to auto-send from here.
export const PARENT_COMM_TEMPLATE_IDS = [
  'vaccination_reminder', 'follow_up_reminder', 'school_certificate', 'lab_result_ready', 'medication_pickup',
] as const
export type ParentCommTemplateId = (typeof PARENT_COMM_TEMPLATE_IDS)[number]

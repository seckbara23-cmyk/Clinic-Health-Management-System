import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isPediatricContext, formatPediatricAge, buildGrowthMonitoring, buildVaccinationStatus,
  buildPediatricReminders, computePediatricCompleteness, buildPediatricMedicationReview,
  buildPediatricBrief, PEDS_COPILOT_PACK_ID, PEDS_SPECIALTIES,
} from '../pediatrics/engine'
import {
  VACCINATION_SCHEDULE, VACCINATION_SCHEDULE_VERSION, VACCINATION_SCHEDULE_IS_PLACEHOLDER,
  DEVELOPMENTAL_MILESTONES, PARENT_COMM_TEMPLATE_IDS, getVaccineDose,
} from '../pediatrics/schedule'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, PEDS_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import type { ConsultationVitals } from '@/types/database'
import type { SafetyWarning } from '../medication-safety'

const NOW = new Date('2026-07-06T12:00:00Z')

// ── Activation (pediatrics only, no leakage) ────────────────────────
describe('activation', () => {
  it('active only for a pediatrics doctor', () => {
    expect(isPediatricContext('doctor', 'pediatrics')).toBe(true)
    expect(isPediatricContext('doctor', 'general_practice')).toBe(false) // no leakage
    expect(isPediatricContext('doctor', null)).toBe(false)
    expect(isPediatricContext('nurse', 'pediatrics')).toBe(false)
  })
  it('pack id + specialties match the registry manifest', () => {
    expect(PEDS_COPILOT_PACK_ID).toBe('pediatrics.core')
    const pack = getCopilotPack('pediatrics.core')!
    expect(pack.supportedSpecialties).toEqual([...PEDS_SPECIALTIES])
  })
})

// ── Age formatting ──────────────────────────────────────────────────
describe('formatPediatricAge', () => {
  it('newborn shows days', () => {
    const a = formatPediatricAge('2026-07-01', NOW)!
    expect(a.totalDays).toBe(5)
    expect(a.displayUnit).toBe('days')
  })
  it('infant shows months', () => {
    const a = formatPediatricAge('2026-01-06', NOW)!
    expect(a.totalMonths).toBe(6)
    expect(a.displayUnit).toBe('months')
  })
  it('child shows years + months', () => {
    const a = formatPediatricAge('2020-04-06', NOW)!
    expect(a.years).toBe(6)
    expect(a.months).toBe(3)
    expect(a.displayUnit).toBe('years')
  })
  it('null / future dob → null', () => {
    expect(formatPediatricAge(null, NOW)).toBeNull()
    expect(formatPediatricAge('2030-01-01', NOW)).toBeNull()
  })
})

// ── Growth monitoring (from vitals; never invents percentiles) ──────
describe('buildGrowthMonitoring', () => {
  const vitals = (over: Partial<ConsultationVitals>): ConsultationVitals => ({ created_at: '', weight_kg: null, height_cm: null, bmi: null, ...over } as ConsultationVitals)
  it('derives latest + trend from ordered measurements', () => {
    const g = buildGrowthMonitoring([
      vitals({ created_at: '2026-01-01T00:00:00Z', weight_kg: 6, height_cm: 60, bmi: 16.7 }),
      vitals({ created_at: '2026-04-01T00:00:00Z', weight_kg: 7.5, height_cm: 65, bmi: 17.8 }),
    ])
    expect(g.latest?.weightKg).toBe(7.5)
    expect(g.trend.weight).toBe('up')
    expect(g.trend.height).toBe('up')
    expect(g.missing).toEqual([])
  })
  it('flags missing weight/height on the latest visit', () => {
    const g = buildGrowthMonitoring([vitals({ created_at: '2026-04-01T00:00:00Z' })])
    expect(g.missing).toEqual(['weight', 'height'])
  })
  it('NEVER invents percentiles or head circumference (honest placeholders)', () => {
    const g = buildGrowthMonitoring([])
    expect(g.percentilesSupported).toBe(false)
    expect(g.headCircumferenceSupported).toBe(false)
    expect(g.trend.weight).toBeNull() // <2 points → no trend, not a fabricated value
  })
})

// ── Vaccination status (schedule registry vs received) ──────────────
describe('vaccination', () => {
  it('the schedule is a labelled PLACEHOLDER', () => {
    expect(VACCINATION_SCHEDULE_IS_PLACEHOLDER).toBe(true)
    expect(VACCINATION_SCHEDULE_VERSION).toMatch(/placeholder/)
    expect(VACCINATION_SCHEDULE.length).toBeGreaterThan(10)
    expect(getVaccineDose('bcg')?.dueWeeks).toBe(0)
  })
  it('classifies received / due / overdue by age', () => {
    // A 4-month-old (≈17 weeks): birth+6+10+14-week doses are due/overdue.
    const status = buildVaccinationStatus('2026-03-06', [{ vaccine_code: 'bcg', administered_at: '2026-03-06' }], NOW)
    expect(status.isPlaceholder).toBe(true)
    expect(status.received.map(e => e.dose.code)).toContain('bcg')
    expect(status.overdueCount).toBeGreaterThan(0)  // 6-week doses overdue (>6+4 weeks)
    expect(status.dueCount + status.overdueCount).toBeGreaterThan(0)
    expect(status.catchUp).toEqual(status.overdue)
  })
  it('a newborn has only birth doses due, none overdue', () => {
    const status = buildVaccinationStatus('2026-07-05', [], NOW) // 1 day old
    expect(status.overdueCount).toBe(0)
    expect(status.due.map(e => e.dose.code).sort()).toEqual(['bcg', 'hepb0', 'opv0'])
  })
  it('no DOB → cannot compute due/overdue (only received surfaced)', () => {
    const status = buildVaccinationStatus(null, [{ vaccine_code: 'bcg' }], NOW)
    expect(status.receivedCount).toBe(1)
    expect(status.dueCount).toBe(0)
    expect(status.overdueCount).toBe(0)
  })
})

// ── Pediatric reminders ─────────────────────────────────────────────
describe('buildPediatricReminders', () => {
  it('surfaces overdue vaccinations, missing weight, and age-based nutrition', () => {
    const vaccination = buildVaccinationStatus('2026-03-06', [], NOW) // 4mo, doses overdue
    const growth = buildGrowthMonitoring([{ created_at: NOW.toISOString(), weight_kg: null, height_cm: null, bmi: null } as ConsultationVitals])
    const r = buildPediatricReminders({ dateOfBirth: '2026-03-06', vaccination, growth, now: NOW })
    const codes = r.map(x => x.code)
    expect(codes).toContain('vax_overdue')
    expect(codes).toContain('growth_weight_missing')
    expect(codes).toContain('nutrition_breastfeeding') // <6mo
    expect(r[0].severity).toBe('warning') // warnings first
  })
  it('complementary feeding reminder for a toddler', () => {
    const vaccination = buildVaccinationStatus('2025-01-06', [], NOW)
    const growth = buildGrowthMonitoring([{ created_at: NOW.toISOString(), weight_kg: 10, height_cm: 80, bmi: 15.6 } as ConsultationVitals])
    const r = buildPediatricReminders({ dateOfBirth: '2025-01-06', vaccination, growth, now: NOW }) // 18mo
    expect(r.map(x => x.code)).toContain('nutrition_complementary')
    expect(r.map(x => x.code)).toContain('milestone_review') // near 18mo milestone
  })
})

// ── Documentation completeness (reuses GP + pediatric prompts) ─────
describe('computePediatricCompleteness', () => {
  it('reuses the GP SOAP score and adds pediatric prompts', () => {
    const c = computePediatricCompleteness({ chief_complaint: 'Fever', symptoms: 'x' }, { weightRecordedThisVisit: true })
    expect(c.overall).toBeGreaterThan(0)
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining(['ped_doc_parent_concern', 'ped_doc_feeding', 'ped_doc_sleep', 'ped_doc_vaccination_review']))
    expect(c.prompts).not.toContain('ped_doc_growth') // weight recorded
  })
  it('prompts to record growth when weight not taken', () => {
    const c = computePediatricCompleteness({}, { weightRecordedThisVisit: false })
    expect(c.prompts).toContain('ped_doc_growth')
  })
})

// ── Pediatric medication review (reuses GP; peds flags; NO dosing) ─
describe('buildPediatricMedicationReview', () => {
  const warnings: SafetyWarning[] = [{ code: 'allergy', severity: 'critical', medication: 'X' }]
  it('adds weight/age-missing flags without any dosing recommendation', () => {
    const r = buildPediatricMedicationReview({ activeMedNames: ['A'], warnings, now: NOW, hasWeight: false, hasAge: true })
    expect(r.weightMissing).toBe(true)
    expect(r.ageMissing).toBe(false)
    expect(r.hasAllergyConflict).toBe(true)
    // The type has no dosing field — mg/kg dosing is deliberately not implemented.
    expect((r as Record<string, unknown>).recommendedDose).toBeUndefined()
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildPediatricBrief', () => {
  it('composes the GP brief + age + guardian + vaccination/growth summaries', () => {
    const vaccination = buildVaccinationStatus('2026-01-06', [{ vaccine_code: 'bcg' }], NOW)
    const growth = buildGrowthMonitoring([{ created_at: NOW.toISOString(), weight_kg: 7, height_cm: 65, bmi: 16.6 } as ConsultationVitals])
    const b = buildPediatricBrief({
      dateOfBirth: '2026-01-06', guardian: 'Awa Sy', now: NOW,
      activePrescriptions: 1, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 0, lastConsultationAt: NOW.toISOString(),
      vaccination, growth, followUps: [], reminders: { length: 2 },
      loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.ageLabel?.totalMonths).toBe(6)
    expect(b.guardian).toBe('Awa Sy')
    expect(b.vaccinationSummary.received).toBe(1)
    expect(b.growthSummary.latest?.weightKg).toBe(7)
    expect(b.gp.confidence).toBe('high')
  })
})

// ── Registry integration + referential integrity ───────────────────
describe('registry integration (pediatrics.core)', () => {
  const pack = getCopilotPack('pediatrics.core')!
  it('registers 6 pediatric templates that all resolve', () => {
    for (const id of PEDS_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...PEDS_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves in the AI tool registry', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('pediatric templates map ONLY to existing consultation columns', () => {
    for (const id of PEDS_SMART_TEMPLATE_IDS) {
      for (const sec of getTemplate(id)!.sections) for (const f of sec.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('milestone + parent-comm registries are present', () => {
    expect(DEVELOPMENTAL_MILESTONES.length).toBeGreaterThan(0)
    expect(PARENT_COMM_TEMPLATE_IDS).toContain('vaccination_reminder')
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / dosing / prescribing / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no pedsCopilot / pedsVaccines i18n string contains diagnosis/treatment wording', () => {
    for (const ns of ['pedsCopilot', 'pedsVaccines']) {
      for (const [k, v] of Object.entries(en[ns] as Record<string, string>)) {
        expect(`${ns}.${k}:${BANNED.test(v)}`).toBe(`${ns}.${k}:false`)
      }
    }
  })
  it('the engine imports no AI provider and performs no writes (deterministic)', () => {
    for (const f of ['engine.ts', 'schedule.ts']) {
      const src = readFileSync(join(__dirname, '..', 'pediatrics', f), 'utf8')
      expect(src).not.toMatch(/from '@\/lib\/ai/)
      expect(src).not.toMatch(/createClient|service_role|supabase/i)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
      expect(src).not.toMatch(/mg\/kg|mgPerKg|dosePerKg/) // NO dosing rules
      expect(src).not.toMatch(/percentile\s*=|computePercentile/) // NO invented percentiles
    }
  })
  it('the hooks perform only a clinician-gated write; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'usePediatrics.ts'), 'utf8')
    expect(src).not.toMatch(/service_role|createServiceClient/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '044_patient_vaccinations.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).toMatch(/UNIQUE \(patient_id, vaccine_code\)/)
    expect(code).not.toMatch(/PRIMARY KEY \(patient_id/) // never composite-FK PK
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/get_clinic_id\(\)/)
  })
  it('fr parity for both pediatric namespaces', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.pedsCopilot).sort()).toEqual(Object.keys(en.pedsCopilot).sort())
    expect(Object.keys(fr.pedsVaccines).sort()).toEqual(Object.keys(en.pedsVaccines).sort())
  })
})

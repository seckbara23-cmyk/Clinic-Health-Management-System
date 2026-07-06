import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isObgynContext, estimateDueDate, computeGestationalAge, trimesterOf, GESTATION_DAYS,
  buildPregnancyTracking, buildWomensHealthReminders, computeObgynCompleteness,
  buildObgynMedicationReview, buildLabUltrasoundFollowUp, countUltrasoundOrders, buildObgynBrief,
  OBGYN_COPILOT_PACK_ID, OBGYN_SPECIALTIES,
} from '../obgyn/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, OBGYN_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import type { Consultation, LabOrder } from '@/types/database'
import type { SafetyWarning } from '../medication-safety'

const NOW = new Date('2026-07-06T12:00:00Z')

// ── Activation ──────────────────────────────────────────────────────
describe('activation', () => {
  it('active for OB/GYN doctor or midwife; no leakage', () => {
    expect(isObgynContext('doctor', 'obgyn')).toBe(true)
    expect(isObgynContext('midwife', 'midwifery')).toBe(true)
    expect(isObgynContext('midwife', 'obgyn')).toBe(true)
    expect(isObgynContext('doctor', 'general_practice')).toBe(false) // no leakage
    expect(isObgynContext('doctor', 'pediatrics')).toBe(false)
    expect(isObgynContext('nurse', 'obgyn')).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(OBGYN_COPILOT_PACK_ID).toBe('obstetrics.core')
    expect(getCopilotPack('obstetrics.core')!.supportedSpecialties.sort()).toEqual([...OBGYN_SPECIALTIES].sort())
  })
})

// ── Gestational age & EDD (pure calendar arithmetic) ───────────────
describe('gestational age / EDD (Naegele)', () => {
  it('EDD = LMP + 280 days', () => {
    expect(GESTATION_DAYS).toBe(280)
    expect(estimateDueDate('2026-01-01')).toBe(new Date(new Date('2026-01-01').getTime() + 280 * 86400000).toISOString().slice(0, 10))
    expect(estimateDueDate(null)).toBeNull()
    expect(estimateDueDate('bad')).toBeNull()
  })
  it('gestational age = completed weeks + days since LMP', () => {
    // LMP 20 weeks + 3 days before NOW
    const lmp = new Date(NOW.getTime() - (20 * 7 + 3) * 86400000).toISOString().slice(0, 10)
    const ga = computeGestationalAge(lmp, NOW)!
    expect(ga.weeks).toBe(20)
    expect(ga.days).toBe(3)
  })
  it('rejects future LMP and implausible ranges', () => {
    expect(computeGestationalAge('2030-01-01', NOW)).toBeNull()
    expect(computeGestationalAge(new Date(NOW.getTime() - 400 * 86400000).toISOString(), NOW)).toBeNull()
  })
  it('trimester from GA weeks', () => {
    expect(trimesterOf({ totalDays: 70, weeks: 10, days: 0 })).toBe(1)
    expect(trimesterOf({ totalDays: 140, weeks: 20, days: 0 })).toBe(2)
    expect(trimesterOf({ totalDays: 210, weeks: 30, days: 0 })).toBe(3)
    expect(trimesterOf(null)).toBeNull()
  })
})

// ── Pregnancy / ANC tracking ────────────────────────────────────────
describe('buildPregnancyTracking', () => {
  const lmp20w = new Date(NOW.getTime() - 20 * 7 * 86400000).toISOString().slice(0, 10)

  it('neutral empty state when no pregnancy recorded', () => {
    const tr = buildPregnancyTracking({ pregnancy: null, now: NOW })
    expect(tr.hasPregnancy).toBe(false)
    expect(tr.reminders).toEqual([])
    expect(tr.gestationalAge).toBeNull()
  })
  it('computes GA/EDD/trimester + ANC visit count from consultations since LMP', () => {
    const tr = buildPregnancyTracking({
      pregnancy: { lmp_date: lmp20w, pregnancy_status: 'ongoing' },
      consultations: [
        { id: 'c1', created_at: NOW.toISOString() },
        { id: 'c2', created_at: new Date(NOW.getTime() - 60 * 86400000).toISOString() }, // within pregnancy
        { id: 'c3', created_at: '2020-01-01T00:00:00Z' },                                 // before LMP → excluded
      ] as unknown as Consultation[],
      hasRecentVitals: true, hasPregnancyLabs: true, now: NOW,
    })
    expect(tr.hasPregnancy).toBe(true)
    expect(tr.gestationalAge?.weeks).toBe(20)
    expect(tr.trimester).toBe(2)
    expect(tr.estimatedDueDate).toBe(estimateDueDate(lmp20w))
    expect(tr.ancVisitCount).toBe(2)
    expect(tr.reminders.find(r => r.code === 'anc_no_recent')).toBeUndefined() // recent visit today
  })
  it('flags no-recent-ANC + missing vitals/labs for an ongoing pregnancy', () => {
    const tr = buildPregnancyTracking({
      pregnancy: { lmp_date: lmp20w, pregnancy_status: 'ongoing' },
      consultations: [], hasRecentVitals: false, hasPregnancyLabs: false, now: NOW,
    })
    const codes = tr.reminders.map(r => r.code)
    expect(codes).toContain('anc_no_recent')
    expect(codes).toContain('anc_missing_vitals')
    expect(codes).toContain('anc_missing_labs')
    expect(tr.reminders[0].severity).toBe('warning')
  })
  it('postpartum status → postpartum follow-up reminder', () => {
    const tr = buildPregnancyTracking({ pregnancy: { lmp_date: lmp20w, pregnancy_status: 'postpartum' }, consultations: [], now: NOW })
    expect(tr.reminders.map(r => r.code)).toContain('postpartum_followup')
  })
  it('overdue EDD → postpartum follow-up even if still marked ongoing', () => {
    const oldLmp = new Date(NOW.getTime() - 300 * 86400000).toISOString().slice(0, 10) // EDD passed
    const tr = buildPregnancyTracking({ pregnancy: { lmp_date: oldLmp, pregnancy_status: 'ongoing' }, consultations: [], now: NOW })
    expect(tr.reminders.map(r => r.code)).toContain('postpartum_followup')
  })
})

// ── Women's health reminders ────────────────────────────────────────
describe('buildWomensHealthReminders', () => {
  it('female age-based screening + family planning; none for males', () => {
    const f = buildWomensHealthReminders({ dateOfBirth: '1985-01-01', gender: 'female', now: NOW }).map(r => r.code) // 41
    expect(f).toContain('cervical_screening')
    expect(f).toContain('family_planning')
    expect(f).toContain('annual_gyne_review')
    expect(buildWomensHealthReminders({ dateOfBirth: '1985-01-01', gender: 'male', now: NOW })).toEqual([])
  })
  it('no family planning while pregnant; postpartum review when postpartum', () => {
    const preg = buildWomensHealthReminders({ dateOfBirth: '1990-01-01', gender: 'female', pregnancyStatus: 'ongoing', now: NOW }).map(r => r.code)
    expect(preg).not.toContain('family_planning')
    const pp = buildWomensHealthReminders({ dateOfBirth: '1990-01-01', gender: 'female', pregnancyStatus: 'postpartum', now: NOW }).map(r => r.code)
    expect(pp).toContain('postpartum_review')
  })
})

// ── Documentation completeness (reuses GP + OB prompts) ────────────
describe('computeObgynCompleteness', () => {
  it('reuses GP SOAP score and adds OB/GYN prompts', () => {
    const c = computeObgynCompleteness({ chief_complaint: 'Bleeding', symptoms: 'x' }, { pregnancy: true })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining(['obg_doc_obstetric_history', 'obg_doc_gynecologic_history', 'obg_doc_vitals', 'obg_doc_anc_followup']))
  })
  it('omits ANC prompt when not pregnant', () => {
    expect(computeObgynCompleteness({}, { pregnancy: false }).prompts).not.toContain('obg_doc_anc_followup')
  })
})

// ── Medication review (pregnancy safety is a PLACEHOLDER) ──────────
describe('buildObgynMedicationReview', () => {
  const warnings: SafetyWarning[] = [{ code: 'allergy', severity: 'critical', medication: 'X' }]
  it('reuses GP review + labelled pregnancy placeholder; NO classification', () => {
    const r = buildObgynMedicationReview({ activeMedNames: ['A'], warnings, now: NOW, isPregnant: true })
    expect(r.hasAllergyConflict).toBe(true)
    expect(r.pregnancyMedSafetySupported).toBe(false)
    expect(r.isPregnant).toBe(true)
    expect((r as Record<string, unknown>).pregnancyCategory).toBeUndefined() // no A/B/C/D/X classification
  })
})

// ── Lab & ultrasound follow-up (surface only, no interpretation) ───
describe('lab & ultrasound follow-up', () => {
  const orders = [
    { status: 'completed', clinical_notes: 'Obstetric ultrasound', items: [] },
    { status: 'ordered', clinical_notes: 'CBC', items: [{ test_name: 'Hemoglobin' }] },
    { status: 'completed', clinical_notes: '', items: [{ test_name: 'Pelvic ultrasound' }] },
  ] as unknown as LabOrder[]
  it('counts ultrasound orders and awaiting-review, never interprets', () => {
    expect(countUltrasoundOrders(orders)).toBe(2)
    const r = buildLabUltrasoundFollowUp({ labOrders: orders, now: NOW })
    expect(r.ultrasoundOrders).toBe(2)
    expect(r.awaitingReview).toBe(2)
    expect(r.followUps.find(f => f.code === 'outstanding_lab')?.count).toBe(1)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildObgynBrief', () => {
  it('reuses the GP brief + pregnancy tracking + ultrasound', () => {
    const tr = buildPregnancyTracking({ pregnancy: { lmp_date: new Date(NOW.getTime() - 100 * 86400000).toISOString().slice(0, 10), pregnancy_status: 'ongoing' }, consultations: [], now: NOW })
    const b = buildObgynBrief({
      now: NOW, activePrescriptions: 1, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 0, lastConsultationAt: NOW.toISOString(), pregnancy: tr, ultrasoundOrders: 2, followUps: [],
      loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.pregnancy.hasPregnancy).toBe(true)
    expect(b.ultrasoundOrders).toBe(2)
  })
})

// ── Registry integration + referential integrity ───────────────────
describe('registry integration (obstetrics.core)', () => {
  const pack = getCopilotPack('obstetrics.core')!
  it('registers 7 OB/GYN templates that all resolve', () => {
    for (const id of OBGYN_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...OBGYN_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves in the AI tool registry', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of OBGYN_SMART_TEMPLATE_IDS) {
      for (const sec of getTemplate(id)!.sections) for (const f of sec.fields) expect(f.target.store).toBe('consultation')
    }
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / treatment / prescribing / interpretation / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no obgynCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.obgynCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no ultrasound/CTG interpretation, no risk classification', () => {
    const src = readFileSync(join(__dirname, '..', 'obgyn', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    // Scan CODE only — the header comment legitimately NAMES what it never does
    // (e.g. "…preeclampsia") in its disclaimer; that prose must not fail the gate.
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/preeclampsia|interpretUltrasound|interpretCtg|classifyRisk|riskScore|deliveryMethod|cesarean|c-section/i)
  })
  it('the hooks perform only a clinician-gated write; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useObgyn.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '045_pregnancies.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/get_clinic_id\(\)/)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.obgynCopilot).sort()).toEqual(Object.keys(en.obgynCopilot).sort())
  })
})

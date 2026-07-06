import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isGeneralPracticeContext, isGeneralPracticeDefault, GP_SPECIALTIES, GP_COPILOT_PACK_ID,
  computeConsultationCompleteness, ageFrom, buildPreventiveReminders, DEFAULT_PREVENTIVE_CONFIG,
  buildFollowUps, buildMedicationReview, highlightTimeline, buildOperationalTimeline, buildGpBrief,
} from '../gp-copilot'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, GP_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getWidget } from '../widgets/registry'
import { getAction } from '../actions/registry'
import { getTool } from '../ai/tools'
import type { SafetyWarning } from '../medication-safety'
import type { Appointment, Consultation, LabOrder, Prescription } from '@/types/database'

const NOW = new Date('2026-07-06T12:00:00Z')

// ── Pack activation (GP only, no specialty leakage) ─────────────────
describe('activation', () => {
  it('strict context = doctor + GP/family specialty only', () => {
    expect(isGeneralPracticeContext('doctor', 'general_practice')).toBe(true)
    expect(isGeneralPracticeContext('doctor', 'family_medicine')).toBe(true)
    expect(isGeneralPracticeContext('doctor', 'cardiology')).toBe(false)   // NO specialty leakage
    expect(isGeneralPracticeContext('doctor', null)).toBe(false)
    expect(isGeneralPracticeContext('nurse', 'general_practice')).toBe(false)
  })
  it('panel default = GP doctor OR un-specialised doctor (GP is the default specialty)', () => {
    expect(isGeneralPracticeDefault('doctor', null)).toBe(true)
    expect(isGeneralPracticeDefault('doctor', 'general_practice')).toBe(true)
    expect(isGeneralPracticeDefault('doctor', 'cardiology')).toBe(false)   // still no leakage
    expect(isGeneralPracticeDefault('pharmacist', null)).toBe(false)
  })
  it('the pack id + specialties match the registry manifest', () => {
    expect(GP_COPILOT_PACK_ID).toBe('general_practice.core')
    const pack = getCopilotPack(GP_COPILOT_PACK_ID)!
    expect(pack.supportedSpecialties.sort()).toEqual([...GP_SPECIALTIES].sort())
    expect(pack.requiredProfessions).toEqual(['doctor'])
  })
})

// ── Documentation completeness ──────────────────────────────────────
describe('computeConsultationCompleteness', () => {
  it('an empty consultation scores 0 with all sections missing', () => {
    const c = computeConsultationCompleteness({})
    expect(c.overall).toBe(0)
    expect(c.missing).toEqual(['chief_complaint', 'history', 'examination', 'assessment', 'plan'])
  })
  it('a fully documented consultation scores 100', () => {
    const c = computeConsultationCompleteness({
      chief_complaint: 'Cough for 3 days, worse at night',
      symptoms: 'Productive cough, low-grade fever, no dyspnoea, appetite preserved, sleeping poorly',
      notes: 'Chest clear on auscultation, throat mildly injected, afebrile at visit, vitals stable',
      diagnosis: 'Upper respiratory tract, self-limiting',
      treatment_plan: 'Symptomatic care, review if worse in 3 days',
    })
    expect(c.overall).toBe(100)
    expect(c.missing).toEqual([])
  })
  it('scores each section by presence/length and flags empties', () => {
    const c = computeConsultationCompleteness({ chief_complaint: 'Headache', symptoms: '', notes: 'x' })
    expect(c.sections.find(s => s.key === 'chief_complaint')!.present).toBe(true)
    expect(c.sections.find(s => s.key === 'history')!.score).toBe(0)
    expect(c.missing).toContain('history')
    expect(c.missing).toContain('assessment')
    expect(c.overall).toBeGreaterThan(0)
    expect(c.overall).toBeLessThan(100)
  })
  it('is deterministic + measures presence, never clinical correctness', () => {
    const doc = { chief_complaint: 'abc', symptoms: 'def' }
    expect(computeConsultationCompleteness(doc)).toEqual(computeConsultationCompleteness(doc))
  })
})

// ── Preventive reminders (deterministic, config-driven) ─────────────
describe('buildPreventiveReminders', () => {
  it('ageFrom computes whole years', () => {
    expect(ageFrom('1966-07-06', NOW)).toBe(60)
    expect(ageFrom('1966-07-07', NOW)).toBe(59) // birthday tomorrow
    expect(ageFrom(null, NOW)).toBeNull()
    expect(ageFrom('not-a-date', NOW)).toBeNull()
  })
  it('a 68-year-old woman overdue for a visit gets screening + vaccination + annual reminders', () => {
    const r = buildPreventiveReminders({ dateOfBirth: '1958-01-01', gender: 'female', lastConsultationAt: null, now: NOW })
    const codes = r.map(x => x.code)
    expect(codes).toContain('annual_check')
    expect(codes).toContain('screening_colorectal')       // 50–75
    expect(codes).toContain('vaccination_influenza')       // ≥65
    expect(codes).toContain('metabolic_check')             // ≥40 + overdue
    expect(codes).toContain('screening_breast')            // 68 ∈ [50,69]
  })
  it('sex-specific screening only for the right sex', () => {
    const male = buildPreventiveReminders({ dateOfBirth: '1980-01-01', gender: 'male', lastConsultationAt: NOW.toISOString(), now: NOW })
    expect(male.map(r => r.code)).not.toContain('screening_cervical')
    const female = buildPreventiveReminders({ dateOfBirth: '1980-01-01', gender: 'female', lastConsultationAt: NOW.toISOString(), now: NOW })
    expect(female.map(r => r.code)).toContain('screening_cervical') // 46 in [30,65]
  })
  it('recent visit suppresses the annual/metabolic reminders', () => {
    const r = buildPreventiveReminders({ dateOfBirth: '1980-01-01', gender: 'male', lastConsultationAt: NOW.toISOString(), now: NOW })
    expect(r.map(x => x.code)).not.toContain('annual_check')
    expect(r.map(x => x.code)).not.toContain('metabolic_check')
  })
  it('surfaces a recorded high BP as an operational follow-up reminder (not a diagnosis)', () => {
    const r = buildPreventiveReminders({
      dateOfBirth: '1980-01-01', gender: 'male', lastConsultationAt: NOW.toISOString(),
      latestVitals: { systolic_bp: 158, diastolic_bp: 96 }, now: NOW,
    })
    const bp = r.find(x => x.code === 'bp_followup')!
    expect(bp.severity).toBe('warning')
    expect(bp.params).toEqual({ systolic: 158, diastolic: 96 })
  })
  it('honours config toggles (screening/vaccination/vitals off)', () => {
    const r = buildPreventiveReminders({
      dateOfBirth: '1958-01-01', gender: 'female', lastConsultationAt: null,
      latestVitals: { systolic_bp: 200 }, now: NOW,
      config: { enableScreening: false, enableVaccination: false, enableVitalsFollowup: false, enableLifestyle: false },
    })
    const codes = r.map(x => x.code)
    expect(codes).not.toContain('screening_colorectal')
    expect(codes).not.toContain('vaccination_influenza')
    expect(codes).not.toContain('bp_followup')
    expect(codes).toContain('annual_check') // still fires
  })
  it('warnings sort before informational reminders', () => {
    const r = buildPreventiveReminders({ dateOfBirth: '1958-01-01', gender: 'female', lastConsultationAt: null, latestVitals: { systolic_bp: 200 }, now: NOW })
    expect(r[0].severity).toBe('warning')
  })
  it('DEFAULT_PREVENTIVE_CONFIG exposes clinic-configurable thresholds', () => {
    expect(DEFAULT_PREVENTIVE_CONFIG.influenzaAgeMin).toBe(65)
    expect(DEFAULT_PREVENTIVE_CONFIG.bpSystolicThreshold).toBe(140)
  })
})

// ── Follow-up assistant (highlight only) ────────────────────────────
describe('buildFollowUps', () => {
  it('detects missed appointments, outstanding + awaiting-review labs, unclosed consults', () => {
    const items = buildFollowUps({
      appointments: [{ status: 'no_show' }, { status: 'completed' }] as unknown as Appointment[],
      labOrders: [{ status: 'ordered' }, { status: 'completed' }, { status: 'in_progress' }] as unknown as LabOrder[],
      consultations: [{ id: 'c1', created_at: NOW.toISOString(), ended_at: null }] as unknown as Consultation[],
      now: NOW,
    })
    const byCode = Object.fromEntries(items.map(i => [i.code, i.count]))
    expect(byCode.missed_appointment).toBe(1)
    expect(byCode.outstanding_lab).toBe(2)         // ordered + in_progress
    expect(byCode.result_awaiting_review).toBe(1)  // completed
    expect(byCode.unclosed_consultation).toBe(1)
  })
  it('classifies upcoming vs missed follow-up dates', () => {
    const items = buildFollowUps({
      consultations: [
        { id: 'c1', created_at: '2026-06-01T00:00:00Z', ended_at: '2026-06-01T00:00:00Z', follow_up_date: '2026-06-15' }, // past, latest → missed
        { id: 'c2', created_at: '2026-05-01T00:00:00Z', ended_at: '2026-05-01T00:00:00Z', follow_up_date: '2026-08-01' }, // future
      ] as unknown as Consultation[],
      now: NOW,
    })
    const byCode = Object.fromEntries(items.map(i => [i.code, i.count]))
    expect(byCode.upcoming_followup).toBe(1)
    expect(byCode.missed_followup).toBe(1)
  })
  it('empty input → no items', () => {
    expect(buildFollowUps({ now: NOW })).toEqual([])
  })
})

// ── Medication review (reuses safety warnings, never recommends) ────
describe('buildMedicationReview', () => {
  const warnings: SafetyWarning[] = [
    { code: 'allergy', severity: 'critical', medication: 'Amoxicilline' },
    { code: 'duplicate_class', severity: 'warning', medication: 'X' },
    { code: 'low_stock', severity: 'info', medication: 'Y' },
  ]
  it('summarises active count, recent changes, and safety flags', () => {
    const r = buildMedicationReview({
      activeMedNames: ['A', 'B'], warnings,
      prescriptions: [{ created_at: NOW.toISOString() }, { created_at: '2020-01-01T00:00:00Z' }] as unknown as Prescription[],
      now: NOW,
    })
    expect(r.activeCount).toBe(2)
    expect(r.recentChangeCount).toBe(1)
    expect(r.hasAllergyConflict).toBe(true)
    expect(r.hasDuplicate).toBe(true)
    expect(r.hasStockIssue).toBe(true)
    expect(r.hasExpiryIssue).toBe(false)
    expect(r.warnings).toBe(warnings) // passthrough, no re-computation
  })
})

// ── Operational timeline highlighting ───────────────────────────────
describe('highlightTimeline', () => {
  it('flags today, outstanding, and recent items', () => {
    const items = [
      { id: 'c-cur', type: 'consultation' as const, date: NOW.toISOString(), status: 'ongoing' },
      { id: 'l-1', type: 'lab' as const, date: '2026-06-01T00:00:00Z', status: 'ordered' },
      { id: 'i-1', type: 'invoice' as const, date: '2026-07-05T00:00:00Z', status: 'paid' },
      { id: 'p-1', type: 'prescription' as const, date: '2025-01-01T00:00:00Z', status: 'dispensed' },
    ]
    const h = Object.fromEntries(highlightTimeline(items, { now: NOW }).map(x => [x.id, x.highlight]))
    expect(h['c-cur']).toBe('today')
    expect(h['l-1']).toBe('outstanding')
    expect(h['i-1']).toBe('recent')     // within 7 days, paid (not outstanding)
    expect(h['p-1']).toBeNull()         // old + settled
  })
  it('buildOperationalTimeline merges then highlights', () => {
    const out = buildOperationalTimeline({ consultations: [{ id: 'c1', created_at: NOW.toISOString() }] as unknown as Consultation[] }, { now: NOW, currentConsultationId: 'c1' })
    expect(out[0].highlight).toBe('today')
  })
})

// ── Clinical brief (reuses buildPatientBrief for confidence/sources) ─
describe('buildGpBrief', () => {
  it('produces operational lines + confidence + sources, never diagnosis', () => {
    const brief = buildGpBrief({
      activePrescriptions: 2, pendingLabReviews: 1, outstandingBalance: 15000, allergyCount: 1,
      upcomingAppointments: 1, lastConsultationAt: NOW.toISOString(), reminders: [], followUps: [],
      loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(brief.confidence).toBe('high')       // all sets loaded
    expect(brief.sources.length).toBeGreaterThan(0)
    expect(brief.lines.map(l => l.code)).toContain('active_medications')
    expect(brief.hasIssues).toBe(true)          // allergy present
  })
  it('confidence degrades when record sets are missing', () => {
    const brief = buildGpBrief({
      activePrescriptions: 0, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 0, lastConsultationAt: null, reminders: [], followUps: [],
      loaded: { prescriptions: false, labs: false, invoices: false },
    })
    expect(brief.confidence).toBe('low')
  })
})

// ── Registry integration + referential integrity ───────────────────
describe('registry integration (general_practice.core)', () => {
  const pack = getCopilotPack('general_practice.core')!

  it('registers the 6 GP smart templates, all resolving in the template registry', () => {
    for (const id of GP_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...GP_SMART_TEMPLATE_IDS]))
  })
  it('every futureTemplateId resolves in the template registry', () => {
    for (const id of pack.futureTemplateIds) expect(getTemplate(id)).toBeDefined()
  })
  it('every futureAiToolId resolves in the AI tool registry', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('every futureWidgetId / futureQuickActionId resolves in its registry', () => {
    for (const id of pack.futureWidgetIds) expect(getWidget(id)).toBeDefined()
    for (const id of pack.futureQuickActionIds) expect(getAction(id)).toBeDefined()
  })
  it('GP smart templates map ONLY to existing consultation columns (no schema change)', () => {
    for (const id of GP_SMART_TEMPLATE_IDS) {
      const tpl = getTemplate(id)!
      for (const sec of tpl.sections) for (const f of sec.fields) {
        expect(f.target.store).toBe('consultation') // never clinical_entry (no table yet)
      }
    }
  })
})

// ── STOP CONDITIONS: no diagnosis / prescribing / hallucination ─────
describe('safety invariants — no diagnosis, treatment, or prescribing anywhere', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no gpCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.gpCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })

  it('the engine imports no AI provider and performs no writes (deterministic, read-only)', () => {
    const src = readFileSync(join(__dirname, '..', 'gp-copilot.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)                 // no LLM provider
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
  })

  it('the panel never writes to any record (read-only) and never generates clinical prose', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'GeneralPracticeCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(|useMutation|mutateAsync/)
    expect(src).not.toMatch(/service_role/)
  })

  it('fr gpCopilot has parity with en', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.gpCopilot).sort()).toEqual(Object.keys(en.gpCopilot).sort())
  })
})

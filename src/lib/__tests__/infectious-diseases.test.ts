import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isInfectiousDiseasesContext, categoryOf, isInfxEventType, buildInfxTracker, buildTestTracker,
  buildInfxFollowUp, countInfxImagingSignals, computeInfxCompleteness, buildInfxBrief,
  INFX_COPILOT_PACK_ID, INFX_SPECIALTIES, INFX_ALL_TYPES, INFX_EVENT_STATUSES,
  INFX_EVENT_TYPES, INFX_TEST_TYPES, type InfxEvent,
} from '../infectious-diseases/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, INFX_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an infectious-diseases doctor; no leakage', () => {
    expect(isInfectiousDiseasesContext('doctor', 'infectious_diseases')).toBe(true)
    expect(isInfectiousDiseasesContext('doctor', 'internal_medicine')).toBe(false)
    expect(isInfectiousDiseasesContext('doctor', 'gastroenterology')).toBe(false)
    expect(isInfectiousDiseasesContext('doctor', 'oncology')).toBe(false)
    expect(isInfectiousDiseasesContext('doctor', 'general_practice')).toBe(false)
    expect(isInfectiousDiseasesContext('nurse', 'infectious_diseases')).toBe(false)
    expect(isInfectiousDiseasesContext('doctor', null)).toBe(false)
  })
  it('infectious_diseases is a registered clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('infectious_diseases')).toBe(true)
  })
  it('pack id + specialties match the manifest', () => {
    expect(INFX_COPILOT_PACK_ID).toBe('infectious_diseases.core')
    expect(getCopilotPack('infectious_diseases.core')!.supportedSpecialties).toEqual([...INFX_SPECIALTIES])
  })
})

// ── Event vocabulary (event ≠ investigation, no collision) ─────────
describe('event vocabulary', () => {
  it('maps event types to the right category with no event/test collision', () => {
    expect(categoryOf('id_consultation')).toBe('event')
    expect(categoryOf('malaria_followup')).toBe('event')
    expect(categoryOf('culture_review')).toBe('event')      // workflow event
    expect(categoryOf('microbiology_review')).toBe('event')
    expect(categoryOf('blood_culture')).toBe('test')        // investigation (distinct id)
    expect(categoryOf('pcr')).toBe('test')
    expect(categoryOf('genexpert')).toBe('test')
    expect(categoryOf('chest_xray')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isInfxEventType('pcr')).toBe(true)
    expect(isInfxEventType('nope')).toBe(false)
    expect(INFX_EVENT_TYPES.length).toBe(15)
    expect(INFX_TEST_TYPES.length).toBe(16)
    expect(INFX_ALL_TYPES.length).toBe(31)
    expect(new Set(INFX_ALL_TYPES).size).toBe(31)           // no duplicate ids across tracks
    expect(INFX_EVENT_STATUSES).toContain('scheduled')
    expect(INFX_EVENT_STATUSES).toContain('awaiting_review')
    expect(INFX_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only) ────────────────────────────────────
describe('buildInfxTracker', () => {
  const events: InfxEvent[] = [
    { eventType: 'malaria_followup', status: 'follow_up_due' },
    { eventType: 'malaria_followup', status: 'planned' },
    { eventType: 'hospital_discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'culture_review', status: 'awaiting_review' },
    { eventType: 'hiv_clinic_followup', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildInfxTracker(events)
    const mal = rows.find(r => r.eventType === 'malaria_followup')!
    expect(mal.followUpDue).toBe(1)
    expect(mal.planned).toBe(1)
    expect(mal.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'hospital_discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'culture_review')!.awaitingReview).toBe(1)
    const hiv = rows.find(r => r.eventType === 'hiv_clinic_followup')!
    expect(hiv.scheduled).toBe(1)
    expect(hiv.total).toBe(1)
  })
})

// ── Investigation workflow (counts only) ───────────────────────────
describe('buildTestTracker (investigation workflow)', () => {
  it('counts investigations by status', () => {
    const rows = buildTestTracker([
      { eventType: 'blood_culture', status: 'awaiting_review' },
      { eventType: 'blood_culture', status: 'ordered' },
      { eventType: 'urine_culture', status: 'reviewed' },  // closed → not open
      { eventType: 'pcr', status: 'completed' },
      { eventType: 'genexpert', status: 'ordered' },
    ])
    const bc = rows.find(r => r.testType === 'blood_culture')!
    expect(bc.awaitingReview).toBe(1)
    expect(bc.ordered).toBe(1)
    expect(bc.total).toBe(2)
    expect(rows.find(r => r.testType === 'urine_culture')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'pcr')!.total).toBe(1)
    expect(rows.find(r => r.testType === 'genexpert')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildInfxFollowUp', () => {
  const events: InfxEvent[] = [
    { eventType: 'malaria_followup', status: 'follow_up_due' },
    { eventType: 'culture_review', status: 'awaiting_review' },
    { eventType: 'blood_culture', status: 'awaiting_review' },
    { eventType: 'pcr', status: 'ordered' },
    { eventType: 'hiv_clinic_followup', status: 'scheduled' },
    { eventType: 'hospital_discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildInfxFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('malaria_followup_due')
    expect(codes).toContain('culture_review_awaiting')
    expect(codes).toContain('blood_culture_awaiting')
    expect(codes).toContain('pcr_pending')
    expect(codes).toContain('hiv_clinic_followup_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'blood_culture_awaiting')!.refType).toBe('blood_culture')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildInfxFollowUp([{ eventType: 'blood_culture', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildInfxFollowUp([]).reminders).toEqual([])
    expect(buildInfxFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countInfxImagingSignals', () => {
  it('counts infectious-diseases investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Blood culture', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Malaria rapid test' }] },
      { status: 'ordered', clinical_notes: 'GeneXpert', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not an ID investigation
    ] as unknown as LabOrder[]
    const s = countInfxImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + ID prompts) ────────────
describe('computeInfxCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 infectious-diseases prompts', () => {
    const c = computeInfxCompleteness({ chief_complaint: 'Fever', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'infx_doc_presentation', 'infx_doc_travel_history', 'infx_doc_exposure_history', 'infx_doc_vaccination_history',
      'infx_doc_contact_history', 'infx_doc_previous_infections', 'infx_doc_microbiology_followup', 'infx_doc_isolation_documentation',
      'infx_doc_public_health_documentation', 'infx_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildInfxBrief', () => {
  it('reuses the GP brief and attaches infectious-diseases counts', () => {
    const b = buildInfxBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'hiv_clinic_followup', status: 'scheduled' },
        { eventType: 'culture_review', status: 'active' },
        { eventType: 'blood_culture', status: 'ordered' },
        { eventType: 'pcr', status: 'awaiting_review' },
        { eventType: 'chest_xray', status: 'ordered' },
        { eventType: 'isolation_review', status: 'active' },
        { eventType: 'malaria_rapid_test', status: 'ordered' },
        { eventType: 'hospital_discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.pendingCultures).toBe(2)     // blood_culture ordered + culture_review active
    expect(b.summary.pendingMolecular).toBe(2)    // pcr awaiting_review + malaria_rapid_test ordered
    expect(b.summary.pendingImaging).toBe(1)      // chest_xray ordered
    expect(b.summary.chronicClinics).toBe(1)      // hiv_clinic_followup scheduled
    expect(b.summary.isolationContact).toBe(1)    // isolation_review active
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('pcr_awaiting')
  })
})

// ── Registry integration (infectious_diseases.core) ────────────────
describe('registry integration (infectious_diseases.core)', () => {
  const pack = getCopilotPack('infectious_diseases.core')!
  it('registers 8 infectious-diseases templates that all resolve', () => {
    expect(INFX_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of INFX_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...INFX_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of INFX_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 infectious-diseases documents + shared docs for an ID doctor', () => {
    for (const id of ['infectious_disease_referral', 'microbiology_followup_summary', 'hospital_infection_followup_summary', 'infectious_disease_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'infectious_diseases').map(d => d.id)
    expect(ids).toContain('infectious_disease_referral')
    expect(ids).toContain('microbiology_followup_summary')
    expect(ids).toContain('gp_referral_letter')             // shared
    expect(ids).not.toContain('gastroenterology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / lab-culture-PCR-imaging interpretation / antibiotic-antiviral-antifungal-isolation-vaccination recommendation / outbreak prediction / severity scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /outbreak|severity score|\bsofa\b|\bqsofa\b|\bapache\b|resistan|susceptib|\bcd4\b|viral load|\bpositive\b|\bnegative\b|prognos/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no infectiousDiseasesCopilot i18n string contains diagnosis/treatment/disease wording', () => {
    for (const [k, v] of Object.entries(en.infectiousDiseasesCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no infectiousDiseasesCopilot i18n string contains outbreak / severity-score / resistance / result-interpretation wording', () => {
    for (const [k, v] of Object.entries(en.infectiousDiseasesCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no lab/culture/PCR/imaging interpretation, no classification / prediction / recommendation / scoring', () => {
    const src = readFileSync(join(__dirname, '..', 'infectious-diseases', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no infection diagnosis/classification, no outbreak/severity prediction/scoring, no antibiotic/antiviral/antifungal/antiparasitic/isolation/vaccination/admission/discharge recommendation.
    expect(code).not.toMatch(/diagnoseInfection|diagnoseMalaria|diagnoseTb|diagnoseHiv|interpretCulture|interpretPcr|interpretRdt|interpretXray|interpretCt|interpretMri|classifyInfection|recommendAntibiotic|recommendAntiviral|recommendAntifungal|recommendAntiparasitic|recommendIsolation|recommendVaccination|recommendAdmission|recommendDischarge|predictOutbreak|severityScore|sofaScore|qsofaScore|resistancePattern/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useInfectiousDiseases.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'InfectiousDiseasesCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '065_infectious_disease_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.infectiousDiseasesCopilot).sort()).toEqual(Object.keys(en.infectiousDiseasesCopilot).sort())
  })
})

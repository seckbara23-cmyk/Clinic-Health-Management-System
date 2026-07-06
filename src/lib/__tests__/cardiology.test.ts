import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isCardiologyContext, categoryOf, isCardioEventType, buildTestTracking, buildProcedureTracker,
  buildCardiacFollowUp, countCardiacLabSignals, computeCardiologyCompleteness, buildCardiologyBrief,
  CARDIO_COPILOT_PACK_ID, CARDIO_SPECIALTIES, CARDIO_EVENT_TYPES, CARDIO_EVENT_STATUSES,
  CARDIO_TEST_TYPES, CARDIO_PROCEDURE_TYPES, type CardioEvent,
} from '../cardiology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, CARDIO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a cardiology doctor; no leakage', () => {
    expect(isCardiologyContext('doctor', 'cardiology')).toBe(true)
    expect(isCardiologyContext('doctor', 'interventional_cardiology')).toBe(true) // future sub-specialty
    expect(isCardiologyContext('doctor', 'general_practice')).toBe(false)
    expect(isCardiologyContext('doctor', 'ent')).toBe(false)
    expect(isCardiologyContext('doctor', 'pediatrics')).toBe(false)
    expect(isCardiologyContext('doctor', 'obgyn')).toBe(false)
    expect(isCardiologyContext('nurse', 'cardiology')).toBe(false)
    expect(isCardiologyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(CARDIO_COPILOT_PACK_ID).toBe('cardiology.core')
    expect(getCopilotPack('cardiology.core')!.supportedSpecialties).toEqual([...CARDIO_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('ecg')).toBe('test')
    expect(categoryOf('echo')).toBe('test')
    expect(categoryOf('cath_lab')).toBe('test')
    expect(categoryOf('pci')).toBe('procedure')
    expect(categoryOf('cabg')).toBe('procedure')
    expect(categoryOf('admission')).toBe('admission')
    expect(categoryOf('medication_change')).toBe('medication')
    expect(categoryOf('review')).toBe('review')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isCardioEventType('ecg')).toBe(true)
    expect(isCardioEventType('nope')).toBe(false)
    expect(CARDIO_TEST_TYPES.length).toBe(7)
    expect(CARDIO_PROCEDURE_TYPES.length).toBe(6)
    expect(CARDIO_EVENT_TYPES.length).toBe(16)
    expect(CARDIO_EVENT_STATUSES).toContain('awaiting_review')
    expect(CARDIO_EVENT_STATUSES).toContain('follow_up')
  })
})

// ── Cardiac test tracking (counts only — never interpret) ──────────
describe('buildTestTracking', () => {
  const events: CardioEvent[] = [
    { eventType: 'ecg', status: 'awaiting_review' },
    { eventType: 'ecg', status: 'ordered' },
    { eventType: 'echo', status: 'reviewed' },       // closed → not open
    { eventType: 'stress_test', status: 'completed' },
  ]
  it('counts each test type by status', () => {
    const rows = buildTestTracking(events)
    const ecg = rows.find(r => r.testType === 'ecg')!
    expect(ecg.awaitingReview).toBe(1)
    expect(ecg.ordered).toBe(1)
    expect(ecg.total).toBe(2)      // awaiting + ordered are open
    const echo = rows.find(r => r.testType === 'echo')!
    expect(echo.reviewed).toBe(1)
    expect(echo.total).toBe(0)     // reviewed → closed
    const stress = rows.find(r => r.testType === 'stress_test')!
    expect(stress.total).toBe(1)   // completed = open
  })
})

// ── Procedure tracker (registry only — never recommend) ────────────
describe('buildProcedureTracker', () => {
  it('counts procedures by status', () => {
    const rows = buildProcedureTracker([
      { eventType: 'pci', status: 'completed' },
      { eventType: 'pci', status: 'follow_up' },
      { eventType: 'cabg', status: 'planned' },
    ])
    const pci = rows.find(r => r.procedureType === 'pci')!
    expect(pci.completed).toBe(1)
    expect(pci.followUp).toBe(1)
    expect(pci.total).toBe(2)
    const cabg = rows.find(r => r.procedureType === 'cabg')!
    expect(cabg.planned).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildCardiacFollowUp', () => {
  const events: CardioEvent[] = [
    { eventType: 'ecg', status: 'awaiting_review' },
    { eventType: 'echo', status: 'ordered' },
    { eventType: 'pci', status: 'follow_up' },
    { eventType: 'admission', status: 'completed' },
    { eventType: 'holter', status: 'reviewed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildCardiacFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('ecg_awaiting')
    expect(codes).toContain('echo_outstanding')
    expect(codes).toContain('procedure_followup')
    expect(codes).toContain('recent_admission')
    expect(f.reminders[0].severity).toBe('warning')
    // test reminders carry the testType so the panel can localise the name
    expect(f.reminders.find(r => r.code === 'ecg_awaiting')!.testType).toBe('ecg')
  })
  it('closed/cancelled statuses raise no reminders', () => {
    const f = buildCardiacFollowUp([{ eventType: 'ecg', status: 'reviewed' }, { eventType: 'echo', status: 'cancelled' }])
    expect(f.reminders).toEqual([])
  })
  it('empty / unknown input → no reminders', () => {
    expect(buildCardiacFollowUp([]).reminders).toEqual([])
    expect(buildCardiacFollowUp([{ eventType: 'bogus', status: 'ordered' }]).reminders).toEqual([])
  })
})

// ── Cardiac lab signals (counts only — never classify) ─────────────
describe('countCardiacLabSignals', () => {
  it('counts cardiac analytes by test-name heuristic without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Troponin I', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'NT-proBNP' }] },
      { status: 'ordered', clinical_notes: 'Lipid panel', items: [] },
      { status: 'completed', clinical_notes: 'Creatinine + electrolytes', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [{ test_name: 'Hemoglobin' }] }, // not cardiac
    ] as unknown as LabOrder[]
    const s = countCardiacLabSignals(orders)
    expect(s.troponin).toBe(1)
    expect(s.bnp).toBe(1)
    expect(s.lipid).toBe(1)
    expect(s.creatinine).toBe(1)
    expect(s.electrolytes).toBe(1)
    expect(s.completed).toBe(2)       // troponin + creatinine/electrolytes order
    expect(s.awaitingReview).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + cardiology prompts) ────
describe('computeCardiologyCompleteness', () => {
  it('reuses GP SOAP score and adds the 9 cardiology prompts', () => {
    const c = computeCardiologyCompleteness({ chief_complaint: 'Chest pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'cardio_doc_chest_pain', 'cardio_doc_dyspnea', 'cardio_doc_palpitations', 'cardio_doc_syncope',
      'cardio_doc_cv_history', 'cardio_doc_risk_factors', 'cardio_doc_family_history',
      'cardio_doc_cardiac_exam', 'cardio_doc_extremities',
    ]))
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildCardiologyBrief', () => {
  it('reuses the GP brief and attaches cardiac tracking + counts', () => {
    const b = buildCardiologyBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'ecg', status: 'awaiting_review' }, { eventType: 'pci', status: 'follow_up' }],
      labSignals: { troponin: 1, bnp: 0, lipid: 0, hba1c: 0, electrolytes: 0, creatinine: 0, ordered: 0, completed: 1, awaitingReview: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.cardiac.ecg).toBe(1)
    expect(b.cardiac.procedures).toBe(1)
    expect(b.cardiac.medications).toBe(2)
    expect(b.cardiac.upcomingAppointments).toBe(1)
    expect(b.followUp.reminders.map(r => r.code)).toContain('ecg_awaiting')
  })
})

// ── Registry integration (cardiology.core) ─────────────────────────
describe('registry integration (cardiology.core)', () => {
  const pack = getCopilotPack('cardiology.core')!
  it('registers 8 cardiology templates that all resolve', () => {
    expect(CARDIO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of CARDIO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...CARDIO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of CARDIO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 cardiology documents for a cardiology doctor', () => {
    for (const id of ['cardiology_referral', 'procedure_clearance', 'cardiac_followup_summary', 'cardiac_rehab_referral']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'cardiology').map(d => d.id)
    expect(ids).toContain('cardiology_referral')
    expect(ids).toContain('gp_referral_letter')      // shared docs still available
    expect(ids).not.toContain('orl_audiology_referral') // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / treatment / prescribing / ECG-Echo interpretation / risk scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no cardiologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.cardiologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no interpretation, no risk/mortality scoring', () => {
    const src = readFileSync(join(__dirname, '..', 'cardiology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No ECG/Echo interpretation, no diagnosis, no risk/mortality prediction, no scoring.
    expect(code).not.toMatch(/interpretEcg|interpretEkg|interpretEcho|readEcg|stElevation|ischemi|infarct|arrhythmiaDiagnos|ejectionFraction|riskScore|mortality|grace|timiScore|framingham|recommendPci|recommendCabg|recommendMed/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useCardiology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'CardiologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '050_cardiology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.cardiologyCopilot).sort()).toEqual(Object.keys(en.cardiologyCopilot).sort())
  })
})

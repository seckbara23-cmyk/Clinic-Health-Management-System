import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isPulmonologyContext, categoryOf, isPulmEventType, buildPulmTracker, buildTestTracker,
  buildPulmFollowUp, countPulmImagingSignals, computePulmCompleteness, buildPulmBrief,
  PULM_COPILOT_PACK_ID, PULM_SPECIALTIES, PULM_ALL_TYPES, PULM_EVENT_STATUSES,
  PULM_EVENT_TYPES, PULM_TEST_TYPES, type PulmEvent,
} from '../pulmonology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, PULM_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('registers pulmonology as a clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('pulmonology')).toBe(true)
  })
  it('active only for a pulmonology doctor; no leakage', () => {
    expect(isPulmonologyContext('doctor', 'pulmonology')).toBe(true)
    expect(isPulmonologyContext('doctor', 'internal_medicine')).toBe(false) // NOT the IM copilot
    expect(isPulmonologyContext('doctor', 'cardiology')).toBe(false)
    expect(isPulmonologyContext('doctor', 'general_practice')).toBe(false)
    expect(isPulmonologyContext('nurse', 'pulmonology')).toBe(false)
    expect(isPulmonologyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(PULM_COPILOT_PACK_ID).toBe('pulmonology.core')
    expect(getCopilotPack('pulmonology.core')!.supportedSpecialties).toEqual([...PULM_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('pulmonary_consultation')).toBe('event')
    expect(categoryOf('oxygen_assessment')).toBe('event')
    expect(categoryOf('smoking_cessation')).toBe('event')
    expect(categoryOf('spirometry')).toBe('test')
    expect(categoryOf('bronchoscopy')).toBe('test')
    expect(categoryOf('chest_ct')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isPulmEventType('spirometry')).toBe(true)
    expect(isPulmEventType('nope')).toBe(false)
    expect(PULM_EVENT_TYPES.length).toBe(5)
    expect(PULM_TEST_TYPES.length).toBe(6)
    expect(PULM_ALL_TYPES.length).toBe(11)
    expect(PULM_EVENT_STATUSES).toContain('awaiting_review')
    expect(PULM_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only — never interpret) ──────────────────
describe('buildPulmTracker', () => {
  const events: PulmEvent[] = [
    { eventType: 'oxygen_assessment', status: 'follow_up_due' },
    { eventType: 'oxygen_assessment', status: 'planned' },
    { eventType: 'smoking_cessation', status: 'completed' },   // closed → not open
    { eventType: 'post_discharge_review', status: 'awaiting_review' },
  ]
  it('counts each event type by status', () => {
    const rows = buildPulmTracker(events)
    const ox = rows.find(r => r.eventType === 'oxygen_assessment')!
    expect(ox.followUpDue).toBe(1)
    expect(ox.planned).toBe(1)
    expect(ox.total).toBe(2)
    const sc = rows.find(r => r.eventType === 'smoking_cessation')!
    expect(sc.completed).toBe(1)
    expect(sc.total).toBe(0)
    expect(rows.find(r => r.eventType === 'post_discharge_review')!.awaitingReview).toBe(1)
  })
})

// ── Test / imaging workflow (counts only — never interpret) ────────
describe('buildTestTracker', () => {
  it('counts tests by status', () => {
    const rows = buildTestTracker([
      { eventType: 'spirometry', status: 'awaiting_review' },
      { eventType: 'spirometry', status: 'ordered' },
      { eventType: 'sleep_study', status: 'reviewed' },  // closed → not open
      { eventType: 'chest_ct', status: 'completed' },
    ])
    const sp = rows.find(r => r.testType === 'spirometry')!
    expect(sp.awaitingReview).toBe(1)
    expect(sp.ordered).toBe(1)
    expect(sp.total).toBe(2)
    expect(rows.find(r => r.testType === 'sleep_study')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'chest_ct')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildPulmFollowUp', () => {
  const events: PulmEvent[] = [
    { eventType: 'oxygen_assessment', status: 'follow_up_due' },
    { eventType: 'post_discharge_review', status: 'awaiting_review' },
    { eventType: 'spirometry', status: 'awaiting_review' },
    { eventType: 'bronchoscopy', status: 'ordered' },
    { eventType: 'smoking_cessation', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildPulmFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('oxygen_assessment_due')
    expect(codes).toContain('post_discharge_review_awaiting')
    expect(codes).toContain('spirometry_awaiting')
    expect(codes).toContain('bronchoscopy_pending')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'spirometry_awaiting')!.refType).toBe('spirometry')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildPulmFollowUp([{ eventType: 'spirometry', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildPulmFollowUp([]).reminders).toEqual([])
    expect(buildPulmFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Imaging signals (counts only — never interpret) ────────────────
describe('countPulmImagingSignals', () => {
  it('counts respiratory investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Chest X-ray', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Spirometry' }] },
      { status: 'ordered', clinical_notes: 'Sleep study (polysomnography)', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not a respiratory investigation
    ] as unknown as LabOrder[]
    const s = countPulmImagingSignals(orders)
    expect(s.imaging).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + pulmonology prompts) ───
describe('computePulmCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 pulmonology prompts', () => {
    const c = computePulmCompleteness({ chief_complaint: 'Shortness of breath', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'pulm_doc_chief_complaint', 'pulm_doc_dyspnea', 'pulm_doc_cough', 'pulm_doc_smoking',
      'pulm_doc_occupational', 'pulm_doc_oxygen_use', 'pulm_doc_exercise_tolerance', 'pulm_doc_respiratory_exam',
      'pulm_doc_investigations', 'pulm_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildPulmBrief', () => {
  it('reuses the GP brief and attaches respiratory + test counts', () => {
    const b = buildPulmBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'oxygen_assessment', status: 'active' }, { eventType: 'spirometry', status: 'ordered' }, { eventType: 'bronchoscopy', status: 'awaiting_review' }, { eventType: 'pulmonary_rehab_referral', status: 'planned' }],
      imagingSignals: { pending: 1, completed: 0, imaging: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.oxygenFollowUp).toBe(1)
    expect(b.summary.pendingTests).toBe(1)   // spirometry ordered
    expect(b.summary.bronchoscopy).toBe(1)   // awaiting_review is open
    expect(b.summary.rehabReferrals).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('bronchoscopy_awaiting')
  })
})

// ── Registry integration (pulmonology.core) ────────────────────────
describe('registry integration (pulmonology.core)', () => {
  const pack = getCopilotPack('pulmonology.core')!
  it('registers 8 pulmonology templates that all resolve', () => {
    expect(PULM_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of PULM_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...PULM_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of PULM_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 pulmonology documents + shared docs for a pulmonology doctor', () => {
    for (const id of ['pulmonology_referral', 'respiratory_followup_summary', 'pulmonary_rehab_referral', 'pulmonary_function_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'pulmonology').map(d => d.id)
    expect(ids).toContain('pulmonology_referral')
    expect(ids).toContain('pulmonary_function_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('ophthalmology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / investigation interpretation / COPD-asthma-fibrosis-pneumonia classification / treatment-medication recommendation / deterioration prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no pulmonologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.pulmonologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no investigation interpretation, no classification / deterioration prediction', () => {
    const src = readFileSync(join(__dirname, '..', 'pulmonology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No investigation interpretation, no COPD/asthma/fibrosis/pneumonia classification, no diagnosis, no deterioration prediction.
    expect(code).not.toMatch(/interpretSpirometr|interpretPft|interpretImage|classifyCopd|classifyAsthma|goldStage|copdStage|fev1Ratio|fibrosisGrade|pneumoniaSeverity|predictDeterioration|exacerbationRisk/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'usePulmonology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'PulmonologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '056_pulmonology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.pulmonologyCopilot).sort()).toEqual(Object.keys(en.pulmonologyCopilot).sort())
  })
})

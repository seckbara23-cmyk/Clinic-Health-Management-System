import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isEndocrinologyContext, categoryOf, isEndoEventType, buildEndoTracker, buildTestTracker,
  buildEndoFollowUp, countEndoImagingSignals, computeEndoCompleteness, buildEndoBrief,
  ENDO_COPILOT_PACK_ID, ENDO_SPECIALTIES, ENDO_ALL_TYPES, ENDO_EVENT_STATUSES,
  ENDO_EVENT_TYPES, ENDO_TEST_TYPES, type EndoEvent,
} from '../endocrinology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, ENDO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an endocrinology doctor; no leakage', () => {
    expect(isEndocrinologyContext('doctor', 'endocrinology')).toBe(true)
    expect(isEndocrinologyContext('doctor', 'oncology')).toBe(false)
    expect(isEndocrinologyContext('doctor', 'neurology')).toBe(false)
    expect(isEndocrinologyContext('doctor', 'internal_medicine')).toBe(false)
    expect(isEndocrinologyContext('doctor', 'general_practice')).toBe(false)
    expect(isEndocrinologyContext('nurse', 'endocrinology')).toBe(false)
    expect(isEndocrinologyContext('doctor', null)).toBe(false)
  })
  it('endocrinology is a registered clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('endocrinology')).toBe(true)
  })
  it('pack id + specialties match the manifest', () => {
    expect(ENDO_COPILOT_PACK_ID).toBe('endocrinology.core')
    expect(getCopilotPack('endocrinology.core')!.supportedSpecialties).toEqual([...ENDO_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('endocrinology_consultation')).toBe('event')
    expect(categoryOf('diabetes_clinic_followup')).toBe('event')
    expect(categoryOf('hormone_review')).toBe('event')
    expect(categoryOf('hba1c')).toBe('test')
    expect(categoryOf('tsh')).toBe('test')
    expect(categoryOf('pituitary_mri')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isEndoEventType('hba1c')).toBe(true)
    expect(isEndoEventType('nope')).toBe(false)
    expect(ENDO_EVENT_TYPES.length).toBe(15)
    expect(ENDO_TEST_TYPES.length).toBe(17)
    expect(ENDO_ALL_TYPES.length).toBe(32)
    expect(ENDO_EVENT_STATUSES).toContain('scheduled')
    expect(ENDO_EVENT_STATUSES).toContain('awaiting_review')
    expect(ENDO_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only) ────────────────────────────────────
describe('buildEndoTracker', () => {
  const events: EndoEvent[] = [
    { eventType: 'diabetes_clinic_followup', status: 'follow_up_due' },
    { eventType: 'diabetes_clinic_followup', status: 'planned' },
    { eventType: 'hospital_discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'hormone_review', status: 'awaiting_review' },
    { eventType: 'thyroid_clinic_followup', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildEndoTracker(events)
    const diab = rows.find(r => r.eventType === 'diabetes_clinic_followup')!
    expect(diab.followUpDue).toBe(1)
    expect(diab.planned).toBe(1)
    expect(diab.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'hospital_discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'hormone_review')!.awaitingReview).toBe(1)
    const thy = rows.find(r => r.eventType === 'thyroid_clinic_followup')!
    expect(thy.scheduled).toBe(1)
    expect(thy.total).toBe(1)
  })
})

// ── Laboratory / imaging workflow (counts only) ────────────────────
describe('buildTestTracker (laboratory + imaging workflow)', () => {
  it('counts laboratory and imaging tests by status', () => {
    const rows = buildTestTracker([
      { eventType: 'hba1c', status: 'awaiting_review' },   // laboratory
      { eventType: 'hba1c', status: 'ordered' },
      { eventType: 'tsh', status: 'reviewed' },            // closed → not open
      { eventType: 'thyroid_ultrasound', status: 'completed' },  // imaging
      { eventType: 'pituitary_mri', status: 'ordered' },   // imaging
    ])
    const hba1c = rows.find(r => r.testType === 'hba1c')!
    expect(hba1c.awaitingReview).toBe(1)
    expect(hba1c.ordered).toBe(1)
    expect(hba1c.total).toBe(2)
    expect(rows.find(r => r.testType === 'tsh')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'thyroid_ultrasound')!.total).toBe(1)
    expect(rows.find(r => r.testType === 'pituitary_mri')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildEndoFollowUp', () => {
  const events: EndoEvent[] = [
    { eventType: 'diabetes_clinic_followup', status: 'follow_up_due' },
    { eventType: 'hormone_review', status: 'awaiting_review' },
    { eventType: 'hba1c', status: 'awaiting_review' },
    { eventType: 'tsh', status: 'ordered' },
    { eventType: 'thyroid_clinic_followup', status: 'scheduled' },
    { eventType: 'hospital_discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildEndoFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('diabetes_clinic_followup_due')
    expect(codes).toContain('hormone_review_awaiting')
    expect(codes).toContain('hba1c_awaiting')
    expect(codes).toContain('tsh_pending')
    expect(codes).toContain('thyroid_clinic_followup_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'hba1c_awaiting')!.refType).toBe('hba1c')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildEndoFollowUp([{ eventType: 'hba1c', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildEndoFollowUp([]).reminders).toEqual([])
    expect(buildEndoFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countEndoImagingSignals', () => {
  it('counts endocrine investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'HbA1c 7.2', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'TSH' }] },
      { status: 'ordered', clinical_notes: 'Thyroid ultrasound', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not an endocrine investigation
    ] as unknown as LabOrder[]
    const s = countEndoImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + endocrinology prompts) ─
describe('computeEndoCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 endocrinology prompts', () => {
    const c = computeEndoCompleteness({ chief_complaint: 'Fatigue', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'endo_doc_endocrine_history', 'endo_doc_diabetes_history', 'endo_doc_thyroid_history', 'endo_doc_medication_adherence',
      'endo_doc_lifestyle_review', 'endo_doc_nutrition_review', 'endo_doc_laboratory_followup', 'endo_doc_imaging_followup',
      'endo_doc_education_review', 'endo_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildEndoBrief', () => {
  it('reuses the GP brief and attaches endocrinology counts', () => {
    const b = buildEndoBrief({
      now: new Date(), activePrescriptions: 3, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'thyroid_clinic_followup', status: 'scheduled' },
        { eventType: 'diabetes_clinic_followup', status: 'active' },
        { eventType: 'hba1c', status: 'ordered' },
        { eventType: 'tsh', status: 'awaiting_review' },
        { eventType: 'dexa', status: 'ordered' },
        { eventType: 'nutrition_referral', status: 'active' },
        { eventType: 'hospital_discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.diabetesFollowups).toBe(1)
    expect(b.summary.thyroidFollowups).toBe(1)
    expect(b.summary.pendingLabs).toBe(2)     // hba1c ordered + tsh awaiting_review (both laboratory)
    expect(b.summary.pendingImaging).toBe(1)  // dexa ordered (imaging)
    expect(b.summary.nutrition).toBe(1)
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(3)
    expect(b.followUp.reminders.map(r => r.code)).toContain('tsh_awaiting')
  })
})

// ── Registry integration (endocrinology.core) ──────────────────────
describe('registry integration (endocrinology.core)', () => {
  const pack = getCopilotPack('endocrinology.core')!
  it('registers 8 endocrinology templates that all resolve', () => {
    expect(ENDO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of ENDO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...ENDO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of ENDO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 endocrinology documents + shared docs for an endocrinology doctor', () => {
    for (const id of ['endocrinology_referral', 'diabetes_followup_summary', 'thyroid_followup_summary', 'hormone_investigation_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'endocrinology').map(d => d.id)
    expect(ids).toContain('endocrinology_referral')
    expect(ids).toContain('thyroid_followup_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('neurology_referral')   // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / diabetes-thyroid-pituitary-adrenal classification / HbA1c-hormone-MRI-ultrasound interpretation / insulin-med recommendation / complication-mortality-CV-risk prediction / diabetes-fracture scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /\bFRAX\b|findrisc|cardiovascular risk|mortality|prognos|fracture risk|\bhoma\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no endocrinologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.endocrinologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no endocrinologyCopilot i18n string contains scoring / CV-risk / mortality / prognosis wording', () => {
    for (const [k, v] of Object.entries(en.endocrinologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no HbA1c/hormone/MRI/ultrasound interpretation, no classification / scoring / prediction / recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'endocrinology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no diabetes/thyroid/pituitary/adrenal classification, no diabetes/fracture scoring, no complication/mortality/CV-risk prediction, no insulin/medication/dosage/surgery/admission/discharge recommendation.
    expect(code).not.toMatch(/interpretHba1c|interpretThyroid|interpretCortisol|interpretHormone|interpretMri|interpretUltrasound|classifyDiabetes|classifyThyroid|classifyPituitary|classifyAdrenal|diabetesType|thyroidType|recommendInsulin|recommendMedication|recommendDosage|recommendSurgery|recommendAdmission|recommendDischarge|predictComplication|predictMortality|cardiovascularRisk|diabetesScore|fractureRisk|fraxScore/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useEndocrinology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'EndocrinologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '061_endocrinology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.endocrinologyCopilot).sort()).toEqual(Object.keys(en.endocrinologyCopilot).sort())
  })
})

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isInternalMedicineContext, categoryOf, isImEventType, buildChronicTracker, buildImFollowUp,
  countImLabSignals, computeImCompleteness, buildImBrief, IM_COPILOT_PACK_ID, IM_SPECIALTIES,
  IM_EVENT_TYPES, IM_EVENT_STATUSES, CHRONIC_CONDITIONS, type ImEvent,
} from '../internal-medicine/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, IM_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an internal-medicine doctor; no leakage', () => {
    expect(isInternalMedicineContext('doctor', 'internal_medicine')).toBe(true)
    expect(isInternalMedicineContext('doctor', 'cardiology')).toBe(false)
    expect(isInternalMedicineContext('doctor', 'emergency_medicine')).toBe(false)
    expect(isInternalMedicineContext('doctor', 'general_practice')).toBe(false)
    expect(isInternalMedicineContext('nurse', 'internal_medicine')).toBe(false)
    expect(isInternalMedicineContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(IM_COPILOT_PACK_ID).toBe('internal_medicine.core')
    expect(getCopilotPack('internal_medicine.core')!.supportedSpecialties).toEqual([...IM_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('diabetes')).toBe('chronic')
    expect(categoryOf('ckd')).toBe('chronic')
    expect(categoryOf('anemia')).toBe('chronic')
    expect(categoryOf('discharge_followup')).toBe('discharge')
    expect(categoryOf('medication_review')).toBe('medication')
    expect(categoryOf('polypharmacy_review')).toBe('medication')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isImEventType('diabetes')).toBe(true)
    expect(isImEventType('nope')).toBe(false)
    expect(CHRONIC_CONDITIONS.length).toBe(7)
    expect(IM_EVENT_TYPES.length).toBe(10)
    expect(IM_EVENT_STATUSES).toContain('overdue')
    expect(IM_EVENT_STATUSES).toContain('awaiting_review')
  })
})

// ── Chronic-disease tracker (counts only — never interpret) ────────
describe('buildChronicTracker', () => {
  const events: ImEvent[] = [
    { eventType: 'diabetes', status: 'overdue' },
    { eventType: 'diabetes', status: 'due' },
    { eventType: 'hypertension', status: 'completed' },  // closed → not open
    { eventType: 'ckd', status: 'awaiting_review' },
  ]
  it('counts each condition by status', () => {
    const rows = buildChronicTracker(events)
    const dm = rows.find(r => r.condition === 'diabetes')!
    expect(dm.overdue).toBe(1)
    expect(dm.due).toBe(1)
    expect(dm.total).toBe(2)
    const htn = rows.find(r => r.condition === 'hypertension')!
    expect(htn.completed).toBe(1)
    expect(htn.total).toBe(0)
    const ckd = rows.find(r => r.condition === 'ckd')!
    expect(ckd.awaitingReview).toBe(1)
    expect(ckd.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildImFollowUp', () => {
  const events: ImEvent[] = [
    { eventType: 'diabetes', status: 'overdue' },
    { eventType: 'hypertension', status: 'awaiting_review' },
    { eventType: 'ckd', status: 'due' },
    { eventType: 'discharge_followup', status: 'due' },
    { eventType: 'medication_review', status: 'due' },
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildImFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('diabetes_overdue')
    expect(codes).toContain('hypertension_awaiting')
    expect(codes).toContain('ckd_due')
    expect(codes).toContain('discharge_due')
    expect(codes).toContain('medication_review_due')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'diabetes_overdue')!.condition).toBe('diabetes')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildImFollowUp([{ eventType: 'diabetes', status: 'completed' }]).reminders).toEqual([])
    expect(buildImFollowUp([]).reminders).toEqual([])
    expect(buildImFollowUp([{ eventType: 'bogus', status: 'due' }]).reminders).toEqual([])
  })
})

// ── Lab follow-up (counts only — never classify a value) ───────────
describe('countImLabSignals', () => {
  it('counts chronic-care labs by name heuristic without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'HbA1c', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Creatinine (eGFR)' }] },
      { status: 'ordered', clinical_notes: 'Lipid profile', items: [] },
      { status: 'completed', clinical_notes: 'TSH', items: [] },
      { status: 'ordered', clinical_notes: 'Urine albumin/creatinine ratio', items: [] },
      { status: 'ordered', clinical_notes: 'Chest X-ray', items: [] }, // not a chronic lab
    ] as unknown as LabOrder[]
    const s = countImLabSignals(orders)
    expect(s.hba1c).toBe(1)
    expect(s.creatinine).toBe(2)   // "Creatinine (eGFR)" + the urine ACR mentions creatinine
    expect(s.lipid).toBe(1)
    expect(s.tsh).toBe(1)
    expect(s.urine_albumin).toBe(1)
    expect(s.completed).toBe(2)    // HbA1c + TSH
    expect(s.awaitingReview).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + IM prompts) ────────────
describe('computeImCompleteness', () => {
  it('reuses GP SOAP score and adds the 8 internal-medicine prompts', () => {
    const c = computeImCompleteness({ chief_complaint: 'Diabetes follow-up', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'im_doc_chronic_history', 'im_doc_medication_review', 'im_doc_adherence', 'im_doc_lifestyle',
      'im_doc_complications', 'im_doc_ros', 'im_doc_physical_exam', 'im_doc_follow_up_plan',
    ]))
    expect(c.prompts.length).toBe(8)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildImBrief', () => {
  it('reuses the GP brief and attaches chronic + lab counts', () => {
    const b = buildImBrief({
      now: new Date(), activePrescriptions: 4, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 2, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'diabetes', status: 'due' }, { eventType: 'hypertension', status: 'awaiting_review' }, { eventType: 'discharge_followup', status: 'due' }],
      labSignals: { hba1c: 1, creatinine: 1, lipid: 0, tsh: 0, cbc: 0, electrolytes: 0, urine_albumin: 0, ordered: 1, completed: 1, awaitingReview: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.chronicFollowUps).toBe(2)   // diabetes(due) + hypertension(awaiting)
    expect(b.summary.recentLabs).toBe(2)
    expect(b.summary.medications).toBe(4)
    expect(b.summary.dischargeFollowUps).toBe(1)
    expect(b.summary.pendingReview).toBe(2)      // 1 chronic awaiting + 1 lab awaiting
    expect(b.followUp.reminders.map(r => r.code)).toContain('diabetes_due')
  })
})

// ── Registry integration (internal_medicine.core) ──────────────────
describe('registry integration (internal_medicine.core)', () => {
  const pack = getCopilotPack('internal_medicine.core')!
  it('registers 8 internal-medicine templates that all resolve', () => {
    expect(IM_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of IM_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...IM_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of IM_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 internal-medicine documents + shared docs for an IM doctor', () => {
    for (const id of ['internal_medicine_referral', 'chronic_disease_followup_summary', 'hospital_discharge_followup_note', 'medication_review_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'internal_medicine').map(d => d.id)
    expect(ids).toContain('internal_medicine_referral')
    expect(ids).toContain('medication_review_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('cardiology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / severity / lab-interpretation / treatment / medication recommendation / risk scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no internalMedicineCopilot i18n string contains diagnosis/treatment/disease wording', () => {
    for (const [k, v] of Object.entries(en.internalMedicineCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no lab interpretation, no severity/risk scoring', () => {
    const src = readFileSync(join(__dirname, '..', 'internal-medicine', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No lab interpretation, no severity classification, no diagnosis, no risk/mortality scoring.
    expect(code).not.toMatch(/controlled|uncontrolled|classifySeverity|ckdStage|gfrStage|diagnos|interpretLab|riskScore|mortality|framingham|hba1cTarget|isDiabetic|isAnemic/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useInternalMedicine.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'InternalMedicineCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '052_internal_medicine_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.internalMedicineCopilot).sort()).toEqual(Object.keys(en.internalMedicineCopilot).sort())
  })
})

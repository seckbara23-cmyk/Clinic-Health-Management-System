import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isSurgeryContext, categoryOf, isSurgeryEventType, buildSurgeryTracker, buildTestTracker,
  buildSurgeryFollowUp, countSurgeryImagingSignals, computeSurgeryCompleteness, buildSurgeryBrief,
  SURGERY_COPILOT_PACK_ID, SURGERY_SPECIALTIES, SURGERY_ALL_TYPES, SURGERY_EVENT_STATUSES,
  SURGERY_EVENT_TYPES, SURGERY_TEST_TYPES, type SurgeryEvent,
} from '../surgery/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, SURGERY_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a (general) surgery doctor; no leakage', () => {
    expect(isSurgeryContext('doctor', 'general_surgery')).toBe(true)
    expect(isSurgeryContext('doctor', 'surgery')).toBe(true)       // forward-compat alias
    expect(isSurgeryContext('doctor', 'oncology')).toBe(false)
    expect(isSurgeryContext('doctor', 'orthopedics')).toBe(false)
    expect(isSurgeryContext('doctor', 'general_practice')).toBe(false)
    expect(isSurgeryContext('nurse', 'general_surgery')).toBe(false)
    expect(isSurgeryContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(SURGERY_COPILOT_PACK_ID).toBe('surgery.core')
    expect(getCopilotPack('surgery.core')!.supportedSpecialties).toEqual([...SURGERY_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('surgical_consultation')).toBe('event')
    expect(categoryOf('wound_review')).toBe('event')
    expect(categoryOf('pathology_review')).toBe('event')
    expect(categoryOf('surgery_scheduled')).toBe('event')
    expect(categoryOf('ct')).toBe('test')
    expect(categoryOf('endoscopy')).toBe('test')
    expect(categoryOf('pathology')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isSurgeryEventType('ct')).toBe(true)
    expect(isSurgeryEventType('nope')).toBe(false)
    expect(SURGERY_EVENT_TYPES.length).toBe(15)
    expect(SURGERY_TEST_TYPES.length).toBe(9)
    expect(SURGERY_ALL_TYPES.length).toBe(24)
    expect(SURGERY_EVENT_STATUSES).toContain('scheduled')
    expect(SURGERY_EVENT_STATUSES).toContain('awaiting_review')
    expect(SURGERY_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only — never interpret) ──────────────────
describe('buildSurgeryTracker', () => {
  const events: SurgeryEvent[] = [
    { eventType: 'wound_review', status: 'follow_up_due' },
    { eventType: 'wound_review', status: 'planned' },
    { eventType: 'surgery_completed', status: 'completed' },   // closed → not open
    { eventType: 'postop_review', status: 'awaiting_review' },
    { eventType: 'surgery_scheduled', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildSurgeryTracker(events)
    const wound = rows.find(r => r.eventType === 'wound_review')!
    expect(wound.followUpDue).toBe(1)
    expect(wound.planned).toBe(1)
    expect(wound.total).toBe(2)
    const done = rows.find(r => r.eventType === 'surgery_completed')!
    expect(done.completed).toBe(1)
    expect(done.total).toBe(0)
    expect(rows.find(r => r.eventType === 'postop_review')!.awaitingReview).toBe(1)
    const sched = rows.find(r => r.eventType === 'surgery_scheduled')!
    expect(sched.scheduled).toBe(1)
    expect(sched.total).toBe(1)
  })
})

// ── Investigation workflow (counts only — never interpret) ─────────
describe('buildTestTracker', () => {
  it('counts investigations by status', () => {
    const rows = buildTestTracker([
      { eventType: 'ct', status: 'awaiting_review' },
      { eventType: 'ct', status: 'ordered' },
      { eventType: 'endoscopy', status: 'reviewed' },  // closed → not open
      { eventType: 'mri', status: 'completed' },
    ])
    const ct = rows.find(r => r.testType === 'ct')!
    expect(ct.awaitingReview).toBe(1)
    expect(ct.ordered).toBe(1)
    expect(ct.total).toBe(2)
    expect(rows.find(r => r.testType === 'endoscopy')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'mri')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildSurgeryFollowUp', () => {
  const events: SurgeryEvent[] = [
    { eventType: 'wound_review', status: 'follow_up_due' },
    { eventType: 'postop_review', status: 'awaiting_review' },
    { eventType: 'pathology', status: 'awaiting_review' },
    { eventType: 'ct', status: 'ordered' },
    { eventType: 'surgery_scheduled', status: 'scheduled' },
    { eventType: 'surgery_completed', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildSurgeryFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('wound_review_due')
    expect(codes).toContain('postop_review_awaiting')
    expect(codes).toContain('pathology_awaiting')
    expect(codes).toContain('ct_pending')
    expect(codes).toContain('surgery_scheduled_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'pathology_awaiting')!.refType).toBe('pathology')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildSurgeryFollowUp([{ eventType: 'ct', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildSurgeryFollowUp([]).reminders).toEqual([])
    expect(buildSurgeryFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countSurgeryImagingSignals', () => {
  it('counts surgery investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'CT abdomen', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Colonoscopy' }] },
      { status: 'ordered', clinical_notes: 'Histopathology report', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not a surgery investigation
    ] as unknown as LabOrder[]
    const s = countSurgeryImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + surgery prompts) ───────
describe('computeSurgeryCompleteness', () => {
  it('reuses GP SOAP score and adds the 9 surgery prompts', () => {
    const c = computeSurgeryCompleteness({ chief_complaint: 'Right iliac fossa pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'surg_doc_indication', 'surg_doc_surgical_history', 'surg_doc_operative_findings', 'surg_doc_wound_status',
      'surg_doc_drain_status', 'surg_doc_pathology_followup', 'surg_doc_discharge_planning', 'surg_doc_complications',
      'surg_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(9)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildSurgeryBrief', () => {
  it('reuses the GP brief and attaches surgical counts', () => {
    const b = buildSurgeryBrief({
      now: new Date(), activePrescriptions: 3, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'surgery_scheduled', status: 'scheduled' },
        { eventType: 'postop_review', status: 'active' },
        { eventType: 'wound_review', status: 'awaiting_review' },
        { eventType: 'pathology', status: 'ordered' },
        { eventType: 'ct', status: 'awaiting_review' },
        { eventType: 'icu_followup', status: 'active' },
        { eventType: 'discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.scheduledSurgery).toBe(1)
    expect(b.summary.postopReviews).toBe(1)
    expect(b.summary.woundDrain).toBe(1)
    expect(b.summary.pendingPathology).toBe(1)
    expect(b.summary.pendingInvestigations).toBe(1)  // ct awaiting_review is open
    expect(b.summary.icuWard).toBe(1)
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(3)
    expect(b.followUp.reminders.map(r => r.code)).toContain('ct_awaiting')
  })
})

// ── Registry integration (surgery.core) ────────────────────────────
describe('registry integration (surgery.core)', () => {
  const pack = getCopilotPack('surgery.core')!
  it('registers 8 surgery templates that all resolve', () => {
    expect(SURGERY_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of SURGERY_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...SURGERY_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of SURGERY_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 surgery documents + shared docs for a surgery doctor', () => {
    for (const id of ['surgical_referral', 'operative_summary', 'postop_summary', 'surgical_discharge_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'general_surgery').map(d => d.id)
    expect(ids).toContain('surgical_referral')
    expect(ids).toContain('postop_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('oncology_referral')    // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / recommendation / pathology-imaging-endoscopy interpretation / complication-mortality prediction / ASA-POSSUM-APACHE scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /\bASA\b|POSSUM|APACHE|mortality|anaesthesi|anesthesi|transfusion/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no surgeryCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.surgeryCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no surgeryCopilot i18n string contains scoring / anaesthesia / transfusion / mortality wording', () => {
    for (const [k, v] of Object.entries(en.surgeryCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no pathology/imaging/endoscopy interpretation, no scoring / prediction / recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'surgery', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no ASA/POSSUM/APACHE scoring, no complication/mortality/success prediction, no operative/medication/admission/discharge/ICU/anaesthesia/transfusion recommendation.
    expect(code).not.toMatch(/interpretPatholog|interpretCt|interpretMri|interpretXray|interpretEndoscop|calcAsa|asaScore|possumScore|apacheScore|predictComplication|predictMortality|predictSuccess|recommendSurgery|recommendAntibiotic|recommendAdmission|recommendDischarge|recommendIcu|recommendAnesthes|recommendAnaesthes|recommendTransfusion|recommendTechnique|conservativeManagement/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useSurgery.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'SurgeryCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '059_surgery_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.surgeryCopilot).sort()).toEqual(Object.keys(en.surgeryCopilot).sort())
  })
})

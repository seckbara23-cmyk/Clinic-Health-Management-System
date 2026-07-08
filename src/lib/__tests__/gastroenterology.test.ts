import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isGastroenterologyContext, categoryOf, isGiEventType, buildGiTracker, buildTestTracker,
  buildGiFollowUp, countGiImagingSignals, computeGiCompleteness, buildGiBrief,
  GI_COPILOT_PACK_ID, GI_SPECIALTIES, GI_ALL_TYPES, GI_EVENT_STATUSES,
  GI_EVENT_TYPES, GI_TEST_TYPES, type GiEvent,
} from '../gastroenterology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, GI_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a gastroenterology doctor; no leakage', () => {
    expect(isGastroenterologyContext('doctor', 'gastroenterology')).toBe(true)
    expect(isGastroenterologyContext('doctor', 'internal_medicine')).toBe(false)
    expect(isGastroenterologyContext('doctor', 'oncology')).toBe(false)
    expect(isGastroenterologyContext('doctor', 'urology')).toBe(false)
    expect(isGastroenterologyContext('doctor', 'general_practice')).toBe(false)
    expect(isGastroenterologyContext('nurse', 'gastroenterology')).toBe(false)
    expect(isGastroenterologyContext('doctor', null)).toBe(false)
  })
  it('gastroenterology is a registered clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('gastroenterology')).toBe(true)
  })
  it('pack id + specialties match the manifest', () => {
    expect(GI_COPILOT_PACK_ID).toBe('gastroenterology.core')
    expect(getCopilotPack('gastroenterology.core')!.supportedSpecialties).toEqual([...GI_SPECIALTIES])
  })
})

// ── Event vocabulary (event ≠ investigation, no collision) ─────────
describe('event vocabulary', () => {
  it('maps event types to the right category with no event/test collision', () => {
    expect(categoryOf('gi_consultation')).toBe('event')
    expect(categoryOf('endoscopy_followup')).toBe('event')   // workflow event
    expect(categoryOf('pathology_review')).toBe('event')
    expect(categoryOf('biopsy_followup')).toBe('event')
    expect(categoryOf('endoscopy')).toBe('test')             // investigation (distinct id)
    expect(categoryOf('colonoscopy')).toBe('test')
    expect(categoryOf('biopsy')).toBe('test')
    expect(categoryOf('pathology')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isGiEventType('endoscopy')).toBe(true)
    expect(isGiEventType('nope')).toBe(false)
    expect(GI_EVENT_TYPES.length).toBe(11)
    expect(GI_TEST_TYPES.length).toBe(10)
    expect(GI_ALL_TYPES.length).toBe(21)
    expect(new Set(GI_ALL_TYPES).size).toBe(21)             // no duplicate ids across tracks
    expect(GI_EVENT_STATUSES).toContain('scheduled')
    expect(GI_EVENT_STATUSES).toContain('awaiting_review')
    expect(GI_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only) ────────────────────────────────────
describe('buildGiTracker', () => {
  const events: GiEvent[] = [
    { eventType: 'endoscopy_followup', status: 'follow_up_due' },
    { eventType: 'endoscopy_followup', status: 'planned' },
    { eventType: 'discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'pathology_review', status: 'awaiting_review' },
    { eventType: 'colonoscopy_followup', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildGiTracker(events)
    const endo = rows.find(r => r.eventType === 'endoscopy_followup')!
    expect(endo.followUpDue).toBe(1)
    expect(endo.planned).toBe(1)
    expect(endo.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'pathology_review')!.awaitingReview).toBe(1)
    const colon = rows.find(r => r.eventType === 'colonoscopy_followup')!
    expect(colon.scheduled).toBe(1)
    expect(colon.total).toBe(1)
  })
})

// ── Investigation workflow (counts only) ───────────────────────────
describe('buildTestTracker (investigation workflow)', () => {
  it('counts investigations and pathology tests by status', () => {
    const rows = buildTestTracker([
      { eventType: 'endoscopy', status: 'awaiting_review' },
      { eventType: 'endoscopy', status: 'ordered' },
      { eventType: 'colonoscopy', status: 'reviewed' },  // closed → not open
      { eventType: 'biopsy', status: 'completed' },
      { eventType: 'pathology', status: 'ordered' },
    ])
    const endo = rows.find(r => r.testType === 'endoscopy')!
    expect(endo.awaitingReview).toBe(1)
    expect(endo.ordered).toBe(1)
    expect(endo.total).toBe(2)
    expect(rows.find(r => r.testType === 'colonoscopy')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'biopsy')!.total).toBe(1)
    expect(rows.find(r => r.testType === 'pathology')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildGiFollowUp', () => {
  const events: GiEvent[] = [
    { eventType: 'endoscopy_followup', status: 'follow_up_due' },
    { eventType: 'pathology_review', status: 'awaiting_review' },
    { eventType: 'biopsy', status: 'awaiting_review' },
    { eventType: 'colonoscopy', status: 'ordered' },
    { eventType: 'liver_clinic_followup', status: 'scheduled' },
    { eventType: 'discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildGiFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('endoscopy_followup_due')
    expect(codes).toContain('pathology_review_awaiting')
    expect(codes).toContain('biopsy_awaiting')
    expect(codes).toContain('colonoscopy_pending')
    expect(codes).toContain('liver_clinic_followup_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'biopsy_awaiting')!.refType).toBe('biopsy')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildGiFollowUp([{ eventType: 'biopsy', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildGiFollowUp([]).reminders).toEqual([])
    expect(buildGiFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countGiImagingSignals', () => {
  it('counts GI investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Colonoscopy', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Liver panel' }] },
      { status: 'ordered', clinical_notes: 'Abdominal ultrasound', items: [] },
      { status: 'ordered', clinical_notes: 'Chest X-ray', items: [] }, // not a GI investigation
    ] as unknown as LabOrder[]
    const s = countGiImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + GI prompts) ────────────
describe('computeGiCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 gastroenterology prompts', () => {
    const c = computeGiCompleteness({ chief_complaint: 'Abdominal pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'gi_doc_gi_complaint', 'gi_doc_abdominal_symptoms', 'gi_doc_bowel_history', 'gi_doc_liver_history',
      'gi_doc_nutrition_review', 'gi_doc_procedure_history', 'gi_doc_pathology_followup', 'gi_doc_imaging_followup',
      'gi_doc_medication_review', 'gi_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildGiBrief', () => {
  it('reuses the GP brief and attaches gastroenterology counts', () => {
    const b = buildGiBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'colonoscopy_followup', status: 'scheduled' },
        { eventType: 'endoscopy', status: 'ordered' },
        { eventType: 'biopsy', status: 'awaiting_review' },
        { eventType: 'abdominal_ultrasound', status: 'ordered' },
        { eventType: 'liver_clinic_followup', status: 'active' },
        { eventType: 'nutrition_referral', status: 'active' },
        { eventType: 'pathology', status: 'ordered' },
        { eventType: 'discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.pendingEndoscopy).toBe(2)    // endoscopy ordered + colonoscopy_followup scheduled
    expect(b.summary.pendingPathology).toBe(2)    // biopsy awaiting_review + pathology ordered
    expect(b.summary.pendingImaging).toBe(1)      // abdominal_ultrasound ordered
    expect(b.summary.liverIbd).toBe(1)            // liver_clinic_followup active
    expect(b.summary.nutrition).toBe(1)
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('biopsy_awaiting')
  })
})

// ── Registry integration (gastroenterology.core) ───────────────────
describe('registry integration (gastroenterology.core)', () => {
  const pack = getCopilotPack('gastroenterology.core')!
  it('registers 8 gastroenterology templates that all resolve', () => {
    expect(GI_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of GI_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...GI_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of GI_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 gastroenterology documents + shared docs for a GI doctor', () => {
    for (const id of ['gastroenterology_referral', 'endoscopy_followup_summary', 'colonoscopy_followup_summary', 'gastroenterology_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'gastroenterology').map(d => d.id)
    expect(ids).toContain('gastroenterology_referral')
    expect(ids).toContain('endoscopy_followup_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('urology_referral')     // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / liver-IBD classification / endoscopy-colonoscopy-gastroscopy-pathology-biopsy interpretation / treatment-med-surgery recommendation / cancer-risk-prognosis prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /cirrhosis|malignan|carcinoma|\bcancer\b|crohn|\bcolitis\b|adenoma|dysplasia|prognos|varice/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no gastroenterologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.gastroenterologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no gastroenterologyCopilot i18n string contains classification / cancer / prognosis wording', () => {
    for (const [k, v] of Object.entries(en.gastroenterologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no endoscopy/colonoscopy/gastroscopy/pathology/biopsy interpretation, no classification / prediction / recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'gastroenterology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no liver/IBD classification, no cancer/risk/prognosis prediction, no treatment/medication/surgery recommendation.
    expect(code).not.toMatch(/interpretEndoscopy|interpretColonoscopy|interpretGastroscopy|interpretPatholog|interpretBiops|classifyLiver|classifyIbd|liverDisease|ibdType|recommendTreatment|recommendMedication|recommendSurgery|predictCancer|predictRisk|prognosis|cancerRisk/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useGastroenterology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'GastroenterologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '064_gastroenterology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.gastroenterologyCopilot).sort()).toEqual(Object.keys(en.gastroenterologyCopilot).sort())
  })
})

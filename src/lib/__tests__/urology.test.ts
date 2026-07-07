import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isUrologyContext, categoryOf, isUroEventType, buildUroTracker, buildTestTracker,
  buildUroFollowUp, countUroImagingSignals, computeUroCompleteness, buildUroBrief,
  URO_COPILOT_PACK_ID, URO_SPECIALTIES, URO_ALL_TYPES, URO_EVENT_STATUSES,
  URO_EVENT_TYPES, URO_TEST_TYPES, type UroEvent,
} from '../urology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, URO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a urology doctor; no leakage', () => {
    expect(isUrologyContext('doctor', 'urology')).toBe(true)
    expect(isUrologyContext('doctor', 'nephrology')).toBe(false)
    expect(isUrologyContext('doctor', 'oncology')).toBe(false)
    expect(isUrologyContext('doctor', 'general_surgery')).toBe(false)
    expect(isUrologyContext('doctor', 'general_practice')).toBe(false)
    expect(isUrologyContext('nurse', 'urology')).toBe(false)
    expect(isUrologyContext('doctor', null)).toBe(false)
  })
  it('urology is a registered clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('urology')).toBe(true)
  })
  it('pack id + specialties match the manifest', () => {
    expect(URO_COPILOT_PACK_ID).toBe('urology.core')
    expect(getCopilotPack('urology.core')!.supportedSpecialties).toEqual([...URO_SPECIALTIES])
  })
})

// ── Event vocabulary (event ≠ investigation, no collision) ─────────
describe('event vocabulary', () => {
  it('maps event types to the right category with no event/test collision', () => {
    expect(categoryOf('urology_consultation')).toBe('event')
    expect(categoryOf('kidney_stone_followup')).toBe('event')
    expect(categoryOf('cystoscopy_followup')).toBe('event')  // workflow event
    expect(categoryOf('biopsy_followup')).toBe('event')
    expect(categoryOf('urinalysis')).toBe('test')
    expect(categoryOf('psa')).toBe('test')
    expect(categoryOf('cystoscopy')).toBe('test')            // investigation (distinct id)
    expect(categoryOf('biopsy')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isUroEventType('psa')).toBe(true)
    expect(isUroEventType('nope')).toBe(false)
    expect(URO_EVENT_TYPES.length).toBe(15)
    expect(URO_TEST_TYPES.length).toBe(11)
    expect(URO_ALL_TYPES.length).toBe(26)
    expect(new Set(URO_ALL_TYPES).size).toBe(26)             // no duplicate ids across tracks
    expect(URO_EVENT_STATUSES).toContain('scheduled')
    expect(URO_EVENT_STATUSES).toContain('awaiting_review')
    expect(URO_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only) ────────────────────────────────────
describe('buildUroTracker', () => {
  const events: UroEvent[] = [
    { eventType: 'kidney_stone_followup', status: 'follow_up_due' },
    { eventType: 'kidney_stone_followup', status: 'planned' },
    { eventType: 'hospital_discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'cystoscopy_followup', status: 'awaiting_review' },
    { eventType: 'prostate_review', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildUroTracker(events)
    const stone = rows.find(r => r.eventType === 'kidney_stone_followup')!
    expect(stone.followUpDue).toBe(1)
    expect(stone.planned).toBe(1)
    expect(stone.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'hospital_discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'cystoscopy_followup')!.awaitingReview).toBe(1)
    const prostate = rows.find(r => r.eventType === 'prostate_review')!
    expect(prostate.scheduled).toBe(1)
    expect(prostate.total).toBe(1)
  })
})

// ── Investigation workflow (counts only) ───────────────────────────
describe('buildTestTracker (investigation workflow)', () => {
  it('counts investigations by status', () => {
    const rows = buildTestTracker([
      { eventType: 'psa', status: 'awaiting_review' },
      { eventType: 'psa', status: 'ordered' },
      { eventType: 'urinalysis', status: 'reviewed' },  // closed → not open
      { eventType: 'cystoscopy', status: 'completed' },
      { eventType: 'biopsy', status: 'ordered' },
    ])
    const psa = rows.find(r => r.testType === 'psa')!
    expect(psa.awaitingReview).toBe(1)
    expect(psa.ordered).toBe(1)
    expect(psa.total).toBe(2)
    expect(rows.find(r => r.testType === 'urinalysis')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'cystoscopy')!.total).toBe(1)
    expect(rows.find(r => r.testType === 'biopsy')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildUroFollowUp', () => {
  const events: UroEvent[] = [
    { eventType: 'kidney_stone_followup', status: 'follow_up_due' },
    { eventType: 'cystoscopy_followup', status: 'awaiting_review' },
    { eventType: 'psa', status: 'awaiting_review' },
    { eventType: 'urinalysis', status: 'ordered' },
    { eventType: 'prostate_review', status: 'scheduled' },
    { eventType: 'hospital_discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildUroFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('kidney_stone_followup_due')
    expect(codes).toContain('cystoscopy_followup_awaiting')
    expect(codes).toContain('psa_awaiting')
    expect(codes).toContain('urinalysis_pending')
    expect(codes).toContain('prostate_review_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'psa_awaiting')!.refType).toBe('psa')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildUroFollowUp([{ eventType: 'psa', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildUroFollowUp([]).reminders).toEqual([])
    expect(buildUroFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countUroImagingSignals', () => {
  it('counts urology investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Urinalysis', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'PSA' }] },
      { status: 'ordered', clinical_notes: 'Kidney ultrasound', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not a urology investigation
    ] as unknown as LabOrder[]
    const s = countUroImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + urology prompts) ───────
describe('computeUroCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 urology prompts', () => {
    const c = computeUroCompleteness({ chief_complaint: 'Flank pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'uro_doc_urinary_symptoms', 'uro_doc_voiding_history', 'uro_doc_stone_history', 'uro_doc_prostate_history',
      'uro_doc_hematuria', 'uro_doc_catheter_status', 'uro_doc_investigation_followup', 'uro_doc_procedure_history',
      'uro_doc_examination', 'uro_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildUroBrief', () => {
  it('reuses the GP brief and attaches urology counts', () => {
    const b = buildUroBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'prostate_review', status: 'scheduled' },
        { eventType: 'cystoscopy_followup', status: 'active' },
        { eventType: 'urinalysis', status: 'ordered' },
        { eventType: 'psa', status: 'awaiting_review' },
        { eventType: 'kidney_ultrasound', status: 'ordered' },
        { eventType: 'catheter_review', status: 'active' },
        { eventType: 'biopsy', status: 'ordered' },
        { eventType: 'hospital_discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.pendingLabs).toBe(2)         // urinalysis ordered + psa awaiting_review
    expect(b.summary.pendingImaging).toBe(1)      // kidney_ultrasound ordered
    expect(b.summary.pendingProcedures).toBe(2)   // biopsy ordered + cystoscopy_followup active
    expect(b.summary.catheterCare).toBe(1)        // catheter_review active
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('psa_awaiting')
  })
})

// ── Registry integration (urology.core) ────────────────────────────
describe('registry integration (urology.core)', () => {
  const pack = getCopilotPack('urology.core')!
  it('registers 8 urology templates that all resolve', () => {
    expect(URO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of URO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...URO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of URO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 urology documents + shared docs for a urology doctor', () => {
    for (const id of ['urology_referral', 'catheter_followup_summary', 'postop_urology_summary', 'urology_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'urology').map(d => d.id)
    expect(ids).toContain('urology_referral')
    expect(ids).toContain('catheter_followup_summary')
    expect(ids).toContain('gp_referral_letter')          // shared
    expect(ids).not.toContain('dermatology_referral')    // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / stone-prostate-bladder-infection classification / lab-US-CT-MRI-cystoscopy interpretation / med-antibiotic-surgery-catheter-dialysis recommendation / renal-cancer prediction / risk scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /malignan|carcinoma|gleason|pi-?rads|\bcancer\b|prognos|risk score/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no urologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.urologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no urologyCopilot i18n string contains classification / cancer / prognosis / risk-score wording', () => {
    for (const [k, v] of Object.entries(en.urologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no lab/US/CT/MRI/cystoscopy interpretation, no classification / scoring / prediction / recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'urology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no stone/prostate/bladder/infection classification, no risk/Gleason/PI-RADS scoring, no renal-outcome/cancer prediction, no medication/antibiotic/surgery/catheter/admission/discharge/dialysis recommendation.
    expect(code).not.toMatch(/interpretUrinalysis|interpretUltrasound|interpretCt|interpretMri|interpretCystoscopy|classifyStone|classifyProstate|classifyBladder|classifyUti|classifyInfection|recommendMedication|recommendAntibiotic|recommendSurgery|recommendCatheter|recommendAdmission|recommendDischarge|recommendDialysis|predictRenal|predictCancer|riskScore|gleasonScore|piradsScore/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useUrology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'UrologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '063_urology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.urologyCopilot).sort()).toEqual(Object.keys(en.urologyCopilot).sort())
  })
})

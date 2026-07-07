import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isNephrologyContext, categoryOf, isNephroEventType, buildNephroTracker, buildTestTracker,
  buildNephroFollowUp, countNephroLabSignals, computeNephroCompleteness, buildNephroBrief,
  NEPHRO_COPILOT_PACK_ID, NEPHRO_SPECIALTIES, NEPHRO_ALL_TYPES, NEPHRO_EVENT_STATUSES,
  NEPHRO_EVENT_TYPES, NEPHRO_TEST_TYPES, type NephroEvent,
} from '../nephrology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, NEPHRO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a nephrology doctor; no leakage', () => {
    expect(isNephrologyContext('doctor', 'nephrology')).toBe(true)
    expect(isNephrologyContext('doctor', 'internal_medicine')).toBe(false)
    expect(isNephrologyContext('doctor', 'pulmonology')).toBe(false)
    expect(isNephrologyContext('doctor', 'cardiology')).toBe(false)
    expect(isNephrologyContext('doctor', 'general_practice')).toBe(false)
    expect(isNephrologyContext('nurse', 'nephrology')).toBe(false)
    expect(isNephrologyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(NEPHRO_COPILOT_PACK_ID).toBe('nephrology.core')
    expect(getCopilotPack('nephrology.core')!.supportedSpecialties).toEqual([...NEPHRO_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('nephrology_consultation')).toBe('event')
    expect(categoryOf('dialysis_session')).toBe('event')
    expect(categoryOf('transplant_review')).toBe('event')
    expect(categoryOf('creatinine')).toBe('test')
    expect(categoryOf('egfr')).toBe('test')
    expect(categoryOf('kidney_biopsy')).toBe('test')
    expect(categoryOf('renal_ultrasound')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isNephroEventType('creatinine')).toBe(true)
    expect(isNephroEventType('nope')).toBe(false)
    expect(NEPHRO_EVENT_TYPES.length).toBe(8)
    expect(NEPHRO_TEST_TYPES.length).toBe(10)
    expect(NEPHRO_ALL_TYPES.length).toBe(18)
    expect(NEPHRO_EVENT_STATUSES).toContain('awaiting_review')
    expect(NEPHRO_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only — never interpret) ──────────────────
describe('buildNephroTracker', () => {
  const events: NephroEvent[] = [
    { eventType: 'dialysis_review', status: 'follow_up_due' },
    { eventType: 'dialysis_review', status: 'planned' },
    { eventType: 'nutrition_referral', status: 'completed' },   // closed → not open
    { eventType: 'transplant_review', status: 'awaiting_review' },
  ]
  it('counts each event type by status', () => {
    const rows = buildNephroTracker(events)
    const dr = rows.find(r => r.eventType === 'dialysis_review')!
    expect(dr.followUpDue).toBe(1)
    expect(dr.planned).toBe(1)
    expect(dr.total).toBe(2)
    const nr = rows.find(r => r.eventType === 'nutrition_referral')!
    expect(nr.completed).toBe(1)
    expect(nr.total).toBe(0)
    expect(rows.find(r => r.eventType === 'transplant_review')!.awaitingReview).toBe(1)
  })
})

// ── Laboratory / imaging workflow (counts only — never interpret) ──
describe('buildTestTracker', () => {
  it('counts labs/imaging by status', () => {
    const rows = buildTestTracker([
      { eventType: 'creatinine', status: 'awaiting_review' },
      { eventType: 'creatinine', status: 'ordered' },
      { eventType: 'kidney_biopsy', status: 'reviewed' },  // closed → not open
      { eventType: 'renal_ultrasound', status: 'completed' },
    ])
    const cr = rows.find(r => r.testType === 'creatinine')!
    expect(cr.awaitingReview).toBe(1)
    expect(cr.ordered).toBe(1)
    expect(cr.total).toBe(2)
    expect(rows.find(r => r.testType === 'kidney_biopsy')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'renal_ultrasound')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildNephroFollowUp', () => {
  const events: NephroEvent[] = [
    { eventType: 'dialysis_review', status: 'follow_up_due' },
    { eventType: 'transplant_review', status: 'awaiting_review' },
    { eventType: 'creatinine', status: 'awaiting_review' },
    { eventType: 'renal_ultrasound', status: 'ordered' },
    { eventType: 'nutrition_referral', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildNephroFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('dialysis_review_due')
    expect(codes).toContain('transplant_review_awaiting')
    expect(codes).toContain('creatinine_awaiting')
    expect(codes).toContain('renal_ultrasound_pending')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'creatinine_awaiting')!.refType).toBe('creatinine')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildNephroFollowUp([{ eventType: 'creatinine', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildNephroFollowUp([]).reminders).toEqual([])
    expect(buildNephroFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Lab signals (counts only — never interpret) ────────────────────
describe('countNephroLabSignals', () => {
  it('counts renal investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Creatinine + eGFR', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Urinalysis' }] },
      { status: 'ordered', clinical_notes: 'Renal ultrasound', items: [] },
      { status: 'ordered', clinical_notes: 'Chest X-ray', items: [] }, // not renal
    ] as unknown as LabOrder[]
    const s = countNephroLabSignals(orders)
    expect(s.renal).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + nephrology prompts) ────
describe('computeNephroCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 nephrology prompts', () => {
    const c = computeNephroCompleteness({ chief_complaint: 'Swelling', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'nephro_doc_renal_history', 'nephro_doc_dialysis_history', 'nephro_doc_transplant_history',
      'nephro_doc_urinary_symptoms', 'nephro_doc_blood_pressure', 'nephro_doc_fluid_status',
      'nephro_doc_nutrition', 'nephro_doc_lab_followup', 'nephro_doc_imaging', 'nephro_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildNephroBrief', () => {
  it('reuses the GP brief and attaches nephrology + lab counts', () => {
    const b = buildNephroBrief({
      now: new Date(), activePrescriptions: 3, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'dialysis_session', status: 'active' }, { eventType: 'creatinine', status: 'ordered' }, { eventType: 'kidney_biopsy', status: 'awaiting_review' }, { eventType: 'transplant_review', status: 'follow_up_due' }, { eventType: 'nutrition_referral', status: 'planned' }],
      labSignals: { pending: 1, completed: 0, renal: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.dialysis).toBe(1)          // dialysis_session active
    expect(b.summary.pendingLabs).toBe(1)        // creatinine ordered
    expect(b.summary.biopsy).toBe(1)             // awaiting_review is open
    expect(b.summary.transplant).toBe(1)
    expect(b.summary.nutritionReferral).toBe(1)
    expect(b.summary.medications).toBe(3)
    expect(b.followUp.reminders.map(r => r.code)).toContain('kidney_biopsy_awaiting')
  })
})

// ── Registry integration (nephrology.core) ─────────────────────────
describe('registry integration (nephrology.core)', () => {
  const pack = getCopilotPack('nephrology.core')!
  it('registers 8 nephrology templates that all resolve', () => {
    expect(NEPHRO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of NEPHRO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...NEPHRO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of NEPHRO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 nephrology documents + shared docs for a nephrology doctor', () => {
    for (const id of ['nephrology_referral', 'dialysis_summary', 'kidney_biopsy_summary', 'transplant_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'nephrology').map(d => d.id)
    expect(ids).toContain('nephrology_referral')
    expect(ids).toContain('dialysis_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('pulmonology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / CKD-AKI classification / lab interpretation / dialysis-transplant-medication recommendation / renal-failure prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no nephrologyCopilot i18n string contains diagnosis/treatment/disease wording', () => {
    for (const [k, v] of Object.entries(en.nephrologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no lab interpretation, no CKD/AKI classification / renal-failure prediction', () => {
    const src = readFileSync(join(__dirname, '..', 'nephrology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No lab interpretation, no CKD/AKI/nephrotic classification, no diagnosis, no renal-failure prediction, no dialysis/transplant recommendation.
    expect(code).not.toMatch(/interpretLab|classifyCkd|ckdStage|gfrStage|akiStage|classifyAki|nephroticSyndrome|predictRenalFailure|dialysisRecommend|recommendDialysis|recommendTransplant|diagnos/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useNephrology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'NephrologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '057_nephrology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.nephrologyCopilot).sort()).toEqual(Object.keys(en.nephrologyCopilot).sort())
  })
})

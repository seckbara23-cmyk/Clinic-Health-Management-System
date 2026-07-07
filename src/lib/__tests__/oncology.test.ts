import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isOncologyContext, categoryOf, isOncoEventType, buildOncoTracker, buildTestTracker,
  buildOncoFollowUp, countOncoImagingSignals, computeOncoCompleteness, buildOncoBrief,
  ONCO_COPILOT_PACK_ID, ONCO_SPECIALTIES, ONCO_ALL_TYPES, ONCO_EVENT_STATUSES,
  ONCO_EVENT_TYPES, ONCO_TEST_TYPES, type OncoEvent,
} from '../oncology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, ONCO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an oncology doctor; no leakage', () => {
    expect(isOncologyContext('doctor', 'oncology')).toBe(true)
    expect(isOncologyContext('doctor', 'internal_medicine')).toBe(false)
    expect(isOncologyContext('doctor', 'nephrology')).toBe(false)
    expect(isOncologyContext('doctor', 'general_practice')).toBe(false)
    expect(isOncologyContext('nurse', 'oncology')).toBe(false)
    expect(isOncologyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(ONCO_COPILOT_PACK_ID).toBe('oncology.core')
    expect(getCopilotPack('oncology.core')!.supportedSpecialties).toEqual([...ONCO_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('oncology_consultation')).toBe('event')
    expect(categoryOf('chemotherapy_cycle')).toBe('event')
    expect(categoryOf('tumor_board_review')).toBe('event')
    expect(categoryOf('pathology')).toBe('test')
    expect(categoryOf('biopsy')).toBe('test')
    expect(categoryOf('pet')).toBe('test')
    expect(categoryOf('bone_scan')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isOncoEventType('pathology')).toBe(true)
    expect(isOncoEventType('nope')).toBe(false)
    expect(ONCO_EVENT_TYPES.length).toBe(10)
    expect(ONCO_TEST_TYPES.length).toBe(8)
    expect(ONCO_ALL_TYPES.length).toBe(18)
    expect(ONCO_EVENT_STATUSES).toContain('awaiting_review')
    expect(ONCO_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only — never interpret) ──────────────────
describe('buildOncoTracker', () => {
  const events: OncoEvent[] = [
    { eventType: 'chemotherapy_cycle', status: 'follow_up_due' },
    { eventType: 'chemotherapy_cycle', status: 'planned' },
    { eventType: 'survivorship_visit', status: 'completed' },   // closed → not open
    { eventType: 'tumor_board_review', status: 'awaiting_review' },
  ]
  it('counts each event type by status', () => {
    const rows = buildOncoTracker(events)
    const chemo = rows.find(r => r.eventType === 'chemotherapy_cycle')!
    expect(chemo.followUpDue).toBe(1)
    expect(chemo.planned).toBe(1)
    expect(chemo.total).toBe(2)
    const sv = rows.find(r => r.eventType === 'survivorship_visit')!
    expect(sv.completed).toBe(1)
    expect(sv.total).toBe(0)
    expect(rows.find(r => r.eventType === 'tumor_board_review')!.awaitingReview).toBe(1)
  })
})

// ── Pathology / imaging workflow (counts only — never interpret) ───
describe('buildTestTracker', () => {
  it('counts pathology/imaging by status', () => {
    const rows = buildTestTracker([
      { eventType: 'pathology', status: 'awaiting_review' },
      { eventType: 'pathology', status: 'ordered' },
      { eventType: 'biopsy', status: 'reviewed' },  // closed → not open
      { eventType: 'pet', status: 'completed' },
    ])
    const pa = rows.find(r => r.testType === 'pathology')!
    expect(pa.awaitingReview).toBe(1)
    expect(pa.ordered).toBe(1)
    expect(pa.total).toBe(2)
    expect(rows.find(r => r.testType === 'biopsy')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'pet')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildOncoFollowUp', () => {
  const events: OncoEvent[] = [
    { eventType: 'chemotherapy_cycle', status: 'follow_up_due' },
    { eventType: 'tumor_board_review', status: 'awaiting_review' },
    { eventType: 'pathology', status: 'awaiting_review' },
    { eventType: 'pet', status: 'ordered' },
    { eventType: 'survivorship_visit', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildOncoFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('chemotherapy_cycle_due')
    expect(codes).toContain('tumor_board_review_awaiting')
    expect(codes).toContain('pathology_awaiting')
    expect(codes).toContain('pet_pending')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'pathology_awaiting')!.refType).toBe('pathology')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildOncoFollowUp([{ eventType: 'pathology', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildOncoFollowUp([]).reminders).toEqual([])
    expect(buildOncoFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Imaging signals (counts only — never interpret) ────────────────
describe('countOncoImagingSignals', () => {
  it('counts oncology investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Histopathology report', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'PET-CT' }] },
      { status: 'ordered', clinical_notes: 'Bone scan', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not an oncology investigation
    ] as unknown as LabOrder[]
    const s = countOncoImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + oncology prompts) ──────
describe('computeOncoCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 oncology prompts', () => {
    const c = computeOncoCompleteness({ chief_complaint: 'Fatigue', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'onco_doc_history', 'onco_doc_previous_treatment', 'onco_doc_treatment_timeline', 'onco_doc_performance_status',
      'onco_doc_symptom_review', 'onco_doc_tolerance', 'onco_doc_pathology_followup', 'onco_doc_imaging_followup',
      'onco_doc_mdt', 'onco_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildOncoBrief', () => {
  it('reuses the GP brief and attaches cancer-care counts', () => {
    const b = buildOncoBrief({
      now: new Date(), activePrescriptions: 4, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'chemotherapy_cycle', status: 'active' }, { eventType: 'pathology', status: 'ordered' }, { eventType: 'pet', status: 'awaiting_review' }, { eventType: 'tumor_board_review', status: 'follow_up_due' }, { eventType: 'survivorship_visit', status: 'planned' }],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.chemoWorkflow).toBe(1)      // chemotherapy_cycle active
    expect(b.summary.pendingPathology).toBe(1)   // pathology ordered
    expect(b.summary.pendingImaging).toBe(1)     // pet awaiting_review is open
    expect(b.summary.mdt).toBe(1)
    expect(b.summary.survivorship).toBe(1)
    expect(b.summary.medications).toBe(4)
    expect(b.followUp.reminders.map(r => r.code)).toContain('pet_awaiting')
  })
})

// ── Registry integration (oncology.core) ───────────────────────────
describe('registry integration (oncology.core)', () => {
  const pack = getCopilotPack('oncology.core')!
  it('registers 8 oncology templates that all resolve', () => {
    expect(ONCO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of ONCO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...ONCO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of ONCO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 oncology documents + shared docs for an oncology doctor', () => {
    for (const id of ['oncology_referral', 'treatment_continuity_summary', 'tumor_board_summary', 'survivorship_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'oncology').map(d => d.id)
    expect(ids).toContain('oncology_referral')
    expect(ids).toContain('tumor_board_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('nephrology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / staging / TNM / grading / pathology-imaging interpretation / treatment-med recommendation / survival-recurrence prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /\b(staging|\bstage\b|\btnm\b|grading|\bgrade\b|metastas|prognos|survival|recurrence|remission)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no oncologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.oncologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no oncologyCopilot i18n string contains staging / TNM / prognosis / survival / recurrence wording', () => {
    for (const [k, v] of Object.entries(en.oncologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no pathology/imaging interpretation, no staging / TNM / prognosis / survival prediction', () => {
    const src = readFileSync(join(__dirname, '..', 'oncology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No pathology/imaging interpretation, no staging/grading/TNM, no diagnosis, no survival/recurrence/prognosis prediction, no chemo/radio recommendation.
    expect(code).not.toMatch(/interpretPatholog|interpretBiops|interpretImage|classifyCancer|cancerStage|tnmStage|tumorGrade|gradeCancer|metastasis|predictSurvival|survivalRate|recurrenceRisk|prognosis|recommendChemo|recommendRadio|recommendImmuno/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useOncology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'OncologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '058_oncology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.oncologyCopilot).sort()).toEqual(Object.keys(en.oncologyCopilot).sort())
  })
})

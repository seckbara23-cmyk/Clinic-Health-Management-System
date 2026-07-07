import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isDermatologyContext, categoryOf, isDermEventType, buildDermTracker, buildTestTracker,
  buildDermFollowUp, countDermImagingSignals, computeDermCompleteness, buildDermBrief,
  DERM_COPILOT_PACK_ID, DERM_SPECIALTIES, DERM_ALL_TYPES, DERM_EVENT_STATUSES,
  DERM_EVENT_TYPES, DERM_TEST_TYPES, type DermEvent,
} from '../dermatology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, DERM_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a dermatology doctor; no leakage', () => {
    expect(isDermatologyContext('doctor', 'dermatology')).toBe(true)
    expect(isDermatologyContext('doctor', 'oncology')).toBe(false)
    expect(isDermatologyContext('doctor', 'endocrinology')).toBe(false)
    expect(isDermatologyContext('doctor', 'general_surgery')).toBe(false)
    expect(isDermatologyContext('doctor', 'general_practice')).toBe(false)
    expect(isDermatologyContext('nurse', 'dermatology')).toBe(false)
    expect(isDermatologyContext('doctor', null)).toBe(false)
  })
  it('dermatology is a registered clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('dermatology')).toBe(true)
  })
  it('pack id + specialties match the manifest', () => {
    expect(DERM_COPILOT_PACK_ID).toBe('dermatology.core')
    expect(getCopilotPack('dermatology.core')!.supportedSpecialties).toEqual([...DERM_SPECIALTIES])
  })
})

// ── Event vocabulary (patch_testing event ≠ patch_test investigation) ─
describe('event vocabulary', () => {
  it('maps event types to the right category with no event/test collision', () => {
    expect(categoryOf('dermatology_consultation')).toBe('event')
    expect(categoryOf('skin_lesion_followup')).toBe('event')
    expect(categoryOf('histopathology_review')).toBe('event')
    expect(categoryOf('patch_testing')).toBe('event')   // workflow event
    expect(categoryOf('skin_biopsy')).toBe('test')
    expect(categoryOf('histopathology')).toBe('test')
    expect(categoryOf('patch_test')).toBe('test')        // investigation (distinct id)
    expect(categoryOf('nonsense')).toBeNull()
    expect(isDermEventType('skin_biopsy')).toBe(true)
    expect(isDermEventType('nope')).toBe(false)
    expect(DERM_EVENT_TYPES.length).toBe(15)
    expect(DERM_TEST_TYPES.length).toBe(7)
    expect(DERM_ALL_TYPES.length).toBe(22)
    expect(new Set(DERM_ALL_TYPES).size).toBe(22)        // no duplicate ids across tracks
    expect(DERM_EVENT_STATUSES).toContain('scheduled')
    expect(DERM_EVENT_STATUSES).toContain('awaiting_review')
    expect(DERM_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only) ────────────────────────────────────
describe('buildDermTracker', () => {
  const events: DermEvent[] = [
    { eventType: 'skin_lesion_followup', status: 'follow_up_due' },
    { eventType: 'skin_lesion_followup', status: 'planned' },
    { eventType: 'hospital_discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'histopathology_review', status: 'awaiting_review' },
    { eventType: 'mole_followup', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildDermTracker(events)
    const lesion = rows.find(r => r.eventType === 'skin_lesion_followup')!
    expect(lesion.followUpDue).toBe(1)
    expect(lesion.planned).toBe(1)
    expect(lesion.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'hospital_discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'histopathology_review')!.awaitingReview).toBe(1)
    const mole = rows.find(r => r.eventType === 'mole_followup')!
    expect(mole.scheduled).toBe(1)
    expect(mole.total).toBe(1)
  })
})

// ── Investigation / pathology workflow (counts only) ───────────────
describe('buildTestTracker (investigation + pathology workflow)', () => {
  it('counts investigations and pathology tests by status', () => {
    const rows = buildTestTracker([
      { eventType: 'skin_biopsy', status: 'awaiting_review' },   // pathology
      { eventType: 'skin_biopsy', status: 'ordered' },
      { eventType: 'dermoscopy', status: 'reviewed' },           // closed → not open
      { eventType: 'histopathology', status: 'completed' },      // pathology
      { eventType: 'patch_test', status: 'ordered' },            // investigation
    ])
    const biopsy = rows.find(r => r.testType === 'skin_biopsy')!
    expect(biopsy.awaitingReview).toBe(1)
    expect(biopsy.ordered).toBe(1)
    expect(biopsy.total).toBe(2)
    expect(rows.find(r => r.testType === 'dermoscopy')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'histopathology')!.total).toBe(1)
    expect(rows.find(r => r.testType === 'patch_test')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildDermFollowUp', () => {
  const events: DermEvent[] = [
    { eventType: 'skin_biopsy_followup', status: 'follow_up_due' },
    { eventType: 'histopathology_review', status: 'awaiting_review' },
    { eventType: 'skin_biopsy', status: 'awaiting_review' },
    { eventType: 'dermoscopy', status: 'ordered' },
    { eventType: 'mole_followup', status: 'scheduled' },
    { eventType: 'hospital_discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildDermFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('skin_biopsy_followup_due')
    expect(codes).toContain('histopathology_review_awaiting')
    expect(codes).toContain('skin_biopsy_awaiting')
    expect(codes).toContain('dermoscopy_pending')
    expect(codes).toContain('mole_followup_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'skin_biopsy_awaiting')!.refType).toBe('skin_biopsy')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildDermFollowUp([{ eventType: 'skin_biopsy', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildDermFollowUp([]).reminders).toEqual([])
    expect(buildDermFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countDermImagingSignals', () => {
  it('counts dermatology investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Skin biopsy', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Histopathology' }] },
      { status: 'ordered', clinical_notes: 'Dermoscopy', items: [] },
      { status: 'ordered', clinical_notes: 'Chest X-ray', items: [] }, // not a dermatology investigation
    ] as unknown as LabOrder[]
    const s = countDermImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + dermatology prompts) ───
describe('computeDermCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 dermatology prompts', () => {
    const c = computeDermCompleteness({ chief_complaint: 'Rash', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'derm_doc_skin_complaint', 'derm_doc_lesion_history', 'derm_doc_lesion_distribution', 'derm_doc_associated_symptoms',
      'derm_doc_previous_treatments', 'derm_doc_examination', 'derm_doc_procedure_performed', 'derm_doc_pathology_followup',
      'derm_doc_wound_care', 'derm_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildDermBrief', () => {
  it('reuses the GP brief and attaches dermatology counts', () => {
    const b = buildDermBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'mole_followup', status: 'scheduled' },
        { eventType: 'dermatologic_procedure_followup', status: 'active' },
        { eventType: 'skin_biopsy', status: 'ordered' },
        { eventType: 'histopathology', status: 'awaiting_review' },
        { eventType: 'wound_review', status: 'active' },
        { eventType: 'phototherapy_review', status: 'active' },
        { eventType: 'patch_test', status: 'ordered' },
        { eventType: 'hospital_discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.pendingPathology).toBe(2)    // skin_biopsy ordered + histopathology awaiting_review
    expect(b.summary.pendingProcedures).toBe(1)
    expect(b.summary.woundCare).toBe(1)
    expect(b.summary.phototherapy).toBe(1)
    expect(b.summary.patchTesting).toBe(1)        // patch_test ordered
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('histopathology_awaiting')
  })
})

// ── Registry integration (dermatology.core) ────────────────────────
describe('registry integration (dermatology.core)', () => {
  const pack = getCopilotPack('dermatology.core')!
  it('registers 8 dermatology templates that all resolve', () => {
    expect(DERM_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of DERM_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...DERM_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of DERM_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 dermatology documents + shared docs for a dermatology doctor', () => {
    for (const id of ['dermatology_referral', 'dermatology_procedure_summary', 'skin_biopsy_followup_summary', 'dermatology_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'dermatology').map(d => d.id)
    expect(ids).toContain('dermatology_referral')
    expect(ids).toContain('skin_biopsy_followup_summary')
    expect(ids).toContain('gp_referral_letter')          // shared
    expect(ids).not.toContain('endocrinology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / melanoma-eczema-psoriasis-dermatitis classification / dermoscopy-pathology-biopsy interpretation / biopsy-surgery-med-topical recommendation / malignancy-recurrence prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /melanoma|eczema|psoriasis|dermatitis|malignan|recurrence|carcinoma/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no dermatologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.dermatologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no dermatologyCopilot i18n string contains lesion-classification / malignancy / recurrence wording', () => {
    for (const [k, v] of Object.entries(en.dermatologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no dermoscopy/pathology/biopsy interpretation, no classification / scoring / prediction / recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'dermatology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no melanoma/eczema/psoriasis/dermatitis classification, no melanoma scoring, no malignancy/recurrence prediction, no biopsy/surgery/medication/topical/antibiotic/antifungal recommendation.
    expect(code).not.toMatch(/diagnoseSkin|classifyMelanoma|classifyEczema|classifyPsoriasis|classifyDermatitis|interpretDermoscopy|interpretPatholog|interpretBiops|lesionType|melanomaScore|recommendBiopsy|recommendSurgery|recommendMedication|recommendTopical|recommendAntibiotic|recommendAntifungal|predictMalignan|predictRecurrence|abcdScore/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useDermatology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'DermatologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '062_dermatology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.dermatologyCopilot).sort()).toEqual(Object.keys(en.dermatologyCopilot).sort())
  })
})

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isRheumatologyContext, categoryOf, isRheumEventType, buildRheumTracker, buildTestTracker,
  buildRheumFollowUp, countRheumImagingSignals, computeRheumCompleteness, buildRheumBrief,
  RHEUM_COPILOT_PACK_ID, RHEUM_SPECIALTIES, RHEUM_ALL_TYPES, RHEUM_EVENT_STATUSES,
  RHEUM_EVENT_TYPES, RHEUM_TEST_TYPES, type RheumEvent,
} from '../rheumatology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, RHEUM_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a rheumatology doctor; no leakage', () => {
    expect(isRheumatologyContext('doctor', 'rheumatology')).toBe(true)
    expect(isRheumatologyContext('doctor', 'internal_medicine')).toBe(false)
    expect(isRheumatologyContext('doctor', 'orthopedics')).toBe(false)
    expect(isRheumatologyContext('doctor', 'infectious_diseases')).toBe(false)
    expect(isRheumatologyContext('doctor', 'general_practice')).toBe(false)
    expect(isRheumatologyContext('nurse', 'rheumatology')).toBe(false)
    expect(isRheumatologyContext('doctor', null)).toBe(false)
  })
  it('rheumatology is a registered clinical specialty', () => {
    expect(isRegisteredClinicalSpecialty('rheumatology')).toBe(true)
  })
  it('pack id + specialties match the manifest', () => {
    expect(RHEUM_COPILOT_PACK_ID).toBe('rheumatology.core')
    expect(getCopilotPack('rheumatology.core')!.supportedSpecialties).toEqual([...RHEUM_SPECIALTIES])
  })
})

// ── Event vocabulary (event ≠ investigation, no collision) ─────────
describe('event vocabulary', () => {
  it('maps event types to the right category with no event/test collision', () => {
    expect(categoryOf('rheumatology_consultation')).toBe('event')
    expect(categoryOf('joint_followup')).toBe('event')
    expect(categoryOf('joint_aspiration_followup')).toBe('event')  // workflow event
    expect(categoryOf('infusion_followup')).toBe('event')
    expect(categoryOf('ana')).toBe('test')
    expect(categoryOf('rheumatoid_factor')).toBe('test')
    expect(categoryOf('joint_aspiration')).toBe('test')            // investigation (distinct id)
    expect(categoryOf('bone_density')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isRheumEventType('ana')).toBe(true)
    expect(isRheumEventType('nope')).toBe(false)
    expect(RHEUM_EVENT_TYPES.length).toBe(11)
    expect(RHEUM_TEST_TYPES.length).toBe(12)
    expect(RHEUM_ALL_TYPES.length).toBe(23)
    expect(new Set(RHEUM_ALL_TYPES).size).toBe(23)                 // no duplicate ids across tracks
    expect(RHEUM_EVENT_STATUSES).toContain('scheduled')
    expect(RHEUM_EVENT_STATUSES).toContain('awaiting_review')
    expect(RHEUM_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only) ────────────────────────────────────
describe('buildRheumTracker', () => {
  const events: RheumEvent[] = [
    { eventType: 'joint_followup', status: 'follow_up_due' },
    { eventType: 'joint_followup', status: 'planned' },
    { eventType: 'hospital_discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'infusion_followup', status: 'awaiting_review' },
    { eventType: 'autoimmune_clinic_followup', status: 'scheduled' },
  ]
  it('counts each event type by status', () => {
    const rows = buildRheumTracker(events)
    const joint = rows.find(r => r.eventType === 'joint_followup')!
    expect(joint.followUpDue).toBe(1)
    expect(joint.planned).toBe(1)
    expect(joint.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'hospital_discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'infusion_followup')!.awaitingReview).toBe(1)
    const auto = rows.find(r => r.eventType === 'autoimmune_clinic_followup')!
    expect(auto.scheduled).toBe(1)
    expect(auto.total).toBe(1)
  })
})

// ── Investigation workflow (counts only) ───────────────────────────
describe('buildTestTracker (investigation workflow)', () => {
  it('counts investigations by status', () => {
    const rows = buildTestTracker([
      { eventType: 'ana', status: 'awaiting_review' },
      { eventType: 'ana', status: 'ordered' },
      { eventType: 'crp', status: 'reviewed' },  // closed → not open
      { eventType: 'joint_xray', status: 'completed' },
      { eventType: 'rheumatoid_factor', status: 'ordered' },
    ])
    const ana = rows.find(r => r.testType === 'ana')!
    expect(ana.awaitingReview).toBe(1)
    expect(ana.ordered).toBe(1)
    expect(ana.total).toBe(2)
    expect(rows.find(r => r.testType === 'crp')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'joint_xray')!.total).toBe(1)
    expect(rows.find(r => r.testType === 'rheumatoid_factor')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildRheumFollowUp', () => {
  const events: RheumEvent[] = [
    { eventType: 'joint_followup', status: 'follow_up_due' },
    { eventType: 'infusion_followup', status: 'awaiting_review' },
    { eventType: 'ana', status: 'awaiting_review' },
    { eventType: 'joint_xray', status: 'ordered' },
    { eventType: 'autoimmune_clinic_followup', status: 'scheduled' },
    { eventType: 'hospital_discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildRheumFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('joint_followup_due')
    expect(codes).toContain('infusion_followup_awaiting')
    expect(codes).toContain('ana_awaiting')
    expect(codes).toContain('joint_xray_pending')
    expect(codes).toContain('autoimmune_clinic_followup_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'ana_awaiting')!.refType).toBe('ana')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildRheumFollowUp([{ eventType: 'ana', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildRheumFollowUp([]).reminders).toEqual([])
    expect(buildRheumFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countRheumImagingSignals', () => {
  it('counts rheumatology investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'ANA', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Anti-CCP' }] },
      { status: 'ordered', clinical_notes: 'Joint X-ray', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not a rheumatology investigation
    ] as unknown as LabOrder[]
    const s = countRheumImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + rheumatology prompts) ──
describe('computeRheumCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 rheumatology prompts', () => {
    const c = computeRheumCompleteness({ chief_complaint: 'Joint pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'rheum_doc_joint_symptoms', 'rheum_doc_morning_stiffness', 'rheum_doc_functional_status', 'rheum_doc_autoimmune_history',
      'rheum_doc_medication_monitoring', 'rheum_doc_joint_examination', 'rheum_doc_imaging_followup', 'rheum_doc_laboratory_followup',
      'rheum_doc_rehabilitation_review', 'rheum_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildRheumBrief', () => {
  it('reuses the GP brief and attaches rheumatology counts', () => {
    const b = buildRheumBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'autoimmune_clinic_followup', status: 'scheduled' },
        { eventType: 'joint_aspiration_followup', status: 'active' },
        { eventType: 'ana', status: 'ordered' },
        { eventType: 'esr', status: 'awaiting_review' },
        { eventType: 'joint_xray', status: 'ordered' },
        { eventType: 'infusion_followup', status: 'active' },
        { eventType: 'physiotherapy_referral', status: 'active' },
        { eventType: 'hospital_discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.pendingSerology).toBe(2)     // ana ordered + esr awaiting_review
    expect(b.summary.pendingImaging).toBe(1)      // joint_xray ordered
    expect(b.summary.pendingAspiration).toBe(1)   // joint_aspiration_followup active
    expect(b.summary.infusionMonitoring).toBe(1)  // infusion_followup active
    expect(b.summary.rehab).toBe(1)               // physiotherapy_referral active
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('esr_awaiting')
  })
})

// ── Registry integration (rheumatology.core) ───────────────────────
describe('registry integration (rheumatology.core)', () => {
  const pack = getCopilotPack('rheumatology.core')!
  it('registers 8 rheumatology templates that all resolve', () => {
    expect(RHEUM_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of RHEUM_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...RHEUM_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of RHEUM_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 rheumatology documents + shared docs for a rheumatology doctor', () => {
    for (const id of ['rheumatology_referral', 'joint_followup_summary', 'infusion_followup_summary', 'rheumatology_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'rheumatology').map(d => d.id)
    expect(ids).toContain('rheumatology_referral')
    expect(ids).toContain('joint_followup_summary')
    expect(ids).toContain('gp_referral_letter')                // shared
    expect(ids).not.toContain('infectious_disease_referral')   // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / disease classification / lab-aspiration-imaging interpretation / DMARD-biologic-steroid-NSAID-surgery recommendation / disability-progression prediction / DAS28-SLEDAI-BASDAI-CDAI scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /das28|sledai|basdai|\bcdai\b|rheumatoid arthritis|\blupus\b|\bgout\b|vasculitis|ankylosing|spondylitis|connective tissue|progression|disability|seropositive|seronegative/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no rheumatologyCopilot i18n string contains diagnosis/treatment/disease wording', () => {
    for (const [k, v] of Object.entries(en.rheumatologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no rheumatologyCopilot i18n string contains disease-classification / scoring / disability / progression wording', () => {
    for (const [k, v] of Object.entries(en.rheumatologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no serology/aspiration/imaging interpretation, no classification / prediction / recommendation / scoring', () => {
    const src = readFileSync(join(__dirname, '..', 'rheumatology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no RA/lupus/gout/vasculitis classification, no DAS28/SLEDAI/BASDAI/CDAI scoring, no disability/progression prediction, no DMARD/biologic/steroid/NSAID/surgery/injection recommendation.
    expect(code).not.toMatch(/interpretAna|interpretRf|interpretCcp|interpretEsr|interpretCrp|interpretHla|interpretAspiration|interpretXray|interpretUltrasound|interpretMri|classifyRa|classifyLupus|classifyGout|classifyVasculitis|diagnoseRheum|recommendDmard|recommendBiologic|recommendSteroid|recommendNsaid|recommendSurgery|recommendInjection|predictDisability|predictProgression|das28|sledai|basdai|cdai/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useRheumatology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'RheumatologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '066_rheumatology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.rheumatologyCopilot).sort()).toEqual(Object.keys(en.rheumatologyCopilot).sort())
  })
})

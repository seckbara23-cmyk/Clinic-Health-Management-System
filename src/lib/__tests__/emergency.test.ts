import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isEmergencyContext, categoryOf, isEmergencyEventType, buildPendingResults, buildObservationTracker,
  buildProcedureTracker, buildEmergencyFollowUp, countEmergencyLabSignals, computeEmergencyCompleteness,
  buildEmergencyBrief, EMERGENCY_COPILOT_PACK_ID, EMERGENCY_SPECIALTIES, EMERGENCY_EVENT_TYPES,
  EMERGENCY_EVENT_STATUSES, EMERGENCY_RESULT_TYPES, EMERGENCY_PROCEDURE_TYPES, type EmergencyEvent,
} from '../emergency/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, EMERGENCY_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an emergency-medicine doctor; no leakage', () => {
    expect(isEmergencyContext('doctor', 'emergency_medicine')).toBe(true)
    expect(isEmergencyContext('doctor', 'emergency_physician')).toBe(true) // future id
    expect(isEmergencyContext('doctor', 'cardiology')).toBe(false)
    expect(isEmergencyContext('doctor', 'general_practice')).toBe(false)
    expect(isEmergencyContext('doctor', 'ent')).toBe(false)
    expect(isEmergencyContext('nurse', 'emergency_medicine')).toBe(false)
    expect(isEmergencyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(EMERGENCY_COPILOT_PACK_ID).toBe('emergency.core')
    expect(getCopilotPack('emergency.core')!.supportedSpecialties).toEqual([...EMERGENCY_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('lab')).toBe('result')
    expect(categoryOf('ct')).toBe('result')
    expect(categoryOf('consult')).toBe('result')
    expect(categoryOf('suturing')).toBe('procedure')
    expect(categoryOf('cpr')).toBe('procedure')
    expect(categoryOf('observation')).toBe('observation')
    expect(categoryOf('admission')).toBe('disposition')
    expect(categoryOf('arrival')).toBe('flow')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isEmergencyEventType('lab')).toBe(true)
    expect(isEmergencyEventType('nope')).toBe(false)
    expect(EMERGENCY_RESULT_TYPES.length).toBe(7)
    expect(EMERGENCY_PROCEDURE_TYPES.length).toBe(8)
    expect(EMERGENCY_EVENT_TYPES.length).toBe(23)
    expect(EMERGENCY_EVENT_STATUSES).toContain('awaiting_review')
    expect(EMERGENCY_EVENT_STATUSES).toContain('ongoing')
  })
})

// ── Pending results tracker (counts only — never interpret) ────────
describe('buildPendingResults', () => {
  const events: EmergencyEvent[] = [
    { eventType: 'lab', status: 'awaiting_review' },
    { eventType: 'lab', status: 'ordered' },
    { eventType: 'ecg', status: 'reviewed' },     // closed → not open
    { eventType: 'ct', status: 'completed' },
  ]
  it('counts each result type by status', () => {
    const rows = buildPendingResults(events)
    const lab = rows.find(r => r.resultType === 'lab')!
    expect(lab.awaitingReview).toBe(1)
    expect(lab.ordered).toBe(1)
    expect(lab.total).toBe(2)
    const ecg = rows.find(r => r.resultType === 'ecg')!
    expect(ecg.total).toBe(0)      // reviewed → closed
    const ct = rows.find(r => r.resultType === 'ct')!
    expect(ct.total).toBe(1)       // completed = open
  })
})

// ── Observation tracker (registry only — never recommend) ──────────
describe('buildObservationTracker', () => {
  it('counts observation states and dispositions', () => {
    const o = buildObservationTracker([
      { eventType: 'observation', status: 'ongoing' },
      { eventType: 'observation', status: 'completed' },
      { eventType: 'admission', status: 'done' },
      { eventType: 'discharge', status: 'done' },
      { eventType: 'transfer', status: 'done' },
    ])
    expect(o.ongoing).toBe(1)
    expect(o.completed).toBe(1)
    expect(o.admissions).toBe(1)
    expect(o.discharges).toBe(1)
    expect(o.transfers).toBe(1)
  })
})

// ── Procedure tracker (registry only — never recommend) ────────────
describe('buildProcedureTracker', () => {
  it('counts procedures by status', () => {
    const rows = buildProcedureTracker([
      { eventType: 'suturing', status: 'performed' },
      { eventType: 'suturing', status: 'follow_up' },
      { eventType: 'chest_tube', status: 'planned' },
    ])
    const sut = rows.find(r => r.procedureType === 'suturing')!
    expect(sut.performed).toBe(1)
    expect(sut.followUp).toBe(1)
    expect(sut.total).toBe(2)
    expect(rows.find(r => r.procedureType === 'chest_tube')!.planned).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildEmergencyFollowUp', () => {
  const events: EmergencyEvent[] = [
    { eventType: 'lab', status: 'awaiting_review' },
    { eventType: 'imaging', status: 'ordered' },
    { eventType: 'consult', status: 'ordered' },
    { eventType: 'observation', status: 'ongoing' },
    { eventType: 'suturing', status: 'follow_up' },
    { eventType: 'arrival', status: 'done' },
    { eventType: 'arrival', status: 'done' }, // 2 arrivals → return visit
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildEmergencyFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('lab_awaiting')
    expect(codes).toContain('imaging_outstanding')
    expect(codes).toContain('consult_pending')
    expect(codes).toContain('observation_due')
    expect(codes).toContain('procedure_followup')
    expect(codes).toContain('return_visit')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'lab_awaiting')!.resultType).toBe('lab')
  })
  it('closed/empty input raises no reminders', () => {
    expect(buildEmergencyFollowUp([{ eventType: 'lab', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildEmergencyFollowUp([]).reminders).toEqual([])
    expect(buildEmergencyFollowUp([{ eventType: 'bogus', status: 'ordered' }]).reminders).toEqual([])
  })
})

// ── Lab signals (counts only — never classify) ─────────────────────
describe('countEmergencyLabSignals', () => {
  it('counts pending / completed / imaging without interpreting', () => {
    const orders = [
      { status: 'ordered', clinical_notes: 'CBC', items: [] },
      { status: 'completed', clinical_notes: 'CT head', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Chest X-ray' }] },
      { status: 'cancelled', clinical_notes: 'x', items: [] },
    ] as unknown as LabOrder[]
    const s = countEmergencyLabSignals(orders)
    expect(s.pending).toBe(2)      // CBC + X-ray (cancelled excluded)
    expect(s.completed).toBe(1)
    expect(s.imaging).toBe(2)      // CT + X-ray
  })
})

// ── Documentation completeness (reuses GP + emergency prompts) ─────
describe('computeEmergencyCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 emergency prompts', () => {
    const c = computeEmergencyCompleteness({ chief_complaint: 'Chest pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'em_doc_chief_complaint', 'em_doc_mechanism', 'em_doc_onset', 'em_doc_associated',
      'em_doc_pmh', 'em_doc_meds', 'em_doc_allergies', 'em_doc_focused_exam',
      'em_doc_interventions', 'em_doc_disposition',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildEmergencyBrief', () => {
  it('reuses the GP brief and attaches emergency counts', () => {
    const b = buildEmergencyBrief({
      now: new Date(), activePrescriptions: 3, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 0, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'lab', status: 'ordered' }, { eventType: 'ct', status: 'ordered' }, { eventType: 'suturing', status: 'planned' }, { eventType: 'admission', status: 'done' }],
      labSignals: { pending: 1, completed: 0, imaging: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.emergency.pendingLabs).toBe(1)
    expect(b.emergency.pendingImaging).toBe(1)   // ct
    expect(b.emergency.pendingProcedures).toBe(1)
    expect(b.emergency.admissions).toBe(1)
    expect(b.emergency.medications).toBe(3)
  })
})

// ── Registry integration (emergency.core) ──────────────────────────
describe('registry integration (emergency.core)', () => {
  const pack = getCopilotPack('emergency.core')!
  it('registers 8 emergency templates that all resolve', () => {
    expect(EMERGENCY_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of EMERGENCY_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...EMERGENCY_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of EMERGENCY_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 3 emergency documents + shared referral/certificate for an EM doctor', () => {
    for (const id of ['emergency_summary', 'transfer_summary', 'observation_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'emergency_medicine').map(d => d.id)
    expect(ids).toContain('emergency_summary')
    expect(ids).toContain('transfer_summary')
    expect(ids).toContain('observation_summary')
    expect(ids).toContain('gp_referral_letter')        // shared referral letter
    expect(ids).toContain('gp_medical_certificate')    // shared medical certificate
    expect(ids).not.toContain('cardiology_referral')   // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / triage / treatment / disposition / procedure recommendation / risk scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no emergencyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.emergencyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no interpretation, no triage/scoring/prediction', () => {
    const src = readFileSync(join(__dirname, '..', 'emergency', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/triageLevel|assignTriage|esiLevel|newsScore|news2|glasgow|qsofa|recommendAdmission|recommendDischarge|recommendAntibiotic|thrombolys|predictDeterioration|mortality|recommendIntubation/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useEmergency.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'EmergencyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '051_emergency_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.emergencyCopilot).sort()).toEqual(Object.keys(en.emergencyCopilot).sort())
  })
})

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isOrlContext, categoryOf, isOrlEventType, buildOrlFollowUp, countOrlLabSignals,
  computeOrlCompleteness, buildOrlBrief, ORL_COPILOT_PACK_ID, ORL_SPECIALTIES,
  ORL_EVENT_TYPES, ORL_EVENT_STATUSES, type OrlEvent,
} from '../orl/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, ORL_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import type { LabOrder } from '@/types/database'

// ── Activation ──────────────────────────────────────────────────────
describe('activation', () => {
  it('active only for an ORL/ENT doctor; no leakage', () => {
    expect(isOrlContext('doctor', 'ent')).toBe(true)
    expect(isOrlContext('doctor', 'general_practice')).toBe(false)
    expect(isOrlContext('doctor', 'pediatrics')).toBe(false)
    expect(isOrlContext('doctor', 'obgyn')).toBe(false)
    expect(isOrlContext('nurse', 'ent')).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(ORL_COPILOT_PACK_ID).toBe('ent.core')
    expect(getCopilotPack('ent.core')!.supportedSpecialties).toEqual([...ORL_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('audiometry')).toBe('audiology')
    expect(categoryOf('nasal_endoscopy')).toBe('endoscopy')
    expect(categoryOf('ct_sinus')).toBe('imaging')
    expect(categoryOf('biopsy')).toBe('pathology')
    expect(categoryOf('post_op_visit')).toBe('post_op')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isOrlEventType('audiometry')).toBe(true)
    expect(isOrlEventType('nope')).toBe(false)
    expect(ORL_EVENT_TYPES.length).toBe(12)
    expect(ORL_EVENT_STATUSES).toContain('awaiting_review')
  })
})

// ── Follow-up (surface only — never interpret) ─────────────────────
describe('buildOrlFollowUp', () => {
  const events: OrlEvent[] = [
    { eventType: 'audiometry', status: 'awaiting_review' },
    { eventType: 'ct_sinus', status: 'awaiting_review' },
    { eventType: 'biopsy', status: 'ordered' },
    { eventType: 'post_op_visit', status: 'due' },
    { eventType: 'laryngoscopy', status: 'reviewed' }, // closed → not counted as open
  ]
  it('summarises categories by status and raises operational reminders', () => {
    const f = buildOrlFollowUp(events)
    const audiology = f.categories.find(c => c.category === 'audiology')!
    expect(audiology.awaitingReview).toBe(1)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('audiology_awaiting')
    expect(codes).toContain('imaging_awaiting')
    expect(codes).toContain('pathology_ordered')
    expect(codes).toContain('post_op_due')
    expect(f.reminders[0].severity).toBe('warning') // warnings first
  })
  it('reviewed/done/cancelled do not count as open', () => {
    const f = buildOrlFollowUp([{ eventType: 'laryngoscopy', status: 'reviewed' }, { eventType: 'audiometry', status: 'cancelled' }])
    expect(f.categories.every(c => c.total === 0)).toBe(true)
    expect(f.reminders).toEqual([])
  })
  it('empty / bad input → no reminders', () => {
    expect(buildOrlFollowUp([]).reminders).toEqual([])
    expect(buildOrlFollowUp([{ eventType: 'bogus', status: 'ordered' }]).categories.every(c => c.total === 0)).toBe(true)
  })
})

// ── Supplementary lab signals (counts only, no interpretation) ─────
describe('countOrlLabSignals', () => {
  it('counts imaging / pathology / audiology by test-name heuristic', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'CT sinus', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'Biopsy of nasal mass' }] },
      { status: 'ordered', clinical_notes: 'Audiometry', items: [] },
      { status: 'completed', clinical_notes: 'CBC', items: [{ test_name: 'Hemoglobin' }] },
    ] as unknown as LabOrder[]
    const s = countOrlLabSignals(orders)
    expect(s.imaging).toBe(1)
    expect(s.pathology).toBe(1)
    expect(s.audiology).toBe(1)
    expect(s.awaitingReview).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + ORL prompts) ───────────
describe('computeOrlCompleteness', () => {
  it('reuses GP SOAP score and adds the 7 ORL prompts', () => {
    const c = computeOrlCompleteness({ chief_complaint: 'Ear pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'orl_doc_ear_history', 'orl_doc_nose_history', 'orl_doc_throat_history',
      'orl_doc_otoscopy', 'orl_doc_nasal_exam', 'orl_doc_throat_exam', 'orl_doc_neck_exam',
    ]))
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildOrlBrief', () => {
  it('reuses the GP brief and attaches ORL follow-up + lab signals', () => {
    const fu = buildOrlFollowUp([{ eventType: 'audiometry', status: 'awaiting_review' }])
    const b = buildOrlBrief({
      now: new Date(), activePrescriptions: 1, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 0, lastConsultationAt: new Date().toISOString(), followUp: fu,
      labSignals: { imaging: 0, pathology: 0, audiology: 0, awaitingReview: 0 }, followUps: [],
      loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.followUp.categories.find(c => c.category === 'audiology')!.awaitingReview).toBe(1)
  })
})

// ── Registry integration ────────────────────────────────────────────
describe('registry integration (ent.core)', () => {
  const pack = getCopilotPack('ent.core')!
  it('registers 9 ORL templates that all resolve', () => {
    for (const id of ORL_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...ORL_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of ORL_SMART_TEMPLATE_IDS) {
      for (const sec of getTemplate(id)!.sections) for (const f of sec.fields) expect(f.target.store).toBe('consultation')
    }
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / treatment / prescribing / interpretation / surgery / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no orlCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.orlCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no interpretation, no surgery recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'orl', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/interpretAudiometry|interpretImage|hearingLossDiagnos|recommendSurgery|malignan|sensorineural/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useOrl.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '046_orl_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/get_clinic_id\(\)/)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.orlCopilot).sort()).toEqual(Object.keys(en.orlCopilot).sort())
  })
})

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isOrthopedicsContext, categoryOf, isOrthoEventType, buildOrthoTracker, buildImagingTracker,
  buildOrthoFollowUp, countOrthoImagingSignals, computeOrthoCompleteness, buildOrthoBrief,
  ORTHO_COPILOT_PACK_ID, ORTHO_SPECIALTIES, ORTHO_ALL_TYPES, ORTHO_EVENT_STATUSES,
  ORTHO_EVENT_TYPES, ORTHO_IMAGING_TYPES, type OrthoEvent,
} from '../orthopedics/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, ORTHO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an orthopedics doctor; no leakage', () => {
    expect(isOrthopedicsContext('doctor', 'orthopedics')).toBe(true)
    expect(isOrthopedicsContext('doctor', 'cardiology')).toBe(false)
    expect(isOrthopedicsContext('doctor', 'internal_medicine')).toBe(false)
    expect(isOrthopedicsContext('doctor', 'emergency_medicine')).toBe(false)
    expect(isOrthopedicsContext('doctor', 'general_practice')).toBe(false)
    expect(isOrthopedicsContext('nurse', 'orthopedics')).toBe(false)
    expect(isOrthopedicsContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(ORTHO_COPILOT_PACK_ID).toBe('orthopedics.core')
    expect(getCopilotPack('orthopedics.core')!.supportedSpecialties).toEqual([...ORTHO_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('fracture_followup')).toBe('event')
    expect(categoryOf('cast_review')).toBe('event')
    expect(categoryOf('physiotherapy_referral')).toBe('event')
    expect(categoryOf('xray')).toBe('imaging')
    expect(categoryOf('ct')).toBe('imaging')
    expect(categoryOf('mri')).toBe('imaging')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isOrthoEventType('xray')).toBe(true)
    expect(isOrthoEventType('nope')).toBe(false)
    expect(ORTHO_EVENT_TYPES.length).toBe(9)
    expect(ORTHO_IMAGING_TYPES.length).toBe(3)
    expect(ORTHO_ALL_TYPES.length).toBe(12)
    expect(ORTHO_EVENT_STATUSES).toContain('awaiting_review')
    expect(ORTHO_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Orthopedic event tracker (counts only — never interpret) ───────
describe('buildOrthoTracker', () => {
  const events: OrthoEvent[] = [
    { eventType: 'cast_review', status: 'follow_up_due' },
    { eventType: 'cast_review', status: 'planned' },
    { eventType: 'wound_review', status: 'completed' },   // closed → not open
    { eventType: 'post_op_review', status: 'awaiting_review' },
  ]
  it('counts each event type by status', () => {
    const rows = buildOrthoTracker(events)
    const cast = rows.find(r => r.eventType === 'cast_review')!
    expect(cast.followUpDue).toBe(1)
    expect(cast.planned).toBe(1)
    expect(cast.total).toBe(2)
    const wound = rows.find(r => r.eventType === 'wound_review')!
    expect(wound.completed).toBe(1)
    expect(wound.total).toBe(0)
    const op = rows.find(r => r.eventType === 'post_op_review')!
    expect(op.awaitingReview).toBe(1)
    expect(op.total).toBe(1)
  })
})

// ── Imaging follow-up (counts only — never interpret an image) ─────
describe('buildImagingTracker', () => {
  it('counts imaging by status', () => {
    const rows = buildImagingTracker([
      { eventType: 'xray', status: 'awaiting_review' },
      { eventType: 'xray', status: 'ordered' },
      { eventType: 'mri', status: 'reviewed' },   // closed → not open
      { eventType: 'ct', status: 'completed' },
    ])
    const xr = rows.find(r => r.imagingType === 'xray')!
    expect(xr.awaitingReview).toBe(1)
    expect(xr.ordered).toBe(1)
    expect(xr.total).toBe(2)
    expect(rows.find(r => r.imagingType === 'mri')!.total).toBe(0)
    expect(rows.find(r => r.imagingType === 'ct')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildOrthoFollowUp', () => {
  const events: OrthoEvent[] = [
    { eventType: 'cast_review', status: 'follow_up_due' },
    { eventType: 'post_op_review', status: 'awaiting_review' },
    { eventType: 'xray', status: 'awaiting_review' },
    { eventType: 'ct', status: 'ordered' },
    { eventType: 'wound_review', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildOrthoFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('cast_review_due')
    expect(codes).toContain('post_op_review_awaiting')
    expect(codes).toContain('xray_awaiting')
    expect(codes).toContain('ct_pending')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'xray_awaiting')!.eventType).toBe('xray')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildOrthoFollowUp([{ eventType: 'cast_review', status: 'completed' }]).reminders).toEqual([])
    expect(buildOrthoFollowUp([]).reminders).toEqual([])
    expect(buildOrthoFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Imaging signals (counts only — never interpret) ────────────────
describe('countOrthoImagingSignals', () => {
  it('counts imaging in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'X-ray left wrist', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'CT pelvis' }] },
      { status: 'ordered', clinical_notes: 'MRI knee', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not imaging
    ] as unknown as LabOrder[]
    const s = countOrthoImagingSignals(orders)
    expect(s.imaging).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + ortho prompts) ─────────
describe('computeOrthoCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 orthopedic prompts', () => {
    const c = computeOrthoCompleteness({ chief_complaint: 'Ankle pain', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'ortho_doc_mechanism', 'ortho_doc_pain_location', 'ortho_doc_mobility', 'ortho_doc_neurovascular',
      'ortho_doc_limb', 'ortho_doc_imaging_requested', 'ortho_doc_procedure', 'ortho_doc_immobilization',
      'ortho_doc_physiotherapy', 'ortho_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildOrthoBrief', () => {
  it('reuses the GP brief and attaches ortho + imaging counts', () => {
    const b = buildOrthoBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'cast_applied', status: 'active' }, { eventType: 'xray', status: 'ordered' }, { eventType: 'post_op_review', status: 'follow_up_due' }, { eventType: 'physiotherapy_referral', status: 'planned' }],
      imagingSignals: { pending: 1, completed: 0, imaging: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.activeCasts).toBe(1)
    expect(b.summary.pendingImaging).toBe(1)   // xray ordered
    expect(b.summary.physiotherapyReferrals).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('post_op_review_due')
  })
})

// ── Registry integration (orthopedics.core) ────────────────────────
describe('registry integration (orthopedics.core)', () => {
  const pack = getCopilotPack('orthopedics.core')!
  it('registers 8 orthopedic templates that all resolve', () => {
    expect(ORTHO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of ORTHO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...ORTHO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of ORTHO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 orthopedic documents + shared docs for an ortho doctor', () => {
    for (const id of ['orthopedic_referral', 'ortho_physiotherapy_referral', 'cast_review_summary', 'post_op_orthopedic_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'orthopedics').map(d => d.id)
    expect(ids).toContain('orthopedic_referral')
    expect(ids).toContain('cast_review_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('cardiology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / fracture classification / imaging interpretation / treatment / surgery / medication / healing prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no orthopedicsCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.orthopedicsCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no imaging interpretation, no fracture classification / prediction', () => {
    const src = readFileSync(join(__dirname, '..', 'orthopedics', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No imaging interpretation, no fracture classification, no diagnosis, no healing/disability prediction, no surgery recommendation.
    expect(code).not.toMatch(/interpretImage|interpretXray|fractureType|classifyFracture|isFracture|dislocation|arthritis|recommendSurgery|healingTime|predictHealing|disabilityScore|salterHarris|garden/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useOrthopedics.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'OrthopedicsCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '053_orthopedic_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.orthopedicsCopilot).sort()).toEqual(Object.keys(en.orthopedicsCopilot).sort())
  })
})

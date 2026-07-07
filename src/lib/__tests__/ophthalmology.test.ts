import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isOphthalmologyContext, categoryOf, isOphthEventType, buildOphthTracker, buildImagingTracker,
  buildOphthFollowUp, countOphthImagingSignals, computeOphthCompleteness, buildOphthBrief,
  OPHTH_COPILOT_PACK_ID, OPHTH_SPECIALTIES, OPHTH_ALL_TYPES, OPHTH_EVENT_STATUSES,
  OPHTH_EVENT_TYPES, OPHTH_IMAGING_TYPES, type OphthEvent,
} from '../ophthalmology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, OPHTH_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for an ophthalmology doctor; no leakage', () => {
    expect(isOphthalmologyContext('doctor', 'ophthalmology')).toBe(true)
    expect(isOphthalmologyContext('doctor', 'orthopedics')).toBe(false)
    expect(isOphthalmologyContext('doctor', 'cardiology')).toBe(false)
    expect(isOphthalmologyContext('doctor', 'ent')).toBe(false)
    expect(isOphthalmologyContext('doctor', 'general_practice')).toBe(false)
    expect(isOphthalmologyContext('nurse', 'ophthalmology')).toBe(false)
    expect(isOphthalmologyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(OPHTH_COPILOT_PACK_ID).toBe('ophthalmology.core')
    expect(getCopilotPack('ophthalmology.core')!.supportedSpecialties).toEqual([...OPHTH_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('visual_acuity')).toBe('event')
    expect(categoryOf('glaucoma_followup')).toBe('event')
    expect(categoryOf('diabetic_eye_screening')).toBe('event')
    expect(categoryOf('fundus_imaging')).toBe('imaging')
    expect(categoryOf('oct_imaging')).toBe('imaging')
    expect(categoryOf('visual_field')).toBe('imaging')
    expect(categoryOf('eye_ultrasound')).toBe('imaging')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isOphthEventType('oct_imaging')).toBe(true)
    expect(isOphthEventType('nope')).toBe(false)
    expect(OPHTH_EVENT_TYPES.length).toBe(7)
    expect(OPHTH_IMAGING_TYPES.length).toBe(4)
    expect(OPHTH_ALL_TYPES.length).toBe(11)
    expect(OPHTH_EVENT_STATUSES).toContain('awaiting_review')
    expect(OPHTH_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only — never interpret) ──────────────────
describe('buildOphthTracker', () => {
  const events: OphthEvent[] = [
    { eventType: 'glaucoma_followup', status: 'follow_up_due' },
    { eventType: 'glaucoma_followup', status: 'planned' },
    { eventType: 'cataract_review', status: 'completed' },   // closed → not open
    { eventType: 'post_op_review', status: 'awaiting_review' },
  ]
  it('counts each event type by status', () => {
    const rows = buildOphthTracker(events)
    const gl = rows.find(r => r.eventType === 'glaucoma_followup')!
    expect(gl.followUpDue).toBe(1)
    expect(gl.planned).toBe(1)
    expect(gl.total).toBe(2)
    const cat = rows.find(r => r.eventType === 'cataract_review')!
    expect(cat.completed).toBe(1)
    expect(cat.total).toBe(0)
    expect(rows.find(r => r.eventType === 'post_op_review')!.awaitingReview).toBe(1)
  })
})

// ── Imaging follow-up (counts only — never interpret) ──────────────
describe('buildImagingTracker', () => {
  it('counts imaging by status', () => {
    const rows = buildImagingTracker([
      { eventType: 'oct_imaging', status: 'awaiting_review' },
      { eventType: 'oct_imaging', status: 'ordered' },
      { eventType: 'visual_field', status: 'reviewed' },  // closed → not open
      { eventType: 'fundus_imaging', status: 'completed' },
    ])
    const oct = rows.find(r => r.imagingType === 'oct_imaging')!
    expect(oct.awaitingReview).toBe(1)
    expect(oct.ordered).toBe(1)
    expect(oct.total).toBe(2)
    expect(rows.find(r => r.imagingType === 'visual_field')!.total).toBe(0)
    expect(rows.find(r => r.imagingType === 'fundus_imaging')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildOphthFollowUp', () => {
  const events: OphthEvent[] = [
    { eventType: 'diabetic_eye_screening', status: 'follow_up_due' },
    { eventType: 'post_op_review', status: 'awaiting_review' },
    { eventType: 'oct_imaging', status: 'awaiting_review' },
    { eventType: 'visual_field', status: 'ordered' },
    { eventType: 'cataract_review', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildOphthFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('diabetic_eye_screening_due')
    expect(codes).toContain('post_op_review_awaiting')
    expect(codes).toContain('oct_imaging_awaiting')
    expect(codes).toContain('visual_field_pending')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'oct_imaging_awaiting')!.eventType).toBe('oct_imaging')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildOphthFollowUp([{ eventType: 'glaucoma_followup', status: 'completed' }]).reminders).toEqual([])
    expect(buildOphthFollowUp([]).reminders).toEqual([])
    expect(buildOphthFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Imaging signals (counts only — never interpret) ────────────────
describe('countOphthImagingSignals', () => {
  it('counts eye imaging in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Fundus photography', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'OCT macula' }] },
      { status: 'ordered', clinical_notes: 'Visual field (perimetry)', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not eye imaging
    ] as unknown as LabOrder[]
    const s = countOphthImagingSignals(orders)
    expect(s.imaging).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + ophth prompts) ─────────
describe('computeOphthCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 ophthalmology prompts', () => {
    const c = computeOphthCompleteness({ chief_complaint: 'Blurred vision', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'ophth_doc_vision_complaint', 'ophth_doc_visual_acuity', 'ophth_doc_refraction', 'ophth_doc_ocular_history',
      'ophth_doc_eye_meds', 'ophth_doc_anterior_segment', 'ophth_doc_posterior_segment', 'ophth_doc_iop',
      'ophth_doc_imaging_requested', 'ophth_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildOphthBrief', () => {
  it('reuses the GP brief and attaches ophth + imaging counts', () => {
    const b = buildOphthBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'glaucoma_followup', status: 'active' }, { eventType: 'oct_imaging', status: 'ordered' }, { eventType: 'diabetic_eye_screening', status: 'follow_up_due' }, { eventType: 'post_op_review', status: 'planned' }],
      imagingSignals: { pending: 1, completed: 0, imaging: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.cataractGlaucoma).toBe(1)  // glaucoma active
    expect(b.summary.pendingImaging).toBe(1)     // oct ordered
    expect(b.summary.diabeticScreening).toBe(1)
    expect(b.summary.recentProcedures).toBe(1)   // post_op planned
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('diabetic_eye_screening_due')
  })
})

// ── Registry integration (ophthalmology.core) ──────────────────────
describe('registry integration (ophthalmology.core)', () => {
  const pack = getCopilotPack('ophthalmology.core')!
  it('registers 8 ophthalmology templates that all resolve', () => {
    expect(OPHTH_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of OPHTH_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...OPHTH_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of OPHTH_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 ophthalmology documents + shared docs for an ophth doctor', () => {
    for (const id of ['ophthalmology_referral', 'eye_examination_summary', 'visual_acuity_certificate', 'post_op_ophthalmology_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'ophthalmology').map(d => d.id)
    expect(ids).toContain('ophthalmology_referral')
    expect(ids).toContain('visual_acuity_certificate')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('orthopedic_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / imaging-OCT-fundus-field interpretation / glaucoma-cataract-retinopathy classification / treatment / surgery / medication / vision-loss prediction / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no ophthalmologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.ophthalmologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no image/OCT/field interpretation, no classification / vision-loss prediction', () => {
    const src = readFileSync(join(__dirname, '..', 'ophthalmology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No image/OCT/field interpretation, no glaucoma/cataract/retinopathy classification, no diagnosis, no vision-loss prediction.
    expect(code).not.toMatch(/interpretImage|interpretOct|interpretFundus|interpretField|classifyGlaucoma|classifyCataract|retinopathyGrade|cupDiscRatio|iopStage|predictVisionLoss|blindnessRisk|recommendSurgery/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useOphthalmology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'OphthalmologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '054_ophthalmology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.ophthalmologyCopilot).sort()).toEqual(Object.keys(en.ophthalmologyCopilot).sort())
  })
})

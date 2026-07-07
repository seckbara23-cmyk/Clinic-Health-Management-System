import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isNeurologyContext, categoryOf, isNeuroEventType, buildNeuroTracker, buildTestTracker,
  buildNeuroFollowUp, countNeuroImagingSignals, computeNeuroCompleteness, buildNeuroBrief,
  NEURO_COPILOT_PACK_ID, NEURO_SPECIALTIES, NEURO_ALL_TYPES, NEURO_EVENT_STATUSES,
  NEURO_EVENT_TYPES, NEURO_TEST_TYPES, type NeuroEvent,
} from '../neurology/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, NEURO_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'
import type { LabOrder } from '@/types/database'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a neurology doctor; no leakage', () => {
    expect(isNeurologyContext('doctor', 'neurology')).toBe(true)
    expect(isNeurologyContext('doctor', 'oncology')).toBe(false)
    expect(isNeurologyContext('doctor', 'general_surgery')).toBe(false)
    expect(isNeurologyContext('doctor', 'psychiatry')).toBe(false)
    expect(isNeurologyContext('doctor', 'general_practice')).toBe(false)
    expect(isNeurologyContext('nurse', 'neurology')).toBe(false)
    expect(isNeurologyContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(NEURO_COPILOT_PACK_ID).toBe('neurology.core')
    expect(getCopilotPack('neurology.core')!.supportedSpecialties).toEqual([...NEURO_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('maps event types to the right category', () => {
    expect(categoryOf('neurology_consultation')).toBe('event')
    expect(categoryOf('stroke_clinic_followup')).toBe('event')
    expect(categoryOf('eeg_review')).toBe('event')
    expect(categoryOf('rehabilitation_followup')).toBe('event')
    expect(categoryOf('brain_mri')).toBe('test')
    expect(categoryOf('eeg')).toBe('test')
    expect(categoryOf('nerve_conduction')).toBe('test')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isNeuroEventType('eeg')).toBe(true)
    expect(isNeuroEventType('nope')).toBe(false)
    expect(NEURO_EVENT_TYPES.length).toBe(15)
    expect(NEURO_TEST_TYPES.length).toBe(9)
    expect(NEURO_ALL_TYPES.length).toBe(24)
    expect(NEURO_EVENT_STATUSES).toContain('scheduled')
    expect(NEURO_EVENT_STATUSES).toContain('awaiting_review')
    expect(NEURO_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker + rehabilitation workflow (counts only) ──────────
describe('buildNeuroTracker', () => {
  const events: NeuroEvent[] = [
    { eventType: 'rehabilitation_followup', status: 'follow_up_due' },
    { eventType: 'rehabilitation_followup', status: 'planned' },
    { eventType: 'hospital_discharge_followup', status: 'completed' },   // closed → not open
    { eventType: 'eeg_review', status: 'awaiting_review' },
    { eventType: 'stroke_clinic_followup', status: 'scheduled' },
  ]
  it('counts each event type by status (rehabilitation workflow)', () => {
    const rows = buildNeuroTracker(events)
    const rehab = rows.find(r => r.eventType === 'rehabilitation_followup')!
    expect(rehab.followUpDue).toBe(1)
    expect(rehab.planned).toBe(1)
    expect(rehab.total).toBe(2)
    const disch = rows.find(r => r.eventType === 'hospital_discharge_followup')!
    expect(disch.completed).toBe(1)
    expect(disch.total).toBe(0)
    expect(rows.find(r => r.eventType === 'eeg_review')!.awaitingReview).toBe(1)
    const stroke = rows.find(r => r.eventType === 'stroke_clinic_followup')!
    expect(stroke.scheduled).toBe(1)
    expect(stroke.total).toBe(1)
  })
})

// ── EEG / EMG / MRI investigation workflow (counts only) ───────────
describe('buildTestTracker (EEG / EMG / MRI workflow)', () => {
  it('counts investigations by status', () => {
    const rows = buildTestTracker([
      { eventType: 'brain_mri', status: 'awaiting_review' },
      { eventType: 'brain_mri', status: 'ordered' },
      { eventType: 'eeg', status: 'reviewed' },  // closed → not open
      { eventType: 'emg', status: 'completed' },
    ])
    const mri = rows.find(r => r.testType === 'brain_mri')!
    expect(mri.awaitingReview).toBe(1)
    expect(mri.ordered).toBe(1)
    expect(mri.total).toBe(2)
    expect(rows.find(r => r.testType === 'eeg')!.total).toBe(0)
    expect(rows.find(r => r.testType === 'emg')!.total).toBe(1)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildNeuroFollowUp', () => {
  const events: NeuroEvent[] = [
    { eventType: 'rehabilitation_followup', status: 'follow_up_due' },
    { eventType: 'eeg_review', status: 'awaiting_review' },
    { eventType: 'brain_mri', status: 'awaiting_review' },
    { eventType: 'eeg', status: 'ordered' },
    { eventType: 'stroke_clinic_followup', status: 'scheduled' },
    { eventType: 'hospital_discharge_followup', status: 'completed' }, // closed → no reminder
  ]
  it('raises operational reminders, warnings first', () => {
    const f = buildNeuroFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('rehabilitation_followup_due')
    expect(codes).toContain('eeg_review_awaiting')
    expect(codes).toContain('brain_mri_awaiting')
    expect(codes).toContain('eeg_pending')
    expect(codes).toContain('stroke_clinic_followup_scheduled')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'brain_mri_awaiting')!.refType).toBe('brain_mri')
  })
  it('completed/empty input raises no reminders', () => {
    expect(buildNeuroFollowUp([{ eventType: 'eeg', status: 'reviewed' }]).reminders).toEqual([])
    expect(buildNeuroFollowUp([]).reminders).toEqual([])
    expect(buildNeuroFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Investigation signals (counts only — never interpret) ──────────
describe('countNeuroImagingSignals', () => {
  it('counts neurology investigations in existing lab orders without interpreting', () => {
    const orders = [
      { status: 'completed', clinical_notes: 'Brain MRI', items: [] },
      { status: 'ordered', clinical_notes: '', items: [{ test_name: 'EEG' }] },
      { status: 'ordered', clinical_notes: 'Nerve conduction study', items: [] },
      { status: 'ordered', clinical_notes: 'CBC', items: [] }, // not a neurology investigation
    ] as unknown as LabOrder[]
    const s = countNeuroImagingSignals(orders)
    expect(s.investigations).toBe(3)
    expect(s.completed).toBe(1)
    expect(s.pending).toBe(2)
  })
})

// ── Documentation completeness (reuses GP + neurology prompts) ─────
describe('computeNeuroCompleteness', () => {
  it('reuses GP SOAP score and adds the 10 neurology prompts', () => {
    const c = computeNeuroCompleteness({ chief_complaint: 'Headache', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'neuro_doc_presenting_complaint', 'neuro_doc_symptom_onset', 'neuro_doc_history', 'neuro_doc_seizure_history',
      'neuro_doc_headache_history', 'neuro_doc_examination', 'neuro_doc_imaging_followup', 'neuro_doc_neurophysiology_followup',
      'neuro_doc_rehab_plan', 'neuro_doc_follow_up',
    ]))
    expect(c.prompts.length).toBe(10)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildNeuroBrief', () => {
  it('reuses the GP brief and attaches neurology counts', () => {
    const b = buildNeuroBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [
        { eventType: 'stroke_clinic_followup', status: 'scheduled' },
        { eventType: 'brain_mri', status: 'ordered' },
        { eventType: 'eeg', status: 'awaiting_review' },
        { eventType: 'eeg_review', status: 'awaiting_review' },
        { eventType: 'rehabilitation_followup', status: 'active' },
        { eventType: 'neuropsychology_review', status: 'active' },
        { eventType: 'hospital_discharge_followup', status: 'follow_up_due' },
      ],
      imagingSignals: { pending: 1, completed: 0, investigations: 1 },
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.strokeFollowups).toBe(1)
    expect(b.summary.pendingImaging).toBe(1)              // brain_mri ordered
    expect(b.summary.pendingNeurophysiology).toBe(2)      // eeg (test) + eeg_review (event)
    expect(b.summary.rehabilitation).toBe(1)
    expect(b.summary.neuropsychology).toBe(1)
    expect(b.summary.discharge).toBe(1)
    expect(b.summary.medications).toBe(2)
    expect(b.followUp.reminders.map(r => r.code)).toContain('eeg_awaiting')
  })
})

// ── Registry integration (neurology.core) ──────────────────────────
describe('registry integration (neurology.core)', () => {
  const pack = getCopilotPack('neurology.core')!
  it('registers 8 neurology templates that all resolve', () => {
    expect(NEURO_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of NEURO_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...NEURO_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of NEURO_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 neurology documents + shared docs for a neurology doctor', () => {
    for (const id of ['neurology_referral', 'neurophysiology_summary', 'rehabilitation_summary', 'neurology_followup_summary']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'neurology').map(d => d.id)
    expect(ids).toContain('neurology_referral')
    expect(ids).toContain('rehabilitation_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('surgical_referral')    // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + privacy/security ──────────────────────────────
describe('safety invariants — no diagnosis / stroke-seizure-headache classification / EEG-EMG-MRI-CT-LP interpretation / thrombolysis-thrombectomy-med recommendation / recovery-disability-mortality prediction / NIHSS-Rankin-GCS scoring / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const FORBIDDEN = /\bNIHSS\b|rankin|glasgow coma|\bGCS\b|thrombolys|thrombectom|mortality|prognos/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no neurologyCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.neurologyCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no neurologyCopilot i18n string contains scoring / thrombolysis / thrombectomy / mortality / prognosis wording', () => {
    for (const [k, v] of Object.entries(en.neurologyCopilot as Record<string, string>)) {
      expect(`${k}:${FORBIDDEN.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no EEG/EMG/MRI/CT/LP interpretation, no classification / scoring / prediction / recommendation', () => {
    const src = readFileSync(join(__dirname, '..', 'neurology', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No interpretation, no stroke/seizure/headache classification, no NIHSS/Rankin/GCS/seizure-risk scoring, no recovery/disability/mortality prediction, no thrombolysis/thrombectomy/surgery/medication/admission/discharge/rehab recommendation.
    expect(code).not.toMatch(/interpretEeg|interpretEmg|interpretMri|interpretCt|interpretLumbar|classifyStroke|classifySeizure|classifyHeadache|strokeType|seizureType|headacheType|recommendThrombolys|recommendThrombectom|recommendSurgery|recommendAdmission|recommendDischarge|recommendRehab|predictRecovery|predictDisability|predictMortality|calcNihss|nihssScore|rankinScore|glasgowComa|gcsScore|seizureRisk/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useNeurology.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'NeurologyCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded (no composite-FK PK, tenant-scoped)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '060_neurology_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.neurologyCopilot).sort()).toEqual(Object.keys(en.neurologyCopilot).sort())
  })
})

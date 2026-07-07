import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isPsychiatryContext, categoryOf, isMhEventType, buildMhTracker, buildMhFollowUp,
  safetyPlanDocumented, computeMhCompleteness, buildMhBrief,
  MH_COPILOT_PACK_ID, MH_SPECIALTIES, MH_EVENT_TYPES, MH_EVENT_STATUSES, type MhEvent,
} from '../psychiatry/engine'
import { getCopilotPack } from '../copilot-packs/registry'
import { getTemplate, MH_SMART_TEMPLATE_IDS } from '../templates/registry'
import { getTool } from '../ai/tools'
import { availableDocuments, getDocument } from '../documents/registry'

// ── Activation / no specialty leakage ───────────────────────────────
describe('activation', () => {
  it('active only for a psychiatry doctor; no leakage', () => {
    expect(isPsychiatryContext('doctor', 'psychiatry')).toBe(true)
    expect(isPsychiatryContext('doctor', 'ophthalmology')).toBe(false)
    expect(isPsychiatryContext('doctor', 'internal_medicine')).toBe(false)
    expect(isPsychiatryContext('doctor', 'general_practice')).toBe(false)
    expect(isPsychiatryContext('nurse', 'psychiatry')).toBe(false)
    expect(isPsychiatryContext('doctor', null)).toBe(false)
  })
  it('pack id + specialties match the manifest', () => {
    expect(MH_COPILOT_PACK_ID).toBe('psychiatry.core')
    expect(getCopilotPack('psychiatry.core')!.supportedSpecialties).toEqual([...MH_SPECIALTIES])
  })
})

// ── Event vocabulary ────────────────────────────────────────────────
describe('event vocabulary', () => {
  it('recognises the workflow event types', () => {
    expect(categoryOf('initial_assessment')).toBe('event')
    expect(categoryOf('crisis_followup')).toBe('event')
    expect(categoryOf('safety_plan_review')).toBe('event')
    expect(categoryOf('nonsense')).toBeNull()
    expect(isMhEventType('therapy_session')).toBe(true)
    expect(isMhEventType('nope')).toBe(false)
    expect(MH_EVENT_TYPES.length).toBe(9)
    expect(MH_EVENT_STATUSES).toContain('awaiting_review')
    expect(MH_EVENT_STATUSES).toContain('follow_up_due')
  })
})

// ── Event tracker (counts only — never interpret) ──────────────────
describe('buildMhTracker', () => {
  const events: MhEvent[] = [
    { eventType: 'therapy_session', status: 'follow_up_due' },
    { eventType: 'therapy_session', status: 'planned' },
    { eventType: 'medication_review', status: 'completed' },   // closed → not open
    { eventType: 'crisis_followup', status: 'awaiting_review' },
  ]
  it('counts each event type by status', () => {
    const rows = buildMhTracker(events)
    const th = rows.find(r => r.eventType === 'therapy_session')!
    expect(th.followUpDue).toBe(1)
    expect(th.planned).toBe(1)
    expect(th.total).toBe(2)
    const med = rows.find(r => r.eventType === 'medication_review')!
    expect(med.completed).toBe(1)
    expect(med.total).toBe(0)
    expect(rows.find(r => r.eventType === 'crisis_followup')!.awaitingReview).toBe(1)
  })
})

// ── Safety-plan presence (documentation only — never a risk call) ──
describe('safetyPlanDocumented', () => {
  it('reports presence only, not content or risk', () => {
    expect(safetyPlanDocumented([{ eventType: 'safety_plan_review', status: 'completed' }])).toBe(true)
    expect(safetyPlanDocumented([{ eventType: 'therapy_session', status: 'active' }])).toBe(false)
    expect(safetyPlanDocumented([])).toBe(false)
  })
})

// ── Follow-up reminders (surface only — never interpret) ───────────
describe('buildMhFollowUp', () => {
  it('raises operational reminders, warnings first', () => {
    const events: MhEvent[] = [
      { eventType: 'therapy_session', status: 'follow_up_due' },
      { eventType: 'crisis_followup', status: 'awaiting_review' },
      { eventType: 'initial_assessment', status: 'active' }, // in care, no safety plan → missing nudge
    ]
    const f = buildMhFollowUp(events)
    const codes = f.reminders.map(r => r.code)
    expect(codes).toContain('therapy_session_due')
    expect(codes).toContain('crisis_followup_awaiting')
    expect(codes).toContain('safety_plan_missing')
    expect(f.reminders[0].severity).toBe('warning')
    expect(f.reminders.find(r => r.code === 'therapy_session_due')!.eventType).toBe('therapy_session')
  })
  it('does not nudge for a missing safety plan when one is already documented', () => {
    const f = buildMhFollowUp([
      { eventType: 'initial_assessment', status: 'active' },
      { eventType: 'safety_plan_review', status: 'completed' },
    ])
    expect(f.reminders.map(r => r.code)).not.toContain('safety_plan_missing')
  })
  it('closed non-engagement / empty input raises no reminders', () => {
    // medication_review is not "clinical engagement", so no safety-plan nudge fires.
    expect(buildMhFollowUp([{ eventType: 'medication_review', status: 'completed' }]).reminders).toEqual([])
    expect(buildMhFollowUp([]).reminders).toEqual([])
    expect(buildMhFollowUp([{ eventType: 'bogus', status: 'planned' }]).reminders).toEqual([])
  })
})

// ── Documentation completeness (reuses GP + MH prompts) ────────────
describe('computeMhCompleteness', () => {
  it('reuses GP SOAP score and adds the 9 mental-health prompts', () => {
    const c = computeMhCompleteness({ chief_complaint: 'Low mood', symptoms: 'x' })
    expect(c.sections.length).toBe(5)
    expect(c.prompts).toEqual(expect.arrayContaining([
      'mh_doc_presenting_concern', 'mh_doc_psychosocial', 'mh_doc_supports', 'mh_doc_medication_review',
      'mh_doc_sleep_appetite', 'mh_doc_functioning', 'mh_doc_safety_plan', 'mh_doc_follow_up', 'mh_doc_referral',
    ]))
    expect(c.prompts.length).toBe(9)
  })
})

// ── Brief ───────────────────────────────────────────────────────────
describe('buildMhBrief', () => {
  it('reuses the GP brief and attaches MH counts + safety-plan presence', () => {
    const b = buildMhBrief({
      now: new Date(), activePrescriptions: 2, pendingLabReviews: 0, outstandingBalance: 0, allergyCount: 0,
      upcomingAppointments: 1, lastConsultationAt: new Date().toISOString(),
      events: [{ eventType: 'therapy_session', status: 'active' }, { eventType: 'crisis_followup', status: 'follow_up_due' }, { eventType: 'referral_followup', status: 'planned' }, { eventType: 'safety_plan_review', status: 'completed' }],
      followUps: [], loaded: { prescriptions: true, labs: true, invoices: true },
    })
    expect(b.gp.confidence).toBe('high')
    expect(b.summary.sessions).toBe(1)
    expect(b.summary.crisisFollowUps).toBe(1)
    expect(b.summary.referralFollowUps).toBe(1)
    expect(b.summary.safetyPlanDocumented).toBe(true)
    expect(b.followUp.reminders.map(r => r.code)).toContain('crisis_followup_due')
  })
})

// ── Registry integration (psychiatry.core) ─────────────────────────
describe('registry integration (psychiatry.core)', () => {
  const pack = getCopilotPack('psychiatry.core')!
  it('registers 8 mental-health templates that all resolve', () => {
    expect(MH_SMART_TEMPLATE_IDS.length).toBe(8)
    for (const id of MH_SMART_TEMPLATE_IDS) expect(getTemplate(id)).toBeDefined()
    expect(pack.futureTemplateIds).toEqual(expect.arrayContaining([...MH_SMART_TEMPLATE_IDS]))
  })
  it('every futureAiToolId resolves', () => {
    for (const id of pack.futureAiToolIds) expect(getTool(id)).toBeDefined()
  })
  it('templates map ONLY to existing consultation columns', () => {
    for (const id of MH_SMART_TEMPLATE_IDS) {
      for (const s of getTemplate(id)!.sections) for (const f of s.fields) expect(f.target.store).toBe('consultation')
    }
  })
  it('registers the 4 mental-health documents + shared docs for a psychiatry doctor', () => {
    for (const id of ['mental_health_referral', 'therapy_followup_summary', 'crisis_followup_summary', 'return_to_care_reminder']) {
      expect(getDocument(id)).toBeDefined()
    }
    const ids = availableDocuments('doctor', 'psychiatry').map(d => d.id)
    expect(ids).toContain('mental_health_referral')
    expect(ids).toContain('crisis_followup_summary')
    expect(ids).toContain('gp_referral_letter')       // shared
    expect(ids).not.toContain('ophthalmology_referral')  // no other-specialty leakage
  })
})

// ── STOP CONDITIONS + confidentiality + privacy/security ────────────
describe('safety invariants — no diagnosis / risk-suicide prediction / classification / treatment-medication-admission recommendation / sensitive conclusion / confidential leakage / RLS change', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no psychiatryCopilot i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.psychiatryCopilot as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('no psychiatryCopilot i18n string contains risk / suicide / involuntary wording', () => {
    const RISK = /\b(suicid|self-harm|self harm|risk level|risk score|involuntary|sectioning|danger to)\b/i
    for (const [k, v] of Object.entries(en.psychiatryCopilot as Record<string, string>)) {
      expect(`${k}:${RISK.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the engine: no AI, no writes, no diagnosis, no risk/suicide prediction, no classification', () => {
    const src = readFileSync(join(__dirname, '..', 'psychiatry', 'engine.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/createClient|service_role|supabase/i)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    // No diagnosis, no risk/suicide/self-harm prediction, no severity/risk classification, no involuntary-admission recommendation.
    expect(code).not.toMatch(/suicideRisk|selfHarm|predictRisk|riskScore|riskLevel|classifyRisk|phq9Score|gad7Score|involuntary|sectioning|recommendAdmission|diagnos/i)
  })
  it('the hooks perform only clinician-gated writes; no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'usePsychiatry.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the panel imports NO AI provider', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'consultations', 'PsychiatryCopilot.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/ai\/providers/)
    expect(src).not.toMatch(/anthropic|openai|createServiceClient/i)
  })
  it('the migration is additive, surrogate-PK, RLS-guarded, and CONFIDENTIALITY-HARDENED (care team only, NO super_admin)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '055_mental_health_events.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
    // Confidentiality: every policy is care-team scoped and NEVER grants super_admin.
    const policies = code.split('CREATE POLICY').slice(1).join('CREATE POLICY')
    expect(policies).not.toMatch(/super_admin/)
    expect(policies).toMatch(/get_user_role\(\) IN \('doctor', 'nurse', 'admin'\)/)
    // The SELECT policy is also role-restricted (not open to all clinic members).
    expect(code).toMatch(/mental_health_events_select[\s\S]*get_user_role\(\) IN \('doctor', 'nurse', 'admin'\)/)
  })
  it('does not surface mental-health content in platform activity / reliability (no cross-wiring)', () => {
    // The engine + hook never reference the platform-activity / reliability aggregates.
    for (const p of [
      join(__dirname, '..', 'psychiatry', 'engine.ts'),
      join(__dirname, '..', '..', 'hooks', 'usePsychiatry.ts'),
    ]) {
      const src = readFileSync(p, 'utf8')
      expect(src).not.toMatch(/platform_activity|reliability|admin\/activity|log_platform/i)
    }
  })
  it('fr parity', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    expect(Object.keys(fr.psychiatryCopilot).sort()).toEqual(Object.keys(en.psychiatryCopilot).sort())
  })
})

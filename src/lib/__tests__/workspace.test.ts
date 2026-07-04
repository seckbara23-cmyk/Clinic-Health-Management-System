import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveWorkspace, composeWidgets, composeActions, allModulesConfig } from '../workspace/resolve'
import { SPECIALTIES, getSpecialty, isRegisteredSpecialty, DEFAULT_SPECIALTY } from '../specialties'
import { WIDGET_REGISTRY, getWidget } from '../widgets/registry'
import { QUICK_ACTION_REGISTRY, getAction } from '../actions/registry'
import { TEMPLATE_REGISTRY, getTemplate } from '../templates/registry'
import type { WorkspaceContext } from '../workspace/types'

const doctorCtx = (over: Partial<WorkspaceContext> = {}): WorkspaceContext => ({
  role: 'doctor',
  specialty: 'general_practice',
  clinic: allModulesConfig('doctor'),
  ...over,
})

// ── GOLDEN: general_practice reproduces today's doctor workspace ──
// These assertions pin the current experience. Any future change to the
// baseline must update this test intentionally.
describe('golden: general_practice = today’s doctor workspace', () => {
  const spec = resolveWorkspace(doctorCtx())

  it('exposes the current dashboard widgets in order', () => {
    expect(spec.dashboardWidgets.map(w => w.id)).toEqual(['ai_brief', 'kpis', 'today_queue', 'quick_actions'])
  })
  it('exposes the current clinical quick actions in order', () => {
    expect(spec.quickActions.map(a => a.id)).toEqual([
      'new_consultation', 'new_prescription', 'order_lab', 'schedule_appointment', 'new_invoice',
    ])
  })
  it('uses the SOAP consultation template mapped to existing columns', () => {
    expect(spec.consultationTemplate?.id).toBe('gp_consultation')
    expect(spec.consultationTemplate?.sections.map(s => s.id)).toEqual(['chief_complaint', 'hpi', 'exam', 'assessment', 'plan'])
    // Every field targets an EXISTING consultation column (no schema change).
    const targets = spec.consultationTemplate!.sections.flatMap(s => s.fields.map(f => f.target))
    for (const tgt of targets) expect(tgt.store).toBe('consultation')
    const cols = targets.map(t => (t.store === 'consultation' ? t.column : ''))
    expect(cols).toEqual(['chief_complaint', 'symptoms', 'notes', 'diagnosis', 'treatment_plan', 'follow_up_date'])
  })
  it('keeps today’s timeline sources', () => {
    expect(spec.timelineEventTypes).toEqual(['consultation', 'appointment', 'prescription', 'lab', 'invoice', 'dispensing'])
  })
  it('feeds the briefing from existing operational AI tools only', () => {
    expect(spec.aiBriefingTools).toEqual([
      'get_today_queue', 'get_long_waiting_patients', 'get_pending_lab_orders', 'get_critical_lab_results', 'get_unpaid_invoices',
    ])
  })
})

// ── Registry integrity (the plugin contract) ──────────────────────
describe('registry integrity', () => {
  it('has unique ids across every registry', () => {
    for (const list of [
      SPECIALTIES.map(s => s.id), WIDGET_REGISTRY.map(w => w.id),
      QUICK_ACTION_REGISTRY.map(a => a.id), TEMPLATE_REGISTRY.map(t => t.id),
    ]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })
  it('every specialty reference resolves to a registered widget/action/template', () => {
    for (const s of SPECIALTIES) {
      for (const w of s.defaultWidgets) expect(getWidget(w.id)).toBeDefined()
      for (const a of s.quickActions) expect(getAction(a.id)).toBeDefined()
      for (const t of s.consultationTemplates) expect(getTemplate(t.id)).toBeDefined()
    }
  })
  it('getSpecialty falls back to general_practice for unknown/empty ids', () => {
    expect(getSpecialty('does_not_exist').id).toBe('general_practice')
    expect(getSpecialty(null).id).toBe(DEFAULT_SPECIALTY)
    expect(isRegisteredSpecialty('pediatrics')).toBe(false) // not shipped in 14.1
    expect(isRegisteredSpecialty('general_practice')).toBe(true)
  })
  it('registers exactly one specialty in 14.1 (framework ships empty)', () => {
    expect(SPECIALTIES.map(s => s.id)).toEqual(['general_practice'])
  })
})

// ── Governance: role / module / lock / hide / order ───────────────
describe('composeWidgets governance rule', () => {
  const refs = [{ id: 'ai_brief' }, { id: 'revenue' }, { id: 'radiology' }, { id: 'lab_results' }]

  it('drops widgets the role may not see', () => {
    // revenue excludes nurse
    const nurse = composeWidgets(refs, doctorCtx({ role: 'nurse' }))
    expect(nurse.map(w => w.id)).not.toContain('revenue')
    const doc = composeWidgets(refs, doctorCtx())
    expect(doc.map(w => w.id)).toContain('revenue')
  })
  it('drops widgets whose required module is disabled', () => {
    const noRadiology = composeWidgets(refs, doctorCtx({
      clinic: { ...allModulesConfig('doctor'), enabledModules: ['lab'] }, // pharmacy/radiology off
    }))
    expect(noRadiology.map(w => w.id)).not.toContain('radiology')
    expect(noRadiology.map(w => w.id)).toContain('lab_results') // lab still enabled
  })
  it('hides an optional widget the user hid, but never a locked one', () => {
    const hiddenAiBrief = composeWidgets(refs, doctorCtx({ prefs: { hiddenWidgets: ['ai_brief'] } }))
    expect(hiddenAiBrief.map(w => w.id)).not.toContain('ai_brief')
    const lockedAiBrief = composeWidgets(refs, doctorCtx({
      clinic: { ...allModulesConfig('doctor'), lockedWidgets: ['ai_brief'] },
      prefs: { hiddenWidgets: ['ai_brief'] },
    }))
    expect(lockedAiBrief.find(w => w.id === 'ai_brief')?.locked).toBe(true) // lock wins
  })
  it('reorders by user preference, stable for the rest', () => {
    const ordered = composeWidgets(refs, doctorCtx({ prefs: { widgetOrder: ['lab_results', 'ai_brief'] } }))
    expect(ordered.map(w => w.id).slice(0, 2)).toEqual(['lab_results', 'ai_brief'])
  })
})

describe('composeActions', () => {
  it('gates order_lab on the lab module and role', () => {
    const refs = [{ id: 'new_consultation' }, { id: 'order_lab' }, { id: 'dispense' }]
    const doctorNoPharmacy = composeActions(refs, doctorCtx({
      clinic: { ...allModulesConfig('doctor'), enabledModules: ['lab'] },
    }))
    expect(doctorNoPharmacy.map(a => a.id)).toEqual(['new_consultation', 'order_lab']) // dispense needs pharmacy + role
  })
})

describe('resolveWorkspace fallback', () => {
  it('unknown specialty resolves to general_practice (no regression)', () => {
    const spec = resolveWorkspace(doctorCtx({ specialty: 'pediatrics' })) // not registered yet
    expect(spec.specialty).toBe('general_practice')
    expect(spec.dashboardWidgets.length).toBeGreaterThan(0)
  })
})

// ── Security invariant ────────────────────────────────────────────
describe('security invariants', () => {
  it('the workspace framework touches no database and no service role', () => {
    const files = [
      join('workspace', 'types.ts'), join('workspace', 'resolve.ts'),
      join('widgets', 'registry.ts'), join('actions', 'registry.ts'),
      join('templates', 'registry.ts'), join('specialties', 'index.ts'),
      join('specialties', 'general-practice.ts'),
    ]
    for (const rel of files) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8')
      expect(src).not.toMatch(/import[^\n]*supabase/i)
      expect(src).not.toMatch(/createClient|createServiceClient|service_role/)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })
})

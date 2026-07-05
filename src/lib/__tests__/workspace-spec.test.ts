import { readFileSync } from 'fs'
import { join } from 'path'
import { buildWorkspaceContext, resolveEffectiveWorkspace, parseUserPreferences } from '../workspace/spec'
import { allModulesConfig } from '../workspace/resolve'

// ── GOLDEN: the adapter reproduces the EXACT 14.1 baseline ──────────
// This is the zero-regression contract for Phase 14.2.6: when nothing has been
// onboarded (no specialty selected, no preferences saved — today's real-world
// starting state for every existing user), the resolved spec through the NEW
// combining path must be byte-identical to the pinned 14.1 golden test
// (workspace.test.ts `doctorCtx()`), because nothing swaps the live dashboard.
describe('golden: resolveEffectiveWorkspace(no inputs) === today’s doctor workspace', () => {
  const spec = resolveEffectiveWorkspace({ role: 'doctor' })

  it('exposes the current dashboard widgets in order', () => {
    expect(spec.dashboardWidgets.map(w => w.id)).toEqual(['ai_brief', 'kpis', 'today_queue', 'quick_actions'])
  })
  it('exposes the current clinical quick actions in order', () => {
    expect(spec.quickActions.map(a => a.id)).toEqual([
      'new_consultation', 'new_prescription', 'order_lab', 'schedule_appointment', 'new_invoice',
    ])
  })
  it('resolves to general_practice', () => {
    expect(spec.specialty).toBe('general_practice')
  })
  it('keeps today’s timeline sources and AI briefing tools', () => {
    expect(spec.timelineEventTypes).toEqual(['consultation', 'appointment', 'prescription', 'lab', 'invoice', 'dispensing'])
    expect(spec.aiBriefingTools).toEqual([
      'get_today_queue', 'get_long_waiting_patients', 'get_pending_lab_orders', 'get_critical_lab_results', 'get_unpaid_invoices',
    ])
  })
})

// ── Fallback behaviour (the whole point of this phase) ──────────────
describe('fallback: every missing layer degrades to the golden baseline', () => {
  it('completely empty input (no role either) still resolves safely', () => {
    const spec = resolveEffectiveWorkspace({})
    expect(spec.specialty).toBe('general_practice')
    expect(spec.dashboardWidgets.length).toBeGreaterThan(0)
  })

  it('missing professional profile (specialtyId null/undefined) → general_practice', () => {
    expect(resolveEffectiveWorkspace({ role: 'doctor', specialtyId: null }).specialty).toBe('general_practice')
    expect(resolveEffectiveWorkspace({ role: 'doctor', specialtyId: undefined }).specialty).toBe('general_practice')
  })

  it('unknown/unregistered specialty (e.g. a real 14.2.3 taxonomy id not yet a workspace pack) → general_practice', () => {
    for (const id of ['cardiology', 'obgyn', 'pediatrics', 'does_not_exist']) {
      const spec = resolveEffectiveWorkspace({ role: 'doctor', specialtyId: id })
      expect(spec.specialty).toBe('general_practice')
      expect(spec.dashboardWidgets.map(w => w.id)).toEqual(['ai_brief', 'kpis', 'today_queue', 'quick_actions'])
    }
  })

  it('missing user_preferences (undefined/null/{}) → no reordering or hiding (today’s behaviour)', () => {
    const a = resolveEffectiveWorkspace({ role: 'doctor', prefs: undefined })
    const b = resolveEffectiveWorkspace({ role: 'doctor', prefs: null })
    const c = resolveEffectiveWorkspace({ role: 'doctor', prefs: {} })
    for (const spec of [a, b, c]) {
      expect(spec.dashboardWidgets.map(w => w.id)).toEqual(['ai_brief', 'kpis', 'today_queue', 'quick_actions'])
    }
  })

  it('missing role → the documented safe default (doctor)', () => {
    const spec = resolveEffectiveWorkspace({ specialtyId: null })
    expect(spec.dashboardWidgets.map(w => w.id)).toContain('ai_brief') // doctor-visible widget present
  })

  it('never throws on garbage clinic overrides', () => {
    expect(() => resolveEffectiveWorkspace({ role: 'doctor', clinic: { enabledModules: [] } })).not.toThrow()
  })
})

// ── Mandatory / locked widget behaviour flows through the adapter ──
describe('locked (clinic-mandatory) widgets survive the combining path', () => {
  it('a clinic-locked widget stays visible even if user preferences hide it', () => {
    const spec = resolveEffectiveWorkspace({
      role: 'doctor',
      clinic: { lockedWidgets: ['ai_brief'] },
      prefs: { hiddenWidgets: ['ai_brief'] },
    })
    const aiBrief = spec.dashboardWidgets.find(w => w.id === 'ai_brief')
    expect(aiBrief).toBeDefined()
    expect(aiBrief!.locked).toBe(true)
  })

  it('an unlocked, user-hidden widget IS hidden (personalization still works)', () => {
    const spec = resolveEffectiveWorkspace({ role: 'doctor', prefs: { hiddenWidgets: ['kpis'] } })
    expect(spec.dashboardWidgets.map(w => w.id)).not.toContain('kpis')
  })

  it('user widget order re-orders unlocked widgets', () => {
    const spec = resolveEffectiveWorkspace({ role: 'doctor', prefs: { widgetOrder: ['today_queue', 'ai_brief'] } })
    expect(spec.dashboardWidgets.map(w => w.id).slice(0, 2)).toEqual(['today_queue', 'ai_brief'])
  })
})

// ── buildWorkspaceContext (unit-level) ───────────────────────────────
describe('buildWorkspaceContext', () => {
  it('layers clinic overrides onto the always-safe allModulesConfig baseline', () => {
    const ctx = buildWorkspaceContext({ role: 'doctor', clinic: { hospitalMode: true } })
    expect(ctx.clinic.hospitalMode).toBe(true)
    expect(ctx.clinic.enabledModules).toEqual(allModulesConfig('doctor').enabledModules) // untouched fields preserved
  })
  it('defaults to the doctor role and general_practice specialty', () => {
    const ctx = buildWorkspaceContext()
    expect(ctx.role).toBe('doctor')
    expect(ctx.specialty).toBe('general_practice')
    expect(ctx.prefs).toBeUndefined()
  })
})

// ── parseUserPreferences (tolerant parser) ──────────────────────────
describe('parseUserPreferences — tolerant of missing/malformed JSONB', () => {
  it('parses a well-formed preferences object', () => {
    expect(parseUserPreferences({
      widgetOrder: ['a', 'b'], hiddenWidgets: ['c'], favoriteActions: ['d'], noteStyle: 'soap',
    })).toEqual({ widgetOrder: ['a', 'b'], hiddenWidgets: ['c'], favoriteActions: ['d'], noteStyle: 'soap' })
  })
  it('drops non-array fields and invalid note styles', () => {
    expect(parseUserPreferences({ widgetOrder: 'not-an-array', noteStyle: 'invalid_style' })).toEqual({})
  })
  it('filters non-string entries out of arrays', () => {
    expect(parseUserPreferences({ hiddenWidgets: ['a', 1, null, 'b'] })).toEqual({ hiddenWidgets: ['a', 'b'] })
  })
  it('never throws on null/undefined/non-object/array input', () => {
    expect(parseUserPreferences(null)).toEqual({})
    expect(parseUserPreferences(undefined)).toEqual({})
    expect(parseUserPreferences('a string')).toEqual({})
    expect(parseUserPreferences(['array'])).toEqual({})
    expect(parseUserPreferences(42)).toEqual({})
  })
})

// ── Decoupling: packs contribute NOTHING yet (foundation-only guarantee) ──
describe('workspace spec adapter — pack decoupling', () => {
  it('the adapter imports NOTHING from copilot-packs (packs cannot affect the spec yet)', () => {
    const src = readFileSync(join(__dirname, '..', 'workspace', 'spec.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/copilot-packs/)
  })
})

// ── Security & isolation invariants ─────────────────────────────────
describe('security invariants', () => {
  const HOOK_DIR = join(__dirname, '..', '..', 'hooks')
  const COMPONENT_DIR = join(__dirname, '..', '..', 'components', 'workspace')

  it('the pure adapter (spec.ts) touches no database, no service role, no AI', () => {
    const src = readFileSync(join(__dirname, '..', 'workspace', 'spec.ts'), 'utf8')
    expect(src).not.toMatch(/import[^\n]*supabase/i)
    expect(src).not.toMatch(/createClient|createServiceClient|service_role/)
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
  })

  it('useWorkspaceSpec / useUserPreferences perform NO writes and call NO AI', () => {
    for (const file of ['useWorkspaceSpec.ts', 'useUserPreferences.ts']) {
      const src = readFileSync(join(HOOK_DIR, file), 'utf8')
      expect(src).not.toMatch(/from '@\/lib\/ai/)
      expect(src).not.toMatch(/service_role/)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })

  it('useUserPreferences reads a single flat table — no clinics embed, no relationship traversal', () => {
    const src = readFileSync(join(HOOK_DIR, 'useUserPreferences.ts'), 'utf8')
    expect(src).not.toMatch(/clinics\(/)
    expect(src).toMatch(/\.from\('user_preferences'\)/)
  })

  it('WorkspaceRenderer performs no navigation, no dialog, no writes, no AI (read-only preview)', () => {
    const src = readFileSync(join(COMPONENT_DIR, 'WorkspaceRenderer.tsx'), 'utf8')
    expect(src).not.toMatch(/next\/link|<Link/)
    expect(src).not.toMatch(/onClick/)
    expect(src).not.toMatch(/from '@\/lib\/ai/)
    expect(src).not.toMatch(/service_role|createClient/)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
  })

  it('the live dashboard page is UNTOUCHED by this phase — zero coupling, zero regression risk', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'dashboard', 'page.tsx'), 'utf8')
    expect(src).not.toMatch(/useWorkspaceSpec|WorkspaceRenderer|workspace\/spec/)
  })
})
